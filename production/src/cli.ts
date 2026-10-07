import fs from 'node:fs/promises'; import path from 'node:path'; import { start } from './flowClient.js'; import { run } from './runner.js'; import { Pipeline } from './types.js'; import { loadEnvironment } from './setupConfig.js';
function arg(name:string, fallback?:string){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]??fallback:fallback; }
await loadEnvironment();
const file=path.resolve(arg('--project')??'../scripting/projects/example/pipeline.json'); const out=path.resolve(arg('--output-dir')??'outputs'); const profile=path.resolve(arg('--user-data-dir')??'.chrome-profile');
const p=JSON.parse(await fs.readFile(file,'utf8')) as Pipeline; const logFile=path.join(out,'run.log.jsonl'); await fs.mkdir(out,{recursive:true});
const log=async(e:string,d:any={})=>{const row=JSON.stringify({at:new Date().toISOString(),event:e,...d}); console.log(row); await fs.appendFile(logFile,row+'\n');};
const projectUrl = p.flow_project_url as string | undefined;
const url=process.env.FLOW_URL ?? projectUrl ?? (process.env.FLOW_PROJECT_ID ? `https://flow.google.com/project/${encodeURIComponent(process.env.FLOW_PROJECT_ID)}` : 'https://labs.google/flow');
const {context,page,flow}=await start(url,profile,log);
try { p.flow_project_url=page.url(); const tmp=file+'.tmp'; await fs.writeFile(tmp,JSON.stringify(p,null,2)); await fs.rename(tmp,file); await run(flow,page,p,file,out,log); }
catch(error) { await page.screenshot({path:path.join(out,'flow-error.png'),fullPage:true}).catch(()=>{}); throw error; }
finally { await context.close(); }
