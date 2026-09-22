/** Add a low, continuous music bed without replacing or ducking the approved audio track. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};
const input = path.resolve(arg('--input') ?? 'input.mp4');
const bgm = path.resolve(arg('--bgm') ?? 'background-music.mp3');
const output = path.resolve(arg('--output') ?? 'output.mp4');
// The CC0 ambience source is itself deliberately quiet.  A 55% gain keeps it
// audible all the way through while still sitting well below dialogue.
const volume = Number(arg('--volume', '0.55'));
if (!Number.isFinite(volume) || volume <= 0 || volume > 1) throw new Error('--volume must be between 0 and 1.');
const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
const duration = Number(stdout.trim());
if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine the input duration.');
const graph = [
  `[1:a]aloop=loop=-1:size=2147483647,volume=${volume},atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[bgm]`,
  `[0:a][bgm]amix=inputs=2:duration=first:normalize=0[audio]`,
].join(';');
await exec('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-i', bgm, '-filter_complex', graph,
  '-map', '0:v:0', '-map', '[audio]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
], { maxBuffer: 1024 * 1024 * 8 });
console.log(JSON.stringify({ input, bgm, output, durationSeconds: Number(duration.toFixed(3)), originalAudioPreserved: true }));
