import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
export function narrationIdentity(text:string,direction:string,voice?:string) {
  return createHash('sha256').update(JSON.stringify({text:text.trim(),direction,voice:voice||null})).digest('hex');
}
export async function verifyNarrationIdentity(file:string,identity:string) {
  try {
    const metadata=JSON.parse(await fs.readFile(`${file}.identity.json`,'utf8'));
    if(metadata.identity!==identity) throw new Error(`Narration content or voice settings changed for ${file}. Retain this old file as a backup and regenerate the matching narration.`);
    const hash=createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if(hash!==metadata.audio_sha256) throw new Error(`Narration audio changed since generation: ${file}. Recheck this file before editing.`);
    return true;
  } catch(error:any) { if(error.code==='ENOENT') return false;throw error; }
}
export async function saveNarrationIdentity(file:string,identity:string) {
  const audio_sha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  await fs.writeFile(`${file}.identity.json`,JSON.stringify({identity,audio_sha256},null,2));
}
