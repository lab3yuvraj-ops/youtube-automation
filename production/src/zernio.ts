import { loadProject, saveProject } from './reviewState.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://zernio.com/api/v1';
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function loadLocalEnvironment(): Promise<void> {
  const dotenvFile = path.resolve(moduleDirectory, '../../scripting/.env');
  try {
    const contents = await fs.readFile(dotenvFile, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
      if (name && value && !process.env[name]) process.env[name] = value;
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await loadLocalEnvironment();

function apiKey(): string {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error('Set ZERNIO_API_KEY in your local environment or scripting/.env. Never commit it.');
  return key;
}
async function request(endpoint: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_BASE}${endpoint}`, { ...init, headers: { Authorization: `Bearer ${apiKey()}`, ...(init.headers ?? {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Zernio ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

const command = process.argv[2] ?? 'test';
if (command === 'test') {
  const response = await request('/accounts');
  const accounts = Array.isArray(response) ? response : (response as { accounts?: unknown[] }).accounts ?? [];
  const youtubeAccounts = accounts.filter((account: any) => String(account.platform ?? account.type ?? '').toLowerCase() === 'youtube');
  console.log(JSON.stringify({ configured: true, accounts: accounts.length, youtube_accounts: youtubeAccounts.length, write_operation: false }, null, 2));
} else if (command === 'connect-youtube') {
  const profileId = arg('--profile-id');
  if (!profileId) throw new Error('Pass --profile-id <Zernio profile id>.');
  const response = await request(`/connect/youtube?profileId=${encodeURIComponent(profileId)}`);
  console.log(JSON.stringify({ response, write_operation: false }, null, 2));
} else if (command === 'publish') {
  if (arg('--confirm-publish') !== 'YES') throw new Error('Publishing is external. Pass --confirm-publish YES only after explicit approval.');
  const projectFile = arg('--project'); const accountId = arg('--account-id'); const mediaUrl = arg('--media-url'); const title = arg('--title');
  if (!projectFile || !accountId || !mediaUrl || !title) throw new Error('Pass --project, --account-id, --media-url (a publicly reachable MP4), and --title.');
  const project = await loadProject(path.resolve(projectFile));
  if (project.review?.status !== 'approved') throw new Error('The video must be approved before it can be published.');
  const description = arg('--description') ?? '';
  const tags = (arg('--tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
  const visibility = arg('--visibility') ?? 'private';
  if (!['public', 'private', 'unlisted'].includes(visibility)) throw new Error('Visibility must be public, private, or unlisted.');
  const result = await request('/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: description, tags, mediaItems: [{ type: 'video', url: mediaUrl }], platforms: [{ platform: 'youtube', accountId, platformSpecificData: { title: title.slice(0, 100), visibility, madeForKids: false, containsSyntheticMedia: true } }], publishNow: true }) }) as any;
  project.review.status = 'posted'; project.review.posted_at = new Date().toISOString(); project.review.zernio_post_id = result?.post?.id; project.review.youtube_url = result?.post?.platforms?.[0]?.platformPostUrl;
  await saveProject(path.resolve(projectFile), project);
  console.log(JSON.stringify({ published: true, post_id: project.review.zernio_post_id, youtube_url: project.review.youtube_url }, null, 2));
} else throw new Error('Use one of: test, connect-youtube, publish.');
