import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProject, markReviewPending } from './reviewState.js';
import { decide, promptReview, publishApproved } from './upload.js';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const command = process.argv[2] ?? 'status';
const file = arg('--project');
if (!file) throw new Error('Pass --project <pipeline.json>.');
const projectFile = path.resolve(file);
if (command === 'request') {
  const video = arg('--video');
  if (!video) throw new Error('Pass --video <final.mp4>.');
  await fs.access(video);
  console.log(await markReviewPending(projectFile, path.resolve(video), arg('--title')));
} else if (command === 'prompt') await promptReview(projectFile);
else if (command === 'approve' || command === 'reject') console.log(await decide(projectFile, command === 'approve'));
else if (command === 'retry') console.log(await publishApproved(projectFile));
else if (command === 'status') console.log((await loadProject(projectFile)).review);
else throw new Error('Use request, prompt, approve, reject, retry or status.');
