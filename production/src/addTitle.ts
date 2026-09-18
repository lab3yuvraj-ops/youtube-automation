import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const input = path.resolve(arg('--input') ?? 'outputs/last-bus-narrated-synced.mp4');
const output = path.resolve(arg('--output') ?? 'outputs/last-bus-title.mp4');
const title = arg('--title', 'AAKHRI BUS KI TEESRI SEAT')!;
const escapeAss = (value: string) => value.replace(/[{}\\]/g, (char) => `\\${char}`);
const ass = path.join(path.dirname(output), '.last-bus-title.ass');
await fs.writeFile(ass, `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Title,Georgia,82,&H00F8F1E5,&H00F8F1E5,&HDC0B1B22,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,3,8,60,60,108,1
Style: Kicker,Georgia,19,&H009ED5D7,&H009ED5D7,&HDC0B1B22,&H80000000,0,0,0,0,100,100,5,0,1,1,2,8,60,60,200,1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:03.70,Title,,0,0,0,,{\\fad(400,700)\\fscx72\\fscy72\\t(0,400,\\fscx100\\fscy100)}${escapeAss(title)}
Dialogue: 1,0:00:00.00,0:00:03.70,Kicker,,0,0,0,,{\\fad(400,700)\\fscx72\\fscy72\\t(0,400,\\fscx100\\fscy100)}H I N D I   F O L K   H O R R O R
`);
const escapedAss = ass.replace(/\\/g, '/').replace(':', '\\:');
const vf = `subtitles=filename='${escapedAss}':fontsdir='C\\:/Windows/Fonts'`;

await exec('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', vf, '-map', '0:v:0', '-map', '0:a?',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart', output,
], { maxBuffer: 1024 * 1024 * 8 });
console.log(JSON.stringify({ input, output, title, titleEndSeconds: 3.7 }));
