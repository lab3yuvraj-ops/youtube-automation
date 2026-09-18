import fs from 'node:fs/promises';
import path from 'node:path';

export type ReviewStatus = 'awaiting_approval' | 'approved' | 'rejected' | 'posted' | 'failed';

export interface ReviewState {
  status: ReviewStatus;
  video_path: string;
  title?: string;
  requested_at?: string;
  decided_at?: string;
  posted_at?: string;
  error?: string;
  zernio_post_id?: string;
  youtube_url?: string;
}

export interface ReviewProject {
  project_id?: string;
  review?: ReviewState;
  [key: string]: unknown;
}

export async function loadProject(projectFile: string): Promise<ReviewProject> {
  return JSON.parse(await fs.readFile(projectFile, 'utf8')) as ReviewProject;
}

export async function saveProject(projectFile: string, project: ReviewProject): Promise<void> {
  const temporary = `${projectFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, projectFile);
}

export async function markReviewPending(projectFile: string, videoFile: string, title?: string): Promise<ReviewState> {
  const project = await loadProject(projectFile);
  const review: ReviewState = {
    status: 'awaiting_approval',
    video_path: path.resolve(videoFile),
    title,
    requested_at: new Date().toISOString(),
  };
  project.review = review;
  await saveProject(projectFile, project);
  return review;
}
