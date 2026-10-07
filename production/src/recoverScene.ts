import fs from 'node:fs/promises';
import path from 'node:path';
import { loadProject, saveProject } from './reviewState.js';
// Used by the agent after identifying a specific existing result in the UI.
// Input is a local JSON file so signed media URLs are not exposed in arguments.
const index=process.argv.indexOf('--reference');
if(index<0||!process.argv[index+1]) throw new Error('Pass --reference <local JSON file> with project_file, scene_number, flow_url, media_source.');
const reference=JSON.parse(await fs.readFile(path.resolve(process.argv[index+1]),'utf8'));
const url=new URL(reference.flow_url);
if(url.protocol!=='https:'||!['flow.google.com','labs.google'].includes(url.hostname)) throw new Error('Recovery must point to the verified Google Flow page.');
if(!reference.media_source || typeof reference.media_source!=='string') throw new Error('An exact media source from the verified scene is required.');
const file=path.resolve(reference.project_file);const project=await loadProject(file);
if(project.review?.submission_started_at) throw new Error('This project was already submitted to YouTube.');
const scene=(project.scenes as any[]).find(s=>Number(s.scene_number)===Number(reference.scene_number));
if(!scene) throw new Error('Scene number not found.');
if(scene.status==='done') throw new Error('This scene is already done; use its existing local file.');
if(scene.flow_generation?.source && scene.flow_generation.source!==reference.media_source) throw new Error('Scene already has a different saved media reference. Inspect before changing it.');
scene.flow_generation={url:reference.flow_url,baseline:[],source:reference.media_source,started_at:new Date().toISOString(),phase:'complete'};
delete scene.flow_generation_resume_required;scene.status='pending';scene.error=null;
await saveProject(file,project);
console.log('Verified scene reference saved. Resume the existing project to download it; no generation was submitted.');
