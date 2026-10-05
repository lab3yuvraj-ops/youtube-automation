import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { markReviewPending, loadProject, saveProject } from './reviewState.js';
import { publishApproved, decide } from './upload.js';
const config = { apiKey: 'fake', accountId: 'account', visibility: 'private' };
async function fixture(t: any) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'pipeline.json'), video = path.join(dir, 'video.mp4');
  await fs.writeFile(project, '{}'); await fs.writeFile(video, 'test video');
  await markReviewPending(project, video, 'Test');
  return { project, video };
}
async function approve(file: string) { const p = await loadProject(file); p.review!.status = 'approved'; await saveProject(file, p); }
function mock(failPost = false) {
  const calls: string[] = [];
  const http = (async (url: any, init: any) => {
    calls.push(String(url));
    if (String(url).endsWith('/accounts')) return Response.json({ accounts: [{ _id: 'account', platform: 'youtube' }] });
    if (String(url).endsWith('/presign')) return Response.json({ uploadUrl: 'https://storage.test/file', publicUrl: 'https://media.test/video.mp4' });
    if (String(url).includes('storage.test')) { assert.equal(init.headers.Authorization, undefined); for await (const chunk of init.body) {} return new Response(''); }
    if (failPost) throw new Error('Lost response');
    const body = JSON.parse(init.body); assert.equal(body.platforms[0].accountId, 'account'); assert.equal(body.publishNow, true);
    return Response.json({ post: { _id: 'post', platforms: [{ platform: 'youtube', status: 'pending' }] } });
  }) as typeof fetch;
  return { calls, http };
}
test('unapproved and rejected videos cannot upload', async t => {
  const f = await fixture(t); const m = mock();
  await assert.rejects(publishApproved(f.project, config, m.http), /approved/);
  await decide(f.project, false);
  await assert.rejects(publishApproved(f.project, config, m.http), /approved/);
  assert.equal(m.calls.length, 0);
});
test('changed file cannot upload', async t => {
  const f = await fixture(t); await approve(f.project); await fs.writeFile(f.video, 'changed'); const m = mock();
  await assert.rejects(publishApproved(f.project, config, m.http), /changed/); assert.equal(m.calls.length, 0);
});
test('local media uploads and pending post is not marked posted; duplicate blocked', async t => {
  const f = await fixture(t); await approve(f.project); const m = mock();
  const result = await publishApproved(f.project, config, m.http);
  assert.equal(result.status, 'submitted'); assert.equal(result.zernio_post_id, 'post');
  await assert.rejects(publishApproved(f.project, config, m.http)); assert.equal(m.calls.length, 4);
});
test('lost post response blocks resubmission', async t => {
  const f = await fixture(t); await approve(f.project); const m = mock(true);
  await assert.rejects(publishApproved(f.project, config, m.http), /Lost response/);
  assert.equal((await loadProject(f.project)).review!.status, 'submitting');
  await assert.rejects(publishApproved(f.project, config, m.http)); assert.equal(m.calls.length, 4);
});
