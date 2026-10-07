// Runs unchanged in macOS Terminal and Windows PowerShell. No shell commands.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++) if(['--project','--output-dir','--user-data-dir'].includes(args[i]) && args[i+1]) { args[i+1]=path.resolve(args[i+1]);i++; }
const child=spawn(process.execPath,['--use-system-ca','--import','tsx',path.join(root,'production/src/workflow.ts'),...args],{cwd:path.join(root,'production'),stdio:'inherit',shell:false});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
