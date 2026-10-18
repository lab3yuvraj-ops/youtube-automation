export interface EditScene {
  scene_number: number;
  speaker: string;
  narration_text?: string;
  devanagari_dialogue?: string;
  background_tag?: string;
  assets?: { background_tag?: string; character_tags?: string[] };
  edit?: { trim_start_seconds?: number; trim_end_seconds?: number; dialogue_offset_seconds?: number; narration_offset_seconds?: number; allow_background_change?: boolean };
}
export type Role = 'character' | 'narrator' | 'music';
export function sceneRole(scene: EditScene): Role {
  if (!scene.speaker) throw new Error(`Scene ${scene.scene_number} has no speaker assignment.`);
  if (scene.speaker === 'NARRATOR') return 'narrator';
  if (scene.speaker === 'none') return scene.narration_text?.trim() ? 'narrator' : 'music';
  return 'character';
}
export function validateSceneMapping(scenes: EditScene[], clipNumbers: number[], narrationNumbers: number[]) {
  const expected = scenes.map(s=>Number(s.scene_number));
  if (!expected.length || expected.some(n=>!Number.isInteger(n)||n<1) || new Set(expected).size!==expected.length) throw new Error('Project must contain unique positive scene numbers.');
  if(new Set(clipNumbers).size!==clipNumbers.length) throw new Error('Multiple video files share a scene number. Choose the correct source before editing.');
  for(const number of clipNumbers) if(!expected.includes(number)) throw new Error(`Unexpected clip for scene ${number}; refusing to mix another project's shot.`);
  for(const scene of scenes) {
    const number=Number(scene.scene_number), role=sceneRole(scene);
    if(!clipNumbers.includes(number)) throw new Error(`Missing video for scene ${number}.`);
    if(role==='narrator' && !narrationNumbers.includes(number)) throw new Error(`Missing narration for scene ${number}.`);
    if(role!=='narrator' && narrationNumbers.includes(number)) throw new Error(`Scene ${number} belongs to ${scene.speaker}; a separate narrator file would replace or overlap its voice. Remove that stale file from the edit inputs.`);
  }
  for(const number of narrationNumbers) if(!expected.includes(number)) throw new Error(`Orphan narration for scene ${number}.`);
}
export function timing(scene: EditScene, videoDuration: number, narrationDuration?: number) {
  const edit=scene.edit??{};
  const start=edit.trim_start_seconds??0, end=edit.trim_end_seconds??videoDuration;
  const dialogueOffset=edit.dialogue_offset_seconds??0, narrationOffset=edit.narration_offset_seconds??0;
  if(![start,end,dialogueOffset,narrationOffset].every(Number.isFinite)||start<0||end>videoDuration+0.01||end<=start||narrationOffset<0||Math.abs(dialogueOffset)>videoDuration) throw new Error(`Invalid measured edit timing for scene ${scene.scene_number}.`);
  const duration=end-start, role=sceneRole(scene);
  if(role==='narrator' && (!narrationDuration || narrationDuration<=0)) throw new Error(`Narration ${scene.scene_number} is empty.`);
  return { start,end,dialogueOffset,narrationOffset,duration:role==='narrator'?Math.max(duration,narrationOffset+narrationDuration!+0.25):role==='character'?duration+Math.max(0,dialogueOffset):duration, sourceDuration:duration, role };
}
export function continuityWarnings(scenes: EditScene[]) {
  const warnings:string[]=[];
  for(let i=1;i<scenes.length;i++) {
    const before=scenes[i-1].assets?.background_tag??scenes[i-1].background_tag;
    const after=scenes[i].assets?.background_tag??scenes[i].background_tag;
    if(before && after && before!==after && !scenes[i].edit?.allow_background_change) warnings.push(`Scene ${scenes[i].scene_number}: background reference changes from ${before} to ${after}; check the story/camera motivation before approval.`);
  }
  return warnings;
}
