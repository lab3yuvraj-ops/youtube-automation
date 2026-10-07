import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const target=path.join(root,'scripting/.env');
try { await fs.copyFile(path.join(root,'scripting/.env.example'),target,constants.COPYFILE_EXCL); }
catch(error) { if(error.code!=='EEXIST') throw error; }
console.log(`Welcome to YouTube Automation! Please provide your channel logo image (PNG or JPG) and intro video (MP4, at least 5 seconds long, with audio).
Your private settings file is ${target}. Existing settings are preserved.`);
