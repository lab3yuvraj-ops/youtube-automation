import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
export function sceneIdentity(scene:Record<string,any>) {
  return createHash('sha256').update(JSON.stringify({number:Number(scene.scene_number),speaker:scene.speaker,background:scene.assets?.background_tag??scene.background_tag,characters:scene.assets?.character_tags??scene.character_tags,dialogue:scene.devanagari_dialogue??'',narration:scene.narration_text??''})).digest('hex');
}
async function hash(file:string) {
  const h=createHash('sha256');for await(const chunk of createReadStream(file)) h.update(chunk);return h.digest('hex');
}
export async function saveSceneIdentity(file:string,scene:Record<string,any>) {
  await fs.writeFile(`${file}.scene.json`,JSON.stringify({scene_identity:sceneIdentity(scene),file_sha256:await hash(file)},null,2));
}
export async function verifySceneIdentity(file:string,scene:Record<string,any>) {
  let saved;
  try { saved=JSON.parse(await fs.readFile(`${file}.scene.json`,'utf8')); }
  catch(error:any) { if(error.code==='ENOENT') return false;throw error; }
  if(saved.scene_identity!==sceneIdentity(scene)) throw new Error(`Scene ${scene.scene_number}: speaker, words or background references changed since this clip was downloaded. Revalidate that source clip before editing.`);
  if(saved.file_sha256!==await hash(file)) throw new Error(`Scene ${scene.scene_number}: clip differs from its saved download. Verify this replacement before editing.`);
  return true;
}
