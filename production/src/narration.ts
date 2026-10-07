import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launchProfile } from './browserSession.js';
import { loadEnvironment } from './setupConfig.js';

export async function generateNarration(page: Page, text: string, direction: string, target: string) {
  const style = page.getByRole('textbox', { name: /style instructions|voice direction/i }).or(page.getByPlaceholder(/style instructions/i)).first();
  const input = page.getByRole('textbox', { name: /^text$|speech text|script/i }).or(page.getByPlaceholder(/enter.*text|text to.*speech|type.*text/i)).first();
  await input.waitFor({ state: 'visible', timeout: 600000 });
  if (await style.isVisible()) await style.fill(direction);
  await input.fill(`${await style.isVisible() ? '' : `${direction}\n\n`}${text}`);
  const run = page.getByRole('button', { name: /^Run(?:\s|$)|Generate speech/i }).first();
  const baseline = await page.locator('audio').evaluateAll(els => els.map(el => (el as HTMLAudioElement).currentSrc || (el as HTMLAudioElement).src));
  let audio;
  for (let attempt = 0; attempt < 2 && !audio; attempt++) {
    await run.click();
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const sources = await page.locator('audio').evaluateAll(els => els.map(el => (el as HTMLAudioElement).currentSrc || (el as HTMLAudioElement).src).filter(Boolean));
      const source = sources.find(src => !baseline.includes(src));
      if (source) { audio = source; break; }
      await page.waitForTimeout(1000);
    }
  }
  if (!audio) {
    console.log('Hey, when I open Google AI Studio, just click on the Run button so I can proceed.');
    const deadline = Date.now() + 600000;
    while (!audio && Date.now() < deadline) {
      const sources = await page.locator('audio').evaluateAll(els => els.map(el => (el as HTMLAudioElement).currentSrc || (el as HTMLAudioElement).src).filter(Boolean));
      audio = sources.find(src => !baseline.includes(src));
      if (!audio) await page.waitForTimeout(1000);
    }
    if (!audio) throw new Error('AI Studio did not produce audio after two attempts and the user handoff. Completed narration files are retained for resume.');
  }
  // AI Studio exposes generated audio as a blob. Download within its authenticated
  // page context, without sending cookies or credentials to another origin.
  const encoded = await page.evaluate(async source => {
    const response = await fetch(source);
    if (!response.ok) throw new Error('Generated audio download failed.');
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob);
    });
  }, audio);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.length < 44) {
    throw new Error('AI Studio did not return a WAV file. Refusing to save invalid narration.');
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`; await fs.writeFile(temporary, bytes); await fs.rename(temporary, target);
}

export async function narrateManifest(manifestFile: string, profile: string) {
  await loadEnvironment();
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as { voice_direction: string; scenes: { scene_number: number; text: string }[] };
  const files = new Map<number, string>();
  for(const scene of manifest.scenes) {
    for(const extension of ['wav','mp3','m4a']) {
      const target=path.join(path.dirname(manifestFile),'narration',`narration-${String(scene.scene_number).padStart(4,'0')}.${extension}`);
      try {
        await fs.access(target);
        const probe=await promisify(execFile)('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_name','-of','csv=p=0',target]);
        if(!probe.stdout.trim()) throw new Error('No audio stream.');
        files.set(scene.scene_number,target);break;
      } catch {}
    }
  }
  if(files.size===manifest.scenes.length) { console.log('All narration already downloaded; reusing existing audio.');return; }
  const context = await launchProfile(profile);
  try {
    const page = await context.newPage();
    await page.goto(process.env.AI_STUDIO_SPEECH_URL || 'https://aistudio.google.com/generate-speech', { waitUntil: 'domcontentloaded' });
    console.log('Waiting for AI Studio speech generation. Complete Google sign-in here if prompted.');
    const singleSpeaker=page.getByRole('button',{name:/Single.speaker audio/i}).or(page.getByRole('radio',{name:/Single.speaker/i})).first();
    if(await singleSpeaker.isVisible()) await singleSpeaker.click();
    for (const scene of manifest.scenes) {
      const target = path.join(path.dirname(manifestFile), 'narration', `narration-${String(scene.scene_number).padStart(4,'0')}.wav`);
      if(files.has(scene.scene_number)) { console.log(`Narration ${scene.scene_number}: using existing audio.`);continue; }
      await generateNarration(page, scene.text, manifest.voice_direction, target);
      console.log(`Narration ${scene.scene_number}: downloaded.`);
    }
  } finally { await context.close(); }
}
