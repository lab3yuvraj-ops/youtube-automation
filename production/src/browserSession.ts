import { chromium, type BrowserContext } from 'playwright';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Reuse installed Chrome when Playwright's browser was not downloaded.
// Do not delete locks or terminate a user's browser to acquire their profile.
export async function launchProfile(profile: string): Promise<BrowserContext> {
  let missingBrowser = false;
  try { await fs.access(chromium.executablePath()); } catch { missingBrowser = true; }
  const options = { headless: false, acceptDownloads: true };
  try {
    return await chromium.launchPersistentContext(profile, {
      ...options, ...(missingBrowser ? { channel: 'chrome' } : {}),
    });
  } catch (error: any) {
    if (/profile.*in use|ProcessSingleton|Opening in existing browser session/i.test(String(error))) {
      throw new Error(`Chrome is already using the automation profile ${profile}. Close only that profile's windows, then resume the same project. Your ordinary Chrome profile does not need to be closed.`);
    }
    if (!missingBrowser || !/distribution.*not found|Executable doesn't exist|not found/i.test(String(error))) throw error;
    // Neither installed Chrome nor bundled Chromium is available. Install only
    // Playwright's own matching browser; no shell-specific npx command required.
    const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')), 'cli.js');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Playwright browser installation failed.')));
    });
    return chromium.launchPersistentContext(profile, options);
  }
}
