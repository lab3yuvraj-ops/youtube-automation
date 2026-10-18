/** Speaker-aware editor. Dialogue stays on its original picture clock. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { timing, validateSceneMapping, continuityWarnings, type EditScene } from './editorPlan.js';
import { narrationIdentity, verifyNarrationIdentity } from './narrationIdentity.js';
import { verifySceneIdentity } from './sceneIdentity.js';

const exec=promisify(execFile);
const arg=(name:string,fallback?:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]??fallback;};
const inputDir=path.resolve(arg('--input-dir','outputs')!);
const narrationDir=path.resolve(arg('--narration-dir',path.join(inputDir,'narration'))!);
const output=path.resolve(arg('--output',path.join(inputDir,'final-narrated.mp4'))!);
const bgm=arg('--bgm')?path.resolve(arg('--bgm')!):undefined;
const bgmLufs=Number(arg('--bgm-lufs','-20.9'));
const transition=Number(arg('--transition','0.35'));
if(!Number.isFinite(bgmLufs)||bgmLufs> -5||bgmLufs< -40) throw new Error('--bgm-lufs must be between -40 and -5.');
if(!Number.isFinite(transition)||transition<0) throw new Error('--transition must be zero or greater.');
if(arg('--transition') && transition>0) console.warn('Speaker-aware editing uses cuts to protect speech timing; --transition is retained for CLI compatibility but does not overlap dialogue.');
if(arg('--narration-makeup-db')) console.warn('Narration now uses a -14 LUFS loudness target; manual makeup gain is no longer applied.');
const names=(await fs.readdir(inputDir)).filter(n=>/^scene-\d{4}\.mp4$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
if(!names.length) throw new Error('No scene-####.mp4 files found.');
const numbers=names.map(n=>Number(/scene-(\d+)/i.exec(n)![1]));
const clips=names.map(n=>path.join(inputDir,n));
const narration=new Map<number,string>();
try {
  for(const name of await fs.readdir(narrationDir)) {
    const match=/^narration-(\d{4})\.(wav|mp3|m4a|aac|ogg)$/i.exec(name);
    if(!match) continue;
    const number=Number(match[1]);
    if(narration.has(number)) throw new Error(`Multiple narration files for scene ${number}; choose the verified one.`);
    narration.set(number,path.join(narrationDir,name));
  }
} catch(error:any) { if(error.code!=='ENOENT') throw error; }
const projectFile=arg('--project');
const inputWarnings:string[]=[];
let scenes:EditScene[];
if(projectFile) {
  const project=JSON.parse(await fs.readFile(path.resolve(projectFile),'utf8'));
  scenes=[...project.scenes].sort((a,b)=>Number(a.scene_number)-Number(b.scene_number));
  const characters=new Set((project.characters??[]).map((c:any)=>c.tag));
  for(const scene of scenes) if(!['none','NARRATOR'].includes(scene.speaker)&&!characters.has(scene.speaker)) throw new Error(`Unknown character speaker ${scene.speaker} in scene ${scene.scene_number}.`);
  validateSceneMapping(scenes,numbers,[...narration.keys()]);
  for(let i=0;i<scenes.length;i++) if(!await verifySceneIdentity(clips[i],scenes[i])) inputWarnings.push(`Scene ${scenes[i].scene_number} is an older download without a scene fingerprint; review its actual speaker and setting before approval.`);
} else {
  // Preserve the standalone command, but use strict speaker metadata in the full workflow.
  console.warn('No --project supplied: roles inferred from filenames; speaker/continuity checks unavailable.');
  scenes=numbers.map(scene_number=>({scene_number,speaker:narration.has(scene_number)?'NARRATOR':'legacy-character'}));
  const manifest=arg('--manifest');
  if(manifest) for(const scene of JSON.parse(await fs.readFile(path.resolve(manifest),'utf8')).scenes) if(!narration.has(scene.scene_number)||!numbers.includes(scene.scene_number)) throw new Error(`Missing clip or narration for scene ${scene.scene_number}.`);
  for(const n of narration.keys()) if(!numbers.includes(n)) throw new Error(`Orphan narration for scene ${n}.`);
}
if(bgm) await fs.access(bgm);
const probe=async(file:string)=>{
  const data=JSON.parse((await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file])).stdout);
  const video=data.streams.find((s:any)=>s.codec_type==='video');
  const duration=Number(video?.duration??data.format.duration);
  if(!Number.isFinite(duration)||duration<=0) throw new Error(`Invalid duration: ${path.basename(file)}`);
  const audio=data.streams.find((s:any)=>s.codec_type==='audio');
  return {duration,hasAudio:Boolean(audio),video,audioStart:Number(audio?.start_time??0),videoStart:Number(video?.start_time??0)};
};
const media=await Promise.all(clips.map(probe));
const voiceInputs=[...narration.entries()].sort(([a],[b])=>a-b);
const manifestPath=arg('--manifest');
if(manifestPath) {
  const manifest=JSON.parse(await fs.readFile(path.resolve(manifestPath),'utf8'));
  for(const scene of manifest.scenes) {
    const file=narration.get(scene.scene_number);
    if(file && !await verifyNarrationIdentity(file,narrationIdentity(scene.text??'',manifest.voice_direction,manifest.voice_name))) inputWarnings.push(`Narration ${scene.scene_number} is a legacy file without a content/voice fingerprint; listen before approval.`);
  }
}
const voiceMedia=new Map(await Promise.all(voiceInputs.map(async([number,file])=>[number,await probe(file)] as const)));
for(const [number,voice] of voiceMedia) if(!voice.hasAudio) throw new Error(`Narration ${number} has no audio stream.`);
const voiceIndex=new Map(voiceInputs.map(([n],i)=>[n,clips.length+i]));
const plans=scenes.map((s,i)=>timing(s,media[i].duration,voiceMedia.get(s.scene_number)?.duration));
const width=Number(media[0].video.width),height=Number(media[0].video.height);
const graph:string[]=[];
for(let i=0;i<scenes.length;i++) {
  const plan=plans[i],scene=scenes[i],voice=voiceIndex.get(scene.scene_number);
  if(plan.role==='character'&&!media[i].hasAudio) throw new Error(`Character scene ${scene.scene_number} has no synchronized source audio. Regenerate or repair that source scene.`);
  // Never stretch a speaking character's mouth movement. Narrator/silent
  // shots keep their original motion and hold the last frame only if needed.
  const hold=Math.max(0,plan.duration-plan.sourceDuration);
  graph.push(`[${i}:v]trim=start=${plan.start}:end=${plan.end},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=30,settb=AVTB,setsar=1${hold?`,tpad=stop_mode=clone:stop_duration=${hold}`:''},trim=duration=${plan.duration}[v${i}]`);
  if(plan.role==='character') {
    const correction=plan.dialogueOffset<0?`atrim=start=${-plan.dialogueOffset},asetpts=PTS-STARTPTS,`:plan.dialogueOffset>0?`adelay=${plan.dialogueOffset*1000}:all=1,`:'';
    // Apply measured audio correction on the source clock, then cut audio/video
    // at the exact same edit boundaries. No independent speech normalization of PTS.
    graph.push(`[${i}:a]aresample=48000:async=1:first_pts=0,${correction}atrim=start=${plan.start}:end=${plan.end+Math.max(0,plan.dialogueOffset)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${plan.duration}[a${i}]`);
  } else if(plan.role==='narrator') {
    const offset=plan.narrationOffset?`,adelay=${plan.narrationOffset*1000}:all=1`:'';
    // Replace generated speech/ambience here: unwanted Flow voices cannot leak
    // through under the intended narrator. Music fills all remaining space.
    graph.push(`[${voice}:a]aresample=48000:async=1:first_pts=0,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB:start_silence=0.08,asetpts=PTS-STARTPTS,loudnorm=I=-14:TP=-2:LRA=7,aformat=sample_fmts=fltp:channel_layouts=stereo${offset},apad,atrim=duration=${plan.duration}[a${i}]`);
  } else graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${plan.duration}[a${i}]`);
}
// Speech never overlaps the next speaker or the next background. Hard cuts
// preserve every source frame and spoken syllable; the music remains continuous.
graph.push(`${scenes.map((_,i)=>`[v${i}][a${i}]`).join('')}concat=n=${scenes.length}:v=1:a=1[storyvideo][storyaudio]`);
let audio='storyaudio';
const total=plans.reduce((sum,p)=>sum+p.duration,0);
if(bgm) {
  const musicIndex=clips.length+voiceInputs.length;
  graph.push(`[storyaudio]asplit=2[foreground][speechsidechain]`);
  graph.push(`[${musicIndex}:a]aresample=48000,loudnorm=I=${bgmLufs}:TP=-5:LRA=7,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total},asetpts=PTS-STARTPTS[music]`);
  graph.push(`[music][speechsidechain]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[duckedmusic]`);
  graph.push(`[foreground][duckedmusic]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0[mixedaudio]`);
  audio='mixedaudio';
} else if(plans.some(p=>p.role==='music')) throw new Error('Music-only scenes require --bgm.');
const warnings=[...inputWarnings,...continuityWarnings(scenes)];
for(let i=0;i<scenes.length;i++) if(plans[i].role==='character' && Math.abs(media[i].audioStart-media[i].videoStart)>0.15) warnings.push(`Scene ${scenes[i].scene_number}: source audio/video streams begin at different timestamps. Inspect mouth movement against speech before approval.`);
for(const warning of warnings) console.warn(warning);
await fs.mkdir(path.dirname(output),{recursive:true});
const temp=path.join(path.dirname(output),`${path.basename(output,'.mp4')}.rendering.mp4`);
await exec('ffmpeg',['-v','error','-y',...clips.flatMap(file=>['-i',file]),...voiceInputs.flatMap(([,file])=>['-i',file]),...(bgm?['-stream_loop','-1','-i',bgm]:[]),'-filter_complex',graph.join(';'),'-map','[storyvideo]','-map',`[${audio}]`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',temp],{maxBuffer:8*1024*1024});
await fs.rename(temp,output);
const report={output,project_file:projectFile?path.resolve(projectFile):undefined,duration_seconds:total,scene_transitions:'cuts; speech never overlaps scenes',warnings,scenes:scenes.map((s,i)=>({scene_number:s.scene_number,speaker:s.speaker,background:s.assets?.background_tag??s.background_tag,audio_source:plans[i].role==='character'?clips[i]:plans[i].role==='narrator'?narration.get(s.scene_number):'background music',source_audio_start_seconds:media[i].audioStart,source_video_start_seconds:media[i].videoStart,...plans[i],timeline_start_seconds:plans.slice(0,i).reduce((sum,p)=>sum+p.duration,0)})),limitations:['Source lip sync, speaker identity, spoken words and visual continuity require source review; waveform timing cannot verify mouth movement or identity.']};
await fs.writeFile(`${output}.edit-report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,edit_report:`${output}.edit-report.json`,durationSeconds:total,clips:scenes.length,backgroundReviewWarnings:warnings.length}));
