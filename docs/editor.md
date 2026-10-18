# Speaker-aware audio and continuity editing

The full workflow passes the project to the editor. Each scene has exactly one foreground audio owner:

| Project speaker | Foreground audio | Picture timing |
| --- | --- | --- |
| Character tag | Audio from that exact Flow scene | Original motion and dialogue remain together |
| NARRATOR | That scene's AI Studio narration | Original motion, holding its last frame only if speech needs more time |
| none with narration_text | That scene's narration | Same as narrator shots |
| none without narration_text | Background music only | Original shot |

Music is continuous and ducks beneath foreground speech. Narrator scenes discard Flow audio so accidental generated speech cannot compete with the narrator. Narrator leading silence is removed conservatively; character speech is never automatically trimmed to the first loud noise. No speech crosses a scene cut. Plain cuts replace speech-overlapping fades in the speaker-aware editor. Legacy `edit` without `--project` remains the simple assembly tool.

To re-edit existing clips without generating any new Flow scenes, run from the repository root:

```sh
node start-video.mjs --project /path/to/pipeline.json --edit-only
```

This reuses existing source files, generates missing narrator audio when needed, and produces a new review-ready final render. It will not overwrite a project already submitted for upload. An incomplete source download is an error, not permission to regenerate a scene in edit-only mode.

For the standalone editor, run in production:

```sh
npm run mix-narration -- --project /path/to/pipeline.json --input-dir /path/to/clips --narration-dir /path/to/narration --bgm /path/to/music.mp3 --output /path/to/re-edited.mp4
```

Use `--manifest /path/to/narration-manifest.json` as well to validate narration fingerprints. Without `--project`, the old filename-based command still works, but cannot verify speaker ownership. `--transition` and `--narration-makeup-db` remain accepted for compatibility and emit explanations; speaker-aware editing uses cuts and a -14 LUFS narrator target.

## Measured repairs

The editor cannot infer a mouth's movement from an audio waveform. If a source clip already contains delayed or wrong speech, inspect that source first. For a constant measured offset, set a per-scene `edit` object in pipeline.json:

```json
{
  "scene_number": 4,
  "speaker": "@CHAR-01-ROHAN",
  "edit": {
    "dialogue_offset_seconds": -0.35,
    "trim_start_seconds": 0,
    "narration_offset_seconds": 0
  }
}
```

Negative dialogue offsets advance the source audio; positive offsets delay it. No default guessed correction is applied. Positive offsets preserve the shifted end by holding the final frame. `trim_end_seconds` is an optional source-clock endpoint. Trims apply to picture and audio together. Explicit trims can remove content, so select them only after reviewing the source. Narration offsets are nonnegative. There is no time stretch of character speech or mouth movement.

For a wrong voice, wrong words, changing drift, or a different animated mouth, regenerate/repair the affected source shot. A timing shift cannot fix speaker identity or incorrect animation. Never claim perfect lip sync from a successful render alone.

## Narration consistency and older files

Set `narrator_voice` in pipeline.json (or `NARRATOR_VOICE` in .env) to an exact voice label available in AI Studio. Once a readable voice is chosen, its label is saved in the project's `narrator-voice.json` and reselected on partial resume. Unreadable voice controls produce a warning instead of silently claiming consistency. Narration identity sidecars fingerprint the requested words, direction and configured voice plus the downloaded audio bytes. These detect stale files/settings; they are not speech transcription or proof that the provider read every word correctly.

New scene downloads also save a fingerprint of the speaker, background reference, expected words and downloaded file. Editing rejects a changed assignment or swapped file. Existing student files without fingerprints remain usable, with review warnings; they are not relabeled as newly verified. Conflicting narrator files on character scenes, duplicate audio alternatives, missing scenes, and unexpected clips stop the render. Move stale inputs to a backup folder after identifying the correct file.

## Background continuity and review

Generation prompts lock the saved room, furniture, lighting, clothes and character appearances for the entire shot, disallowing internal cuts and unrequested setting changes. The edit report flags a background tag change between adjacent scenes. Mark a deliberate transition with `edit.allow_background_change: true` only when the story/camera motivates it.

A source video that changes its own background cannot be repaired by rearranging its audio. Review and replace that specific shot. A different background tag may be an intentional camera angle; the editor reports it for review instead of substituting a guessed background.

Each mixed export has `OUTPUT.mp4.edit-report.json` recording the scene order, speaker, source audio, timestamps, measured offsets, durations, and continuity warnings. The calling agent must review source mouth sync, spoken words, voice identity and continuity before claiming the edit is correct. New generation prompts reduce these failures; they cannot guarantee provider output.
