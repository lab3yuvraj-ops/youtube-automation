import fs from 'node:fs/promises'; import path from 'node:path'; import { Pipeline, Item } from './types.js'; import { FlowClient, FlowGenerationQueuedError } from './flowClient.js'; import { S } from './selectors.js';

async function save(file:string,p:Pipeline){ const tmp=file+'.tmp'; await fs.writeFile(tmp,JSON.stringify(p,null,2),'utf8'); await fs.rename(tmp,file); }
function retryable(item:Item){ return item.status!=='done'; }
function mark(item:Item,status:'done'|'failed',error?:unknown){ item.status=status; item.error=status==='failed'?String(error):null; item.updated_at=new Date().toISOString(); }
async function once(label:string,item:Item,fn:()=>Promise<void>,p:Pipeline,file:string,log:(e:string,d?:any)=>void){ if(!retryable(item)) return; try { log('start',{label}); await fn(); mark(item,'done'); log('done',{label}); } catch(e) { if (e instanceof FlowGenerationQueuedError) { item.status='pending'; item.error=String(e); item.updated_at=new Date().toISOString(); log('paused_for_flow_queue',{label,message:e.message}); throw e; } mark(item,'failed',e); log('failed',{label,error:String(e)}); throw e; } finally { await save(file,p); } }

export async function run(flow:FlowClient,page:any,p:Pipeline,file:string,out:string,log:(e:string,d?:any)=>void){
  await fs.mkdir(out,{recursive:true});
  // Current Flow agent UI has no All media or active model selector. Use its
  // composer as intended, with explicit media kind and reusable asset names.
  if(await flow.agentComposer()) {
    for(const [i,c] of p.characters.entries()) await once(`character:${i+1}`,c,async()=>{
      const resume=await flow.bind(c,()=>save(file,p),'image');
      if(!resume) await flow.agentPrompt(`Generate one 16:9 character reference IMAGE and save it as ${c.tag??c.name} for reuse in this project. Character appearance: ${c.full_prompt}. Voice identity for later videos: ${c.voice_description??'Native North Indian Hindi pronunciation'}.`);
      await flow.generate();
    },p,file,log);
    for(const [i,b] of p.backgrounds.entries()) await once(`background:${i+1}`,b,async()=>{
      const resume=await flow.bind(b,()=>save(file,p),'image');
      if(!resume) await flow.agentPrompt(`Generate one empty 16:9 background IMAGE and save it as ${b.tag??b.location_name} for reuse in this project: ${b.full_prompt}`);
      await flow.generate();
    },p,file,log);
    for(const s of [...p.scenes].sort((a,b)=>Number(a.scene_number)-Number(b.scene_number))) {
      const filename=`scene-${String(s.scene_number).padStart(4,'0')}.mp4`;
      if(s.status==='done') { try { if(!(await fs.stat(path.join(out,filename))).size) throw new Error(); } catch { if(!s.flow_generation) throw new Error(`Scene ${s.scene_number} is done but has no local download or saved media reference.`);s.status='pending'; } }
      await once(`scene:${s.scene_number}`,s,async()=>{
        if(!s.flow_generation && /FLOW_GENERATION_QUEUED|scheduled.*high demand/i.test(String(s.error??''))) s.flow_generation_resume_required=true;
        if(s.flow_generation_resume_required && !s.flow_generation) throw new Error(`Recover the existing submission reference for scene ${s.scene_number}; refusing a duplicate generation.`);
        const resume=await flow.bind(s,()=>save(file,p),'video');
        if(!resume) {
          const narrator=s.speaker==='NARRATOR'||s.speaker==='none';
          const assets=s.assets as any;
          await flow.agentPrompt(`Generate exactly one 16:9 VIDEO scene using the saved reference assets ${assets?.background_tag??s.background_tag} ${(assets?.character_tags??s.character_tags??[]).join(' ')}. Preserve their appearances. Use a natural duration sufficient for all actions and dialogue. ${narrator?s.animation_prompt_NARRATOR_ONLY:s.animation_prompt_WITH_lipsync}`);
        }
        await flow.generate();await flow.download(out,filename);
      },p,file,log);
    }
    return;
  }
  for(const [i,c] of p.characters.entries()) await once(`character:${i+1}`,c,async()=>{ const resume = await flow.bind(c,()=>save(file,p),'image'); if(!resume) { await flow.click(S.addMedia); await flow.click(S.addCharacter); await flow.prompt(String(c.full_prompt)); } await flow.generate(); await flow.rename(String(c.tag??c.name)); const look=String(c.look_summary??''); const voice=(c.voice??{}) as any; const gender=voice.gender??(look.match(/\b(female|woman|girl|स्त्री|महिला)\b/i)?'female':'male'); const age=String(voice.age??(look.match(/\b\d{2}\s*(?:year|yr|वर्ष)/i)?.[0]??'')); const descriptor=String(voice.descriptor??(look.match(/(?:region|accent|लहजा|क्षेत्र)[^,.;]*/i)?.[0]??'उत्तर भारतीय लहजा')); await flow.configureVoice({gender,age,descriptor,name:String(c.name??c.tag)}); },p,file,log);
  for(const [i,b] of p.backgrounds.entries()) await once(`background:${i+1}`,b,async()=>{ const resume = await flow.bind(b,()=>save(file,p),'image'); if(!resume) { await flow.click(S.allMedia); await flow.prompt(String(b.full_prompt)); await flow.click(S.aspect16x9); } await flow.generate(); await flow.rename(String(b.tag??b.location_name)); },p,file,log);
  const scenes=[...p.scenes].sort((a,b)=>Number(a.scene_number)-Number(b.scene_number));
  for(const s of scenes) {
    const clip = path.join(out,`scene-${String(s.scene_number).padStart(4,'0')}.mp4`);
    if(s.status==='done') { try { if((await fs.stat(clip)).size === 0) throw new Error(); } catch { if(!s.flow_generation) throw new Error(`Completed scene ${s.scene_number} is missing its download and has no saved generation reference. Recover that existing clip before resuming.`); s.status='pending'; } }
    await once(`scene:${s.scene_number}`,s,async()=>{
      if(!s.flow_generation && /FLOW_GENERATION_QUEUED|scheduled.*high demand/i.test(String(s.error??''))) s.flow_generation_resume_required=true;
      if(s.flow_generation_resume_required && !s.flow_generation) throw new Error(`Scene ${s.scene_number} was submitted by an older runner. Its generation URL must be recovered before continuing; refusing to submit a duplicate.`);
      const resume = await flow.bind(s,()=>save(file,p),'video');
      if(!resume) { const narrator=s.speaker==='NARRATOR'||s.speaker==='none'; const prompt=narrator?s.animation_prompt_NARRATOR_ONLY:s.animation_prompt_WITH_lipsync; const assets=s.assets as any; await flow.click(S.addMedia); await flow.click(S.addScene); await flow.prompt(String(prompt)); await flow.selectAsset(String(assets?.background_tag), String(p.backgrounds.find(b=>b.tag===assets?.background_tag)?.full_prompt??'')); for(const tag of (assets?.character_tags??[])) await flow.selectAsset(String(tag),String(p.characters.find(c=>c.tag===tag)?.full_prompt??'')); await flow.click(S.aspect16x9); }
      await flow.generate(); await flow.download(out,path.basename(clip));
    },p,file,log);
  }
}
