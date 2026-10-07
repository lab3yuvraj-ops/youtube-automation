import { chromium, Page, Download } from 'playwright';
import { S } from './selectors.js';

export class FlowGenerationQueuedError extends Error {
  constructor(message = 'Flow scheduled this generation because of high demand.') {
    super(message);
    this.name = 'FlowGenerationQueuedError';
  }
}

export class FlowClient {
  constructor(private page:Page, private log:(e:string,d?:any)=>void) {}
  async first(candidates: readonly string[], timeout=15000) { for (const s of candidates) { const l=this.page.locator(s).first(); try { await l.waitFor({state:'visible',timeout}); return l; } catch {} } throw new Error(`Selector not found: ${candidates.join(' | ')}`); }
  async click(candidates:readonly string[]) { await (await this.first(candidates)).click(); }
  async fill(candidates:readonly string[], text:string) { const l=await this.first(candidates); await l.fill(text); }
  async waitComplete(timeout=300000) { await this.first(S.completed, timeout); }
  async prompt(text:string) { await this.fill(S.promptInput,text); }
  async generate() {
    await this.click(S.submit);
    const queueNotice = this.page.getByText(/(?:high demand|scheduled|queued|try again later)/i).last();
    const result = await Promise.race([
      this.first(S.completed, 300000).then(() => 'complete' as const),
      queueNotice.waitFor({state:'visible', timeout:300000}).then(() => 'queued' as const),
    ]);
    if (result === 'complete') return;

    const minutes = Number(process.env.FLOW_QUEUE_WAIT_MINUTES ?? '30');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
      throw new Error('FLOW_QUEUE_WAIT_MINUTES must be between 1 and 120.');
    }
    this.log('flow_generation_queued', {
      message: 'Flow queued the existing generation. Waiting without submitting another request.',
      waitMinutes: minutes,
    });
    try {
      await this.first(S.completed, minutes * 60_000);
    } catch {
      throw new FlowGenerationQueuedError(
        `Flow is still queued after ${minutes} minutes. Rerun later; the pipeline will resume without regenerating completed items.`,
      );
    }
  }
  async rename(name:string) { await this.click(S.options); await this.click(S.rename); await this.fill(S.nameInput,name); await this.click(S.save); }
  async configureVoice(voice:{gender?:string;age?:string;descriptor?:string;name?:string}) {
    await this.click(S.voice);
    if ((voice.gender??'').toLowerCase().startsWith('f')) await this.click(S.femaleVoice); else await this.click(S.maleVoice);
    await this.click(S.customizePerformance);
    if (voice.age) await this.fill(S.ageInput,voice.age);
    if (voice.descriptor) await this.fill(S.descriptorInput,voice.descriptor);
    if (voice.name) await this.fill(S.voiceNameInput,voice.name);
    await this.click(S.saveNewVoice); await this.waitComplete(180000); await this.click(S.addToCharacter);
  }
  async selectAsset(tag:string) {
    // Use the visible picker result, never a brittle keyboard shortcut.
    await this.click(S.promptInput); await this.page.keyboard.type(tag);
    const result=this.page.getByText(tag,{exact:true}).last(); await result.waitFor({state:'visible',timeout:15000}); await result.click();
  }
  async download(output:string, filename:string) { const link=await this.first(S.download); const [download]=await Promise.all([this.page.waitForEvent('download'),link.click()]); await download.saveAs(`${output}/${filename}`); }
}

export async function start(url:string, userDataDir:string, log:(e:string,d?:any)=>void) {
  const context=await chromium.launchPersistentContext(userDataDir,{headless:false,acceptDownloads:true});
  const page=context.pages()[0] ?? await context.newPage(); await page.goto(url,{waitUntil:'domcontentloaded'}); return {context,page,flow:new FlowClient(page,log)};
}
