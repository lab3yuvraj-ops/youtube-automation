import fs from 'node:fs/promises';
import path from 'node:path';
import { sceneRole, type EditScene } from './editorPlan.js';
import { loadEnvironment } from './setupConfig.js';

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
};

const projectFile = path.resolve(arg('--project') ?? '../scripting/projects/example/pipeline.json');
const outputDir = path.resolve(arg('--output-dir') ?? 'outputs');
await loadEnvironment();
const project = JSON.parse(await fs.readFile(projectFile, 'utf8')) as { scenes?: EditScene[]; narrator_voice?: string; narrator_direction?: string };
const eligible = (project.scenes ?? [])
  .filter((scene) => sceneRole(scene) === 'narrator')
  .sort((a, b) => Number(a.scene_number) - Number(b.scene_number))
  .map((scene) => ({
    scene_number: Number(scene.scene_number),
    text: String(scene.narration_text?.trim() || scene.devanagari_dialogue || '').trim(),
  }))
;
const missing = eligible.filter((scene) => !scene.text).map((scene) => scene.scene_number);
if (missing.length) throw new Error(`Narration text is missing for non-character scenes: ${missing.join(', ')}`);
const scenes = eligible;

await fs.mkdir(outputDir, { recursive: true });
const manifest = {
  voice_direction: project.narrator_direction || 'Adult Hindi folk-horror narrator. Calm, suspenseful, native North Indian Hindi pronunciation; no English or Western cadence. Read exactly the supplied text; no extra dialogue or stage directions.',
  voice_name: project.narrator_voice || process.env.NARRATOR_VOICE || undefined,
  download_as: 'narration-000N.wav (or .mp3) in the narration folder',
  scenes,
};
const file = path.join(outputDir, 'narration-manifest.json');
await fs.writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ file, scenes: scenes.map((scene) => scene.scene_number) }));
