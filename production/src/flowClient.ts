import { chromium, Page, Download } from 'playwright';
import { S } from './selectors.js';

export class FlowClient {
  constructor(private page:Page, private log:(e:string,d?:any)=>void) {}
  async first(candidates: readonly string[], timeout=15000) { for (const s of candidates) { const l=this.page.locator(s).first(); try { await l.waitFor({state:'visible',timeout}); return l; } catch {} } throw new Error(`Selector not found: ${candidates.join(' | ')}`); }
  async click(candidates:readonly string[]) { await (await this.first(candidates)).click(); }
  async fill(candidates:readonly string[], text:string) { const l=await this.first(candidates); await l.fill(text); }
  async waitComplete(timeout=300000) { await this.first(S.completed, timeout); }
  async prompt(text:string) { await this.fill(S.promptInput,text); }
  async generate() { await this.click(S.submit); await this.waitComplete(); }
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
