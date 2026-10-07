/**
 * Mix Google AI Studio narration over non-character scenes.
 * The source clip audio is muted only where narration exists; character
 * dialogue clips retain their native Flow audio. Full clip lengths and fades
 * are preserved.
 */
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
const narrationDir = path.resolve(arg('--narration-dir') ?? path.join(inputDir, 'narration'));
const output = path.resolve(arg('--output') ?? path.join(inputDir, 'final-narrated.mp4'));
const bgm = arg('--bgm') ? path.resolve(arg('--bgm')!) : undefined;
// The Google AI Studio narration is quiet by design. Compression with 12 dB
// makeup yields a measured ~-14 LUFS narration against a -20.9 LUFS music bed.
const narrationMakeupDb = Number(arg('--narration-makeup-db', '12'));
const bgmLufs = Number(arg('--bgm-lufs', '-20.9'));
const transition = Number(arg('--transition', '0.35'));
if (!Number.isFinite(transition) || transition <= 0) throw new Error('--transition must be greater than 0');
if (!Number.isFinite(narrationMakeupDb) || narrationMakeupDb < 0 || narrationMakeupDb > 24) throw new Error('--narration-makeup-db must be between 0 and 24.');
if (!Number.isFinite(bgmLufs) || bgmLufs > -5 || bgmLufs < -40) throw new Error('--bgm-lufs must be between -40 and -5.');

const sceneFiles = (await fs.readdir(inputDir))
  .filter((file) => /^scene-\d{4}\.mp4$/i.test(file))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((file) => path.join(inputDir, file));
if (sceneFiles.length < 2) throw new Error(`Expected at least two scene-####.mp4 clips in ${inputDir}`);

const audioExtensions = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg']);
const narrationNames = new Map<number, string>();
for (const name of await fs.readdir(narrationDir)) {
  const match = /^narration-(\d{4})\.(\w+)$/i.exec(name);
  if (match && audioExtensions.has(`.${match[2].toLowerCase()}`)) narrationNames.set(Number(match[1]), path.join(narrationDir, name));
}
if (!narrationNames.size) throw new Error(`No narration-#### audio files found in ${narrationDir}`);

async function duration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= transition) throw new Error(`${path.basename(file)} is too short for a ${transition}s transition`);
  return seconds;
}

const durations = await Promise.all(sceneFiles.map(duration));
const sceneNumbers = sceneFiles.map(file => Number(/scene-(\d{4})/i.exec(path.basename(file))![1]));
const manifestFile = arg('--manifest');
if (manifestFile) {
  const manifest = JSON.parse(await fs.readFile(path.resolve(manifestFile), 'utf8'));
  for (const scene of manifest.scenes) {
    if (!sceneNumbers.includes(scene.scene_number) || !narrationNames.has(scene.scene_number)) throw new Error(`Missing clip or narration for scene ${scene.scene_number}. Refusing a silent final video.`);
  }
}
const narrationInputs = [...narrationNames.entries()].sort(([a], [b]) => a - b);
if (bgm) await fs.access(bgm);
const narrationDurations = new Map(await Promise.all(narrationInputs.map(async ([scene, file]) => [scene, await duration(file)] as const)));
// Narrator shots should end with the spoken thought. Keep a tiny visual tail,
// but do not pad a short narration with several seconds of silence.
const narrationTail = 0.25;
const outputDurations = durations.map((clipDuration, index) => {
  const narrationDuration = narrationDurations.get(sceneNumbers[index]);
  if (narrationDuration === undefined) return clipDuration;
  // Scene 2 needs the full establishing narration before the driver speaks.
  // Slow the picture rather than cutting the final words of its voiceover.
  return Math.max(clipDuration, narrationDuration + narrationTail);
});
const narrationIndex = new Map(narrationInputs.map(([scene], index) => [scene, sceneFiles.length + index]));
let graph = '';
for (let i = 0; i < sceneFiles.length; i++) {
  const scene = sceneNumbers[i];
  const videoTiming = outputDurations[i] > durations[i]
    ? `setpts=${(outputDurations[i] / durations[i]).toFixed(6)}*PTS,`
    : '';
  graph += `${graph ? ';' : ''}[${i}:v]${videoTiming}trim=duration=${outputDurations[i].toFixed(3)},fps=30,settb=AVTB,setsar=1,setpts=PTS-STARTPTS[v${i}]`;
  const voiceInput = narrationIndex.get(scene);
  if (voiceInput === undefined) {
    graph += `;[${i}:a]atrim=duration=${outputDurations[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`;
  } else {
    // Keep the Flow ambience and scene SFX. They duck beneath the Hindi
    // narration instead of being muted, so narration gaps never become
    // dead air. Character scenes (without narration) remain fully native.
    graph += `;[${i}:a]apad,atrim=duration=${outputDurations[i].toFixed(3)},asetpts=PTS-STARTPTS[source${i}]`;
    graph += `;[${voiceInput}:a]acompressor=threshold=0.05:ratio=8:attack=5:release=100:makeup=${narrationMakeupDb},alimiter=limit=0.9:level=0,asetpts=PTS-STARTPTS,apad,atrim=duration=${outputDurations[i].toFixed(3)},asplit=2[voice${i}][sidechain${i}]`;
    graph += `;[source${i}][sidechain${i}]sidechaincompress=threshold=0.025:ratio=12:attack=80:release=500[duckedsource${i}]`;
    graph += `;[duckedsource${i}][voice${i}]amix=inputs=2:duration=first:normalize=0[a${i}]`;
  }
}
let runningDuration = outputDurations[0];
let video = 'v0';
let audio = 'a0';
for (let i = 1; i < sceneFiles.length; i++) {
  const nextVideo = `vx${i}`;
  const nextAudio = `ax${i}`;
  graph += `;[${video}][v${i}]xfade=transition=fade:duration=${transition}:offset=${Math.max(0, runningDuration - transition).toFixed(3)}[${nextVideo}]`;
  graph += `;[${audio}][a${i}]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`;
  video = nextVideo;
  audio = nextAudio;
  runningDuration += outputDurations[i] - transition;
}
if (bgm) {
  const bgmInput = sceneFiles.length + narrationInputs.length;
  graph += `;[${bgmInput}:a]aloop=loop=-1:size=2147483647,loudnorm=I=${bgmLufs}:TP=-5:LRA=7,atrim=duration=${runningDuration.toFixed(3)},asetpts=PTS-STARTPTS[bgm]`;
  graph += `;[${audio}][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0[mixedaudio]`;
  audio = 'mixedaudio';
}

await fs.mkdir(path.dirname(output), { recursive: true });
await exec('ffmpeg', [
  '-y', ...sceneFiles.flatMap((file) => ['-i', file]), ...narrationInputs.flatMap(([, file]) => ['-i', file]), ...(bgm ? ['-i', bgm] : []),
  '-filter_complex', graph, '-map', `[${video}]`, '-map', `[${audio}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
], { maxBuffer: 1024 * 1024 * 8 });
console.log(JSON.stringify({ output, clips: sceneFiles.length, narrationScenes: narrationInputs.map(([scene]) => scene), narrationMakeupDb, bgm, bgmLufs, transitionSeconds: transition, durationSeconds: Number(runningDuration.toFixed(3)) }));
