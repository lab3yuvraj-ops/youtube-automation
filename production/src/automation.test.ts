import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FlowClient, FlowGenerationQueuedError } from './flowClient.js';
import { generateNarration } from './narration.js';
import type { Item } from './types.js';

test('current clip is downloaded despite historical queue text, approval happens once, resume does not submit again', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flow-regression-'));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});
  const page=await browser.newPage({acceptDownloads:true});
  await page.setContent(`<main><p>Old message: high demand, waiting in the queue</p><div><video src="https://test.invalid/old.mp4"></video><a download="old.mp4" href="data:application/octet-stream;base64,b2xk">Download</a></div><button aria-label="Start generation">Start</button><button id="approve" style="display:none">Approve</button><div id="new"></div></main>
  <script>window.submits=0; window.approvals=0;
  document.querySelector('[aria-label="Start generation"]').onclick=()=>{window.submits++;document.querySelector('#approve').style.display='block'};
  document.querySelector('#approve').onclick=()=>{window.approvals++;document.querySelector('#approve').remove();document.querySelector('#new').innerHTML='<video src="https://test.invalid/new.mp4"></video><a download="new.mp4" href="data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb20=">Download</a>'};</script>`);
  const item:Item={status:'pending'};let saves=0;
  const flow=new FlowClient(page,()=>{});await flow.bind(item,async()=>{saves++;},'video');
  await flow.generate();await flow.download(dir,'scene-0001.mp4');
  assert.equal(await page.evaluate(()=> (window as any).submits),1);
  assert.equal(await page.evaluate(()=> (window as any).approvals),1);
  assert.equal((await fs.readFile(path.join(dir,'scene-0001.mp4'))).toString('ascii',4,8),'ftyp');
  assert.ok(saves>=3);
  await flow.bind(item,async()=>{},'video');await flow.generate();
  assert.equal(await page.evaluate(()=> (window as any).submits),1);
});

test('only old media does not complete a submitted scene; interrupted prepared submission refuses regeneration', async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<main><video src="https://test.invalid/old.mp4"></video></main>');
  const item:Item={status:'pending',flow_generation:{phase:'submitted',url:'about:blank',started_at:'now',baseline:['https://test.invalid/old.mp4']}};
  const {waitGeneration}=await import('./generation.js');
  await assert.rejects(waitGeneration(page,item,'video',async()=>{},()=>{},10),FlowGenerationQueuedError);
  (item.flow_generation as any).phase='prepared';
  await assert.rejects(new FlowClient(page,()=>{}).bind(item,async()=>{},'video'),/duplicate credits/);
});

test('missing tile download uses the exact current media, never a gallery-wide older download',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scoped-download-'));const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});const page=await browser.newPage();
  const source='data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb20=';
  await page.setContent(`<main><video src="https://test.invalid/old.mp4"></video><button aria-label="Download old video" onclick="window.wrongDownload=true">Old download</button><div><video src="${source}"></video></div></main>`);
  const item:Item={status:'pending',flow_generation:{phase:'complete',url:'about:blank',baseline:['https://test.invalid/old.mp4'],source,started_at:'now'}};
  const flow=new FlowClient(page,()=>{});await flow.bind(item,async()=>{},'video');await flow.generate();await flow.download(dir,'scene-0001.mp4');
  assert.equal(await page.evaluate(()=>Boolean((window as any).wrongDownload)),false);
  assert.equal((await fs.readFile(path.join(dir,'scene-0001.mp4'))).toString('ascii',4,8),'ftyp');
});

test('AI Studio narration is filled and downloaded automatically as valid WAV',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'narration-regression-'));const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});
  const page=await browser.newPage();
  await page.setContent(`<label>Style instructions<textarea aria-label="Style instructions"></textarea></label><textarea aria-label="Text"></textarea><button>Run</button><audio></audio>
  <script>document.querySelector('button').onclick=()=>{const bytes=new Uint8Array(46);const view=new DataView(bytes.buffer);bytes.set([82,73,70,70]);view.setUint32(4,38,true);bytes.set([87,65,86,69],8);document.querySelector('audio').src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))};</script>`);
  const target=path.join(dir,'narration-0001.wav');await generateNarration(page,'यह कहानी है।','Calm Hindi narrator',target);
  assert.equal(await page.getByRole('textbox',{name:'Text',exact:true}).inputValue(),'यह कहानी है।');
  assert.equal((await fs.readFile(target)).toString('ascii',8,12),'WAVE');
});
