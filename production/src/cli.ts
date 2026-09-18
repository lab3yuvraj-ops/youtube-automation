import fs from 'node:fs/promises'; import path from 'node:path'; import { start } from './flowClient.js'; import { run } from './runner.js'; import { Pipeline } from './types.js';
function arg(name:string, fallback?:string){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]??fallback:fallback; }
const file=path.resolve(arg('--project')??'../scripting/projects/example/pipeline.json'); const out=path.resolve(arg('--output-dir')??'outputs'); const profile=path.resolve(arg('--user-data-dir')??'.chrome-profile'); const url=process.env.FLOW_URL??'https://labs.google/flow';
const p=JSON.parse(await fs.readFile(file,'utf8')) as Pipeline; const logFile=path.join(out,'run.log.jsonl'); await fs.mkdir(out,{recursive:true});
const log=async(e:string,d:any={})=>{const row=JSON.stringify({at:new Date().toISOString(),event:e,...d}); console.log(row); await fs.appendFile(logFile,row+'\n');};
const {context,page,flow}=await start(url,profile,log); try { await page.waitForLoadState('networkidle'); await run(flow,page,p,file,out,log); } finally { await context.close(); }
