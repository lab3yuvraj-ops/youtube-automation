import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, loadEnvironment, setup } from './setupConfig.js';
import { narrateManifest } from './narration.js';

const production = path.join(root, 'production');
const arg = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index+1]; };
if(process.argv.includes('--help')) {
  console.log('New video: node start-video.mjs --title "Your title" [--concept "Premise"]\nResume: node start-video.mjs --project /path/pipeline.json [--output-dir /path/output] [--user-data-dir /path/profile]\nRun from the repository root. Mac, Windows and Linux are supported; PowerShell is not required.');
  process.exit(0);
}
async function command(binary: string, args: string[], cwd = production) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(binary)} exited with code ${code}; later stages were not run.`)));
  });
}
async function script(name: string, args: string[]) {
  await command(process.execPath, ['--use-system-ca', '--import', 'tsx', path.join(production,'src',name), ...args]);
}
await loadEnvironment();
let project = arg('--project') ? path.resolve(arg('--project')!) : undefined;
const title = arg('--title');
if (!project && !title) throw new Error('Pass --title "Your title" for a new video or --project <pipeline.json> to resume.');
await setup();
for (const binary of ['ffmpeg','ffprobe']) await command(binary,['-version']);
const profile = path.resolve(arg('--user-data-dir') ?? path.join(production,'chrome-profile'));
if (!project) {
  const id = `youtube-automation-${new Date().toISOString().replace(/[^0-9]/g,'')}`;
  const venv = path.join(root,'scripting','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  let python = process.env.PYTHON || (process.platform==='win32'?'python':'python3');
  try { await fs.access(venv); python=venv; } catch {}
  await command(python,['-m','pipeline.one_minute','--project-id',id,'--title',title!,...(arg('--concept')?['--concept',arg('--concept')!]:[])],path.join(root,'scripting'));
  project=path.join(root,'scripting','projects',id,'pipeline.json');
}
const pipeline=JSON.parse(await fs.readFile(project,'utf8'));
const output=path.resolve(arg('--output-dir') ?? path.join(production,'outputs',pipeline.project_id || path.basename(path.dirname(project))));
await fs.mkdir(output,{recursive:true});
if (pipeline.review?.submission_started_at) throw new Error('This project already has an upload submission; do not render over its reviewed file.');
let clipsReady = pipeline.scenes.length > 0;
for(const scene of pipeline.scenes) {
  try { if(scene.status!=='done'||!(await fs.stat(path.join(output,`scene-${String(scene.scene_number).padStart(4,'0')}.mp4`))).size) clipsReady=false; } catch { clipsReady=false; }
}
if(!clipsReady) await script('cli.ts',['--project',project,'--user-data-dir',profile,'--output-dir',output]);
const completed=JSON.parse(await fs.readFile(project,'utf8'));
for(const scene of completed.scenes) {
  const file=path.join(output,`scene-${String(scene.scene_number).padStart(4,'0')}.mp4`);
  if(scene.status!=='done'||!(await fs.stat(file)).size) throw new Error(`Scene ${scene.scene_number} is incomplete; final render stopped.`);
}
await script('createNarrationManifest.ts',['--project',project,'--output-dir',output]);
await narrateManifest(path.join(output,'narration-manifest.json'),profile);
const music=path.join(output,'background-music.mp3');
try { if(!(await fs.stat(music)).size) throw new Error(); } catch { await script('freesound.ts',['--output',music]); }
await script('mixNarration.ts',['--input-dir',output,'--narration-dir',path.join(output,'narration'),'--manifest',path.join(output,'narration-manifest.json'),'--bgm',music,'--output',path.join(output,'final-narrated.mp4')]);
const final=path.join(output,'final.mp4');
const intro=path.resolve(root,process.env.CHANNEL_INTRO_PATH || 'production/assets/channel-intro.mp4');
const logo=path.resolve(root,process.env.CHANNEL_LOGO_PATH || 'production/assets/channel-logo.png');
await script('addTitle.ts',['--input',path.join(output,'final-narrated.mp4'),'--output',final,'--project',project,'--title',title || completed.idea?.selected?.title || 'Hindi Folk Horror','--intro',intro,'--logo',logo,'--defer-approval']);
await command('ffprobe',['-v','error','-show_entries','format=duration,size','-of','json',final]);
const delivery={ video_path:final, project_file:project, status:'awaiting_approval', chat_markdown:`![Completed video](<${final.replace(/\\/g,'/')}>)`, question:'Is this video good enough to upload to YouTube?' };
await fs.writeFile(path.join(output,'delivery.json'),JSON.stringify(delivery,null,2));
console.log(JSON.stringify({ event:'video_ready', ...delivery },null,2));
console.log('Codex: show chat_markdown in your response, then ask the approval question. The MP4 is already downloaded locally.');
