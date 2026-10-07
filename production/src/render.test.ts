import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
test('real FFmpeg preserves long narration and produces review-ready branded MP4 without uploading',async t=>{
  try { await exec('ffmpeg',['-version']);await exec('ffprobe',['-version']); } catch { t.skip('FFmpeg/ffprobe are not installed');return; }
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'render regression '));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const narration=path.join(dir,'narration');await fs.mkdir(narration);
  async function video(file:string,color:string,duration:string) {
    await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30:d=${duration}`,'-f','lavfi','-i',`sine=frequency=220:duration=${duration}`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file]);
  }
  await video(path.join(dir,'scene-0001.mp4'),'black','1');await video(path.join(dir,'scene-0002.mp4'),'blue','1');
  await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2.4',path.join(narration,'narration-0001.wav')]);
  const manifest=path.join(dir,'manifest.json');await fs.writeFile(manifest,JSON.stringify({scenes:[{scene_number:1}]}));
  const mixed=path.join(dir,'mixed.mp4');
  await exec(process.execPath,['--import','tsx','src/mixNarration.ts','--input-dir',dir,'--narration-dir',narration,'--manifest',manifest,'--output',mixed],{maxBuffer:8*1024*1024});
  const probe=async(file:string)=>JSON.parse((await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','json',file])).stdout);
  assert.ok(Number((await probe(mixed)).format.duration)>3.2,'Narration should not be cut to the one-second visual');
  const intro=path.join(dir,'intro.mp4');await video(intro,'red','5');
  const logo=path.join(dir,'logo.jpg');await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=white:s=64x64','-frames:v','1',logo]);
  const project=path.join(dir,'pipeline.json');await fs.writeFile(project,'{}');
  const final=path.join(dir,'final.mp4');
  await exec(process.execPath,['--import','tsx','src/addTitle.ts','--input',mixed,'--intro',intro,'--logo',logo,'--output',final,'--project',project,'--title','Render test','--defer-approval'],{maxBuffer:8*1024*1024});
  assert.ok(Number((await probe(final)).format.duration)>7.7);
  const review=JSON.parse(await fs.readFile(project,'utf8')).review;
  assert.equal(review.status,'awaiting_approval');assert.equal(review.video_path,final);assert.ok(review.video_sha256);assert.equal(review.submission_started_at,undefined);
  // Run the whole resumed workflow from a separate repository copy. It must
  // reuse downloaded clips/audio, resolve root-relative paths, finish all stages,
  // and emit chat delivery without ever opening Google or publishing.
  const repo=path.join(dir,'isolated repo');await fs.mkdir(path.join(repo,'production/assets'),{recursive:true});await fs.mkdir(path.join(repo,'scripting'));
  await fs.cp('src',path.join(repo,'production/src'),{recursive:true});
  await fs.copyFile('package.json',path.join(repo,'production/package.json'));
  await fs.copyFile('../start-video.mjs',path.join(repo,'start-video.mjs'));
  await fs.symlink(path.resolve('node_modules'),path.join(repo,'production/node_modules'),process.platform==='win32'?'junction':'dir');
  const output=path.join(repo,'existing output');await fs.mkdir(path.join(output,'narration'),{recursive:true});
  await fs.copyFile(path.join(dir,'scene-0001.mp4'),path.join(output,'scene-0001.mp4'));await fs.copyFile(path.join(dir,'scene-0002.mp4'),path.join(output,'scene-0002.mp4'));
  for(const scene of [1,2]) await fs.copyFile(path.join(narration,'narration-0001.wav'),path.join(output,'narration',`narration-${String(scene).padStart(4,'0')}.wav`));
  await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=110:duration=3',path.join(output,'background-music.mp3')]);
  await fs.writeFile(path.join(repo,'pipeline.json'),JSON.stringify({project_id:'regression',characters:[],backgrounds:[],idea:{selected:{title:'Resume render'}},scenes:[1,2].map(scene_number=>({scene_number,status:'done',speaker:'NARRATOR',narration_text:'यह कहानी है।'}))}));
  const result=await exec(process.execPath,['start-video.mjs','--project','pipeline.json','--output-dir','existing output'],{cwd:repo,maxBuffer:8*1024*1024,env:{...process.env,OPENAI_API_KEY:'fake',GROQ_API_KEY:'',ZERNIO_API_KEY:'fake',ZERNIO_YOUTUBE_ACCOUNT_ID:'fake',YOUTUBE_VISIBILITY:'private',CHANNEL_LOGO_PATH:logo,CHANNEL_INTRO_PATH:intro}});
  assert.match(result.stdout,/video_ready/);assert.match(result.stdout,/All narration already downloaded/);
  const delivery=JSON.parse(await fs.readFile(path.join(output,'delivery.json'),'utf8'));
  assert.equal(delivery.video_path,path.join(output,'final.mp4'));assert.match(delivery.chat_markdown,/Completed video/);assert.equal(delivery.status,'awaiting_approval');
});
