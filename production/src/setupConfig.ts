import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const envFile = path.join(root, 'scripting/.env');
export async function loadEnvironment() {
  try { process.loadEnvFile(envFile); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
}
export interface Config { apiKey: string; accountId: string; visibility: string }
export async function ask(question: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive setup required. Run npm run setup in a terminal.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try { process.stdout.write(question); muted = secret; return (await rl.question('')).trim(); }
  finally { muted = false; rl.close(); if (secret) process.stdout.write('\n'); }
}
export async function setup(assets = true): Promise<Config> {
  await loadEnvironment();
  const apiKey = process.env.ZERNIO_API_KEY?.trim() ?? '';
  const accountId = process.env.ZERNIO_YOUTUBE_ACCOUNT_ID?.trim() ?? '';
  const visibility = process.env.YOUTUBE_VISIBILITY?.trim() || 'private';
  if (!apiKey || !accountId) throw new Error('Fill ZERNIO_API_KEY and ZERNIO_YOUTUBE_ACCOUNT_ID in scripting/.env. Copy scripting/.env.example to .env first if needed.');
  if (!['public', 'private', 'unlisted'].includes(visibility)) throw new Error('YOUTUBE_VISIBILITY must be public, private or unlisted in scripting/.env.');
  if (assets) {
    if (!process.env.OPENAI_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim()) {
      throw new Error('Add OPENAI_API_KEY or GROQ_API_KEY to scripting/.env.');
    }
    for (const [name, variable] of [['channel-logo', 'CHANNEL_LOGO_PATH'], ['channel-intro.mp4', 'CHANNEL_INTRO_PATH']]) {
      const value = process.env[variable]?.trim();
      const configuredPath = value ? path.resolve(root, value) : undefined;
      const logoExtension = configuredPath && name === 'channel-logo'
        ? path.extname(configuredPath).toLowerCase()
        : '.png';
      if (name === 'channel-logo' && !['.png', '.jpg', '.jpeg'].includes(logoExtension)) {
        throw new Error('CHANNEL_LOGO_PATH must point to a PNG or JPG image.');
      }
      const destination = path.join(root, 'production/assets', `${name}${logoExtension}`);
      const source = configuredPath ?? destination;
      try { await fs.access(source); } catch { throw new Error(`Set ${variable} to an existing file in scripting/.env.`); }
      if (source !== destination) await fs.copyFile(source, destination);
    }
  }
  return { apiKey, accountId, visibility };
}
