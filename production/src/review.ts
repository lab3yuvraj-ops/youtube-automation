import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProject, markReviewPending, saveProject } from './reviewState.js';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const command = process.argv[2] ?? 'status';
const projectFile = arg('--project');
if (!projectFile) throw new Error('Pass --project <pipeline.json>.');
const absoluteProject = path.resolve(projectFile);

if (command === 'request') {
  const video = arg('--video');
  if (!video) throw new Error('Pass --video <final.mp4>.');
  const absoluteVideo = path.resolve(video);
  await fs.access(absoluteVideo);
  const review = await markReviewPending(absoluteProject, absoluteVideo, arg('--title'));
  console.log(JSON.stringify({ review, questions: ['Should I approve this video?', 'Is it good to post on YouTube or not?'], approve: `npm run review -- approve --project "${absoluteProject}"`, reject: `npm run review -- reject --project "${absoluteProject}"` }, null, 2));
} else {
  const project = await loadProject(absoluteProject);
  if (!project.review) throw new Error('This project has not reached the review step. Run `review request` after the final video is rendered.');
  if (command === 'approve' || command === 'reject') {
    project.review.status = command === 'approve' ? 'approved' : 'rejected';
    project.review.decided_at = new Date().toISOString();
    delete project.review.error;
    await saveProject(absoluteProject, project);
  } else if (command !== 'status') throw new Error('Use one of: request, status, approve, reject.');
  const response: Record<string, unknown> = { review: project.review };
  if (project.review.status === 'rejected') response.next_question = 'Should I regenerate the video?';
  if (project.review.status === 'approved') response.next_step = 'Connect a YouTube account and use the Zernio publish command when you are ready.';
  console.log(JSON.stringify(response, null, 2));
}
