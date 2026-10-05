import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadProject, saveProject } from './reviewState.js';
import { setup, ask, type Config } from './setupConfig.js';
export async function fingerprint(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function publishApproved(projectFile: string, config?: Config, http: typeof fetch = fetch) {
  const lock = await fs.open(`${projectFile}.upload.lock`, 'wx');
  try {
    const project = await loadProject(projectFile);
    const review = project.review;
    if (!review || review.status !== 'approved') throw new Error('Only an approved video can be uploaded.');
    if (review.zernio_post_id || review.submission_started_at) throw new Error('An upload was already submitted. Check its Zernio status before any retry.');
    if (!review.video_sha256 || await fingerprint(review.video_path) !== review.video_sha256) throw new Error('Video changed since review. Request a new review.');
    const settings = config ?? await setup(false);
    const request = async (endpoint: string, body?: unknown): Promise<any> => {
      const response = await http(`https://zernio.com/api/v1${endpoint}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`Zernio request failed (${response.status}) at ${endpoint}.`);
      return response.json();
    };
    const accounts = await request('/accounts');
    if (!(accounts.accounts ?? accounts).some((a: any) => a._id === settings.accountId && a.platform === 'youtube')) throw new Error('The account ID is not a connected YouTube account for this API key.');
    const stat = await fs.stat(review.video_path);
    if (!stat.size || stat.size > 5 * 1024 ** 3) throw new Error('Video must be nonempty and within the 5 GB upload limit.');
    const media = await request('/media/presign', { filename: path.basename(review.video_path), contentType: 'video/mp4', size: stat.size });
    const upload = await http(media.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(stat.size) }, body: createReadStream(review.video_path), duplex: 'half' } as any);
    if (!upload.ok) throw new Error(`Media upload failed (${upload.status}).`);
    if (await fingerprint(review.video_path) !== review.video_sha256) throw new Error('Video changed during upload. Request a new review.');
    review.submission_started_at = new Date().toISOString();
    review.status = 'submitting';
    await saveProject(projectFile, project);
    const result = await request('/posts', {
      content: review.title ?? '', mediaItems: [{ type: 'video', url: media.publicUrl }],
      platforms: [{ platform: 'youtube', accountId: settings.accountId, platformSpecificData: { title: (review.title || 'Untitled Video').slice(0, 100), visibility: settings.visibility, madeForKids: false, containsSyntheticMedia: true } }], publishNow: true,
    });
    review.zernio_post_id = result.post?._id;
    const youtube = result.post?.platforms?.find((p: any) => p.platform === 'youtube');
    review.youtube_url = youtube?.platformPostUrl;
    review.status = youtube?.status === 'published' ? 'posted' : youtube?.status === 'failed' ? 'failed' : 'submitted';
    if (review.status === 'posted') review.posted_at = new Date().toISOString();
    await saveProject(projectFile, project);
    return review;
  } finally { await lock.close(); await fs.unlink(`${projectFile}.upload.lock`); }
}
export async function decide(projectFile: string, approve: boolean) {
  const lock = await fs.open(`${projectFile}.upload.lock`, 'wx');
  let review;
  try {
    const project = await loadProject(projectFile);
    if (!project.review || project.review.status !== 'awaiting_approval') throw new Error('This video is not awaiting approval.');
    project.review.status = approve ? 'approved' : 'rejected';
    project.review.decided_at = new Date().toISOString();
    await saveProject(projectFile, project);
    review = project.review;
  } finally { await lock.close(); await fs.unlink(`${projectFile}.upload.lock`); }
  return approve ? publishApproved(projectFile) : review;
}
export async function promptReview(projectFile: string) {
  const settings = await setup(false);
  const project = await loadProject(projectFile);
  console.log(`Review video: ${project.review?.video_path}\nApproval uploads to ${settings.accountId} with ${settings.visibility} visibility.`);
  const answer = (await ask('Is this video good enough to upload to YouTube? [yes/no]: ')).toLowerCase();
  if (!['yes', 'y', 'no', 'n'].includes(answer)) throw new Error('No decision recorded. Answer yes or no.');
  console.log(JSON.stringify(await decide(projectFile, ['yes', 'y'].includes(answer)), null, 2));
}
