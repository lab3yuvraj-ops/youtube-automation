import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

test('setup retains intro.mp4 extension and supports JPG without touching real channel assets',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asset-setup-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'production/src'),{recursive:true});await fs.mkdir(path.join(dir,'production/assets'));await fs.mkdir(path.join(dir,'scripting'));
  await fs.writeFile(path.join(dir,'package.json'),'{"type":"module"}');
  await fs.copyFile('src/setupConfig.ts',path.join(dir,'production/src/setupConfig.ts'));
  await fs.writeFile(path.join(dir,'logo.jpg'),'logo');await fs.writeFile(path.join(dir,'intro.mp4'),'intro');
  const keys=['ZERNIO_API_KEY','ZERNIO_YOUTUBE_ACCOUNT_ID','OPENAI_API_KEY','GROQ_API_KEY','CHANNEL_LOGO_PATH','CHANNEL_INTRO_PATH','YOUTUBE_VISIBILITY'];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys) { if(old[key]===undefined) delete process.env[key];else process.env[key]=old[key]; }});
  Object.assign(process.env,{ZERNIO_API_KEY:'fake',ZERNIO_YOUTUBE_ACCOUNT_ID:'fake',OPENAI_API_KEY:'fake',CHANNEL_LOGO_PATH:'logo.jpg',CHANNEL_INTRO_PATH:'intro.mp4',YOUTUBE_VISIBILITY:'private'});
  const config=await import(pathToFileURL(path.join(dir,'production/src/setupConfig.ts')).href);
  await config.setup();
  assert.equal(await fs.readFile(path.join(dir,'production/assets/channel-intro.mp4'),'utf8'),'intro');
  assert.equal(await fs.readFile(path.join(dir,'production/assets/channel-logo.jpg'),'utf8'),'logo');
  await assert.rejects(fs.access(path.join(dir,'production/assets/channel-intro.mp4.png')));
});
