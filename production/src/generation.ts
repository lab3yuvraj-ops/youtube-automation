import type { Page, Locator } from 'playwright';
import type { Item } from './types.js';

export class FlowGenerationQueuedError extends Error {
  constructor(message = 'Flow has not produced this generation yet. Submission saved; resume this project without regenerating.') {
    super(message); this.name = 'FlowGenerationQueuedError';
  }
}
export interface GenerationState {
  url: string; baseline: string[]; started_at: string;
  phase: 'prepared' | 'submitted' | 'complete'; source?: string;
}
export async function mediaSources(page: Page, kind: 'video' | 'image'): Promise<string[]> {
  return page.locator(kind === 'video' ? 'video' : 'main img, [data-generation-state] img').evaluateAll(elements =>
    elements.map(el => (el as HTMLMediaElement).currentSrc || el.getAttribute('src') || '').filter(Boolean));
}
export async function generationResult(page: Page, state: GenerationState, kind: 'video' | 'image'): Promise<Locator | undefined> {
  const sources = await mediaSources(page, kind);
  const candidates = [...new Set(sources.filter(src => !state.baseline.includes(src)))];
  if (!state.source && candidates.length > 1) throw new Error('Multiple new media results appeared. Identify the requested result before resuming; refusing to download an unrelated clip.');
  const source = state.source || candidates[0];
  if (!source || !sources.includes(source)) return undefined;
  const elements = page.locator(kind === 'video' ? 'video' : 'img');
  for (let i = 0; i < await elements.count(); i++) {
    const element = elements.nth(i);
    if (await element.evaluate(el => (el as HTMLMediaElement).currentSrc || el.getAttribute('src')) === source) {
      state.source = source; return element;
    }
  }
}
export async function waitGeneration(page: Page, item: Item, kind: 'video' | 'image', save: () => Promise<void>, log: (event: string, data?: any) => void, timeout: number) {
  const state = item.flow_generation as GenerationState;
  const deadline = Date.now() + timeout;
  let approvalClicked = false; let lastLog = 0;
  while (Date.now() < deadline) {
    const result = await generationResult(page, state, kind);
    if (result) { state.phase = 'complete'; state.url = page.url(); await save(); return result; }
    if (await page.getByText(/We noticed some unusual activity|unusual activity detected/i).first().isVisible()) {
      throw new Error('Google Flow requests account verification. Submission saved; clear the warning and resume this project.');
    }
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    if (!approvalClicked && await approve.isVisible() && await approve.isEnabled()) {
      await approve.click(); approvalClicked = true; log('generation_approved', { message: 'Approved this requested generation only.' });
    }
    if (Date.now() - lastLog > 60_000) { log('waiting_for_generation', { message: 'Watching current media without resubmitting or reading old queue messages.' }); lastLog = Date.now(); }
    if (page.isClosed()) throw new Error('Flow browser closed. Resume this project.');
    await page.waitForTimeout(1000);
  }
  throw new FlowGenerationQueuedError();
}
