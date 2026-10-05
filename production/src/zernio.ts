import { loadEnvironment } from './setupConfig.js';
import { loadProject, saveProject } from './reviewState.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://zernio.com/api/v1';
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

await loadEnvironment();

function apiKey(): string {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new Error('Set ZERNIO_API_KEY in your local environment or scripting/.env. Never commit it.');
  return key;
}
async function request(endpoint: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_BASE}${endpoint}`, { ...init, headers: { Authorization: `Bearer ${apiKey()}`, ...(init.headers ?? {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Zernio ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : {};
}

const command = process.argv[2] ?? 'test';
if (command === 'test') {
  const response = await request('/accounts');
  const accounts = Array.isArray(response) ? response : (response as { accounts?: unknown[] }).accounts ?? [];
  const youtubeAccounts = accounts.filter((account: any) => String(account.platform ?? account.type ?? '').toLowerCase() === 'youtube');
  console.log(JSON.stringify({ configured: true, accounts: accounts.length, youtube_accounts: youtubeAccounts.length, write_operation: false }, null, 2));
} else if (command === 'connect-youtube') {
  const profileId = arg('--profile-id');
  if (!profileId) throw new Error('Pass --profile-id <Zernio profile id>.');
  const response = await request(`/connect/youtube?profileId=${encodeURIComponent(profileId)}`);
  console.log(JSON.stringify({ response, write_operation: false }, null, 2));
} else if (command === 'publish') {
  const projectFile = arg('--project');
  if (!projectFile) throw new Error('Pass --project <pipeline.json>.');
  const { publishApproved } = await import('./upload.js');
  console.log(await publishApproved(path.resolve(projectFile)));
} else throw new Error('Use one of: test, connect-youtube, publish.');
