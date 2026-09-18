/** Assemble Flow clips at their full natural duration with audio/video fades. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const inputDir = path.resolve(arg('--input-dir') ?? 'outputs');
const output = path.resolve(arg('--output') ?? path.join(inputDir, 'final-with-fades.mp4'));
const transition = Number(arg('--transition', '0.35'));
if (!Number.isFinite(transition) || transition <= 0) throw new Error('--transition must be greater than 0');

const clips = (await fs.readdir(inputDir))
  .filter((file) => /^scene-\d{4}\.mp4$/i.test(file))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((file) => path.join(inputDir, file));
if (clips.length < 2) throw new Error(`Expected at least two scene-####.mp4 clips in ${inputDir}`);

async function duration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= transition) throw new Error(`${path.basename(file)} is too short for a ${transition}s transition`);
  return seconds;
}

const durations = await Promise.all(clips.map(duration));
let graph = clips.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS[v${i}];[${i}:a]asetpts=PTS-STARTPTS[a${i}]`).join(';');
let runningDuration = durations[0];
let video = 'v0';
let audio = 'a0';
for (let i = 1; i < clips.length; i++) {
  const nextVideo = `vx${i}`;
  const nextAudio = `ax${i}`;
  const offset = Math.max(0, runningDuration - transition).toFixed(3);
  graph += `;[${video}][v${i}]xfade=transition=fade:duration=${transition}:offset=${offset}[${nextVideo}]`;
  graph += `;[${audio}][a${i}]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`;
  video = nextVideo;
  audio = nextAudio;
  runningDuration += durations[i] - transition;
}

await fs.mkdir(path.dirname(output), { recursive: true });
await exec('ffmpeg', [
  '-y', ...clips.flatMap((clip) => ['-i', clip]), '-filter_complex', graph,
  '-map', `[${video}]`, '-map', `[${audio}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
], { maxBuffer: 1024 * 1024 * 8 });
console.log(JSON.stringify({ output, clips: clips.length, transitionSeconds: transition, durationSeconds: Number(runningDuration.toFixed(3)) }));
