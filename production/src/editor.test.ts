import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sceneRole, timing, validateSceneMapping, continuityWarnings } from './editorPlan.js';
import { narrationIdentity, saveNarrationIdentity, verifyNarrationIdentity } from './narrationIdentity.js';
import { saveSceneIdentity, verifySceneIdentity } from './sceneIdentity.js';
const exec=promisify(execFile);

test('speaker mapping rejects narrator on a character, duplicates and missing clips; none may be music',()=>{
  const scenes=[{scene_number:1,speaker:'@CHAR-01-ROHAN'},{scene_number:3,speaker:'NARRATOR',narration_text:'कहानी'},{scene_number:4,speaker:'none'}];
  assert.equal(sceneRole(scenes[2]),'music');
  assert.doesNotThrow(()=>validateSceneMapping(scenes,[1,3,4],[3]));
  assert.throws(()=>validateSceneMapping(scenes,[1,3,4],[1,3]),/replace or overlap/);
  assert.throws(()=>validateSceneMapping(scenes,[1,3],[3]),/Missing video/);
  assert.throws(()=>validateSceneMapping([scenes[0],scenes[0]],[1],[]),/unique/);
  assert.throws(()=>validateSceneMapping(scenes,[1,3,4,9],[3]),/Unexpected clip/);
  assert.equal(timing(scenes[0],5).duration,5);
  assert.equal(timing({...scenes[0],edit:{dialogue_offset_seconds:0.5}},5).duration,5.5);
  assert.equal(timing(scenes[1],1,3).duration,3.25);
  assert.throws(()=>timing({...scenes[0],edit:{trim_start_seconds:4,trim_end_seconds:2}},5),/Invalid/);
  assert.equal(continuityWarnings([{...scenes[0],background_tag:'room'},{...scenes[2],background_tag:'forest'}]).length,1);
});

test('narration reuse detects changed text, voice settings, and audio content',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-identity-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'voice.wav');await fs.writeFile(file,'audio');
  const identity=narrationIdentity('सही वाक्य','Hindi narrator','same-voice');
  await saveNarrationIdentity(file,identity);assert.equal(await verifyNarrationIdentity(file,identity),true);
  await assert.rejects(verifyNarrationIdentity(file,narrationIdentity('गलत वाक्य','Hindi narrator','same-voice')),/changed/);
  await assert.rejects(verifyNarrationIdentity(file,narrationIdentity('सही वाक्य','Hindi narrator','other-voice')),/changed/);
  await fs.writeFile(file,'different audio');await assert.rejects(verifyNarrationIdentity(file,identity),/audio changed/);
});

test('download provenance catches swapped backgrounds, speakers and files',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scene-identity-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'scene.mp4');await fs.writeFile(file,'source clip');
  const scene={scene_number:1,speaker:'@CHAR-01-ROHAN',background_tag:'dining room',devanagari_dialogue:'दादी'};
  await saveSceneIdentity(file,scene);assert.equal(await verifySceneIdentity(file,scene),true);
  await assert.rejects(verifySceneIdentity(file,{...scene,background_tag:'forest'}),/background references changed/);
  await assert.rejects(verifySceneIdentity(file,{...scene,speaker:'NARRATOR'}),/speaker/);
  await fs.writeFile(file,'unrelated clip');await assert.rejects(verifySceneIdentity(file,scene),/clip differs/);
});

test('real edit preserves dialogue timing, permits measured repair, and fills a music-only scene',async t=>{
  try { await exec('ffmpeg',['-version']); } catch { t.skip('FFmpeg missing');return; }
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'speaker-edit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const character=path.join(dir,'scene-0001.mp4'),blank=path.join(dir,'scene-0003.mp4');
  // Character source has 0.5 seconds of quiet before dialogue. The editor must
  // not silently move it or use a narrator file. A measured correction is explicit.
  await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=160x90:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=1.5','-af','adelay=500:all=1','-c:v','libx264','-c:a','aac','-shortest',character]);
  await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=1','-c:v','libx264',blank]);
  const music=path.join(dir,'music.wav');await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=110:duration=1',music]);
  const project=path.join(dir,'project.json');
  const data={characters:[{tag:'@CHAR-01-ROHAN'}],scenes:[{scene_number:1,speaker:'@CHAR-01-ROHAN'},{scene_number:3,speaker:'none'}]};
  await fs.writeFile(project,JSON.stringify(data));
  const output=path.join(dir,'result.mp4');
  const render=async()=>exec(process.execPath,['--import','tsx','src/mixNarration.ts','--project',project,'--input-dir',dir,'--output',output,'--bgm',music],{maxBuffer:8*1024*1024});
  await render();
  const report=JSON.parse(await fs.readFile(`${output}.edit-report.json`,'utf8'));
  assert.equal(report.scenes[1].timeline_start_seconds,report.scenes[0].duration);
  assert.equal(report.scenes[1].audio_source,'background music');
  assert.equal(report.scenes[0].dialogueOffset,0);
  const rms=async(file:string,start:number,length:number)=>{
    const result=await exec('ffmpeg',['-v','error','-ss',String(start),'-i',file,'-t',String(length),'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:4*1024*1024});
    const pcm=result.stdout;let sum=0;for(let i=0;i+4<=pcm.length;i+=4) sum+=pcm.readFloatLE(i)**2;return Math.sqrt(sum/(pcm.length/4));
  };
  assert.ok(await rms(output,2.2,0.3)>0.005,'Music must be present in the blank scene');
  // Speech after the seam would put a 440 Hz tone into the music-only shot.
  const frequency=async(start:number)=>{
    const result=await exec('ffmpeg',['-v','error','-ss',String(start),'-i',output,'-t','0.3','-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer'});
    let crosses=0;const p=result.stdout;for(let i=4;i+4<=p.length;i+=4) if(p.readFloatLE(i-4)<0&&p.readFloatLE(i)>=0) crosses++;return crosses/0.3;
  };
  assert.ok(Math.abs(await frequency(2.2)-110)<10,'Only music, with no prior speaker bleeding across the cut');
  assert.ok(Math.abs(await frequency(0.1)-110)<10,'Default edit preserves the original pre-dialogue timing');
  assert.ok(Math.abs(await frequency(0.7)-440)<15,'Original character speech stays on its source picture clock');
  const sourceQuiet=await rms(character,0.1,0.2);assert.ok(sourceQuiet<0.001);
  data.scenes[0]={...data.scenes[0],edit:{dialogue_offset_seconds:-0.5}} as any;
  await fs.writeFile(project,JSON.stringify(data));await render();
  assert.ok(await rms(output,0.1,0.2)>0.015,'Measured correction should advance delayed dialogue');
  await fs.mkdir(path.join(dir,'narration'));await fs.copyFile(music,path.join(dir,'narration/narration-0001.wav'));
  await assert.rejects(render(),/replace or overlap/);
  // A narrator render must remove the original character tone (440 Hz), and
  // conservative leading-silence cleanup must start the intended 880 Hz voice.
  await exec('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=880:duration=1','-af','adelay=500:all=1',path.join(dir,'narration/narration-0001.wav')]);
  data.scenes[0]={scene_number:1,speaker:'NARRATOR',narration_text:'सही वाक्य'} as any;
  await fs.writeFile(project,JSON.stringify(data));await render();
  assert.ok(Math.abs(await frequency(0.15)-880)<15,'Correct narrator starts without source dialogue or a half-second delay');
});
