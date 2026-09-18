# Hindi Folk-Horror YouTube Automation Pipeline

This repository contains a two-half pipeline:

- `scripting/`: Groq API orchestration for idea -> script -> assets -> scenes -> publishing metadata.
- `production/`: Playwright browser automation for Google Flow using a persistent Chrome profile.

## Fastest local workflow: give one title

This is a local-only project. Nothing requires Railway or a cloud browser session. Set your own Groq key once, ensure Chrome is logged into Google Flow, then run:

```powershell
$env:GROQ_API_KEY = "your-own-key"
.\start-video.ps1 -Title "आख़िरी बस की तीसरी सीट" -Concept "बरसाती रात में तीसरी सीट पर बैठी प्रेत-आत्मा"
```

The launcher creates a fresh one-minute project with exactly 12 structured scenes, then opens the persistent local Chrome profile and runs Flow in this order: characters → backgrounds → scenes → downloads. Flow itself decides every scene's natural duration; no scene is forced to six seconds.

After Flow finishes, generate the listed narrator files in Google AI Studio. If Google AI Studio does not generate after two attempts, the operating rule is to pause and ask the human to click **Run**. Put files in `production/outputs/<project>/narration/`, then run the final two commands printed by the launcher. Character scenes retain their Flow audio; narrator scenes use their narration file and have their Flow audio muted.

## Important prompt-template contract

The prompt bodies from `HORROR PROMPTS.pdf` are now installed in `scripting/prompts/`. They remain stage-local and are rendered with only the named input substitutions. The supplied reference image is captured in `scripting/style_reference.md` and is appended as a locked style constraint for character, background, and scene generation.

If the templates are replaced or updated, keep the literal prompt wording intact and only change the `{{...}}` input fields:

```text
scripting/prompts/1- IDEA GENERATION.txt
scripting/prompts/3- STORY.txt
scripting/prompts/4- CHARACTER IMAGE PROMPTS.txt
scripting/prompts/5- IMAGE PROMPTS.txt
scripting/prompts/6- ANIMATION PROMPTS.txt
scripting/prompts/7- UPLOADING.txt
```

The runner refuses to start if a template is missing or still contains the old scaffold marker.

## Half A: scripting

```powershell
cd scripting
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:GROQ_API_KEY = "your key"
python -m pipeline.cli new --project-id village-well --method B --concept "एक सूखे कुएँ में लौटती चूड़ैल" --ideas 5
python -m pipeline.cli choose --project projects\village-well\pipeline.json --index 2
python -m pipeline.cli run --project projects\village-well\pipeline.json --language Hindi --duration 8 --monster "चुड़ैल"
```

For the one-minute, exactly 12-scene haunted-bus project in this workspace, run
`python -m pipeline.one_minute --project-id youtube-automation-last-bus` from
`scripting/` with `GROQ_API_KEY` set. This creates a fresh project file; do not
rerun it over a project whose Flow assets are already in progress.

`choose` is the only intentional Half A human checkpoint. `run` resumes completed stages and preserves the raw Stage 2 script as the source of truth. The generated project JSON follows `scripting/schema/pipeline.schema.json`.

Stage outputs may be JSON, fenced JSON, or the PDF's labeled text format. Parsers retain raw output and validate tags, minimum scene count, speakers, and the narrator/lip-sync split.

## Half B: production

Install Playwright and its browser once:

```powershell
cd production
npm install
npx playwright install chrome
npm run flow -- --project ..\scripting\projects\village-well\pipeline.json --user-data-dir .\chrome-profile --output-dir .\outputs
```

The runner uses a persistent Chromium profile. On first use, complete Google login in the opened browser, then rerun. UI labels/selectors are centralized in `production/src/selectors.ts` and can be updated when Flow changes. It waits on DOM state and download events, not fixed render sleeps. The runner skips `done`, retries each `failed` item once, logs structured errors, and continues with later items.

This automation is intentionally conservative: it does not call a Flow API, create accounts, acquire credits, or clone voices.

### Final edit with natural clip lengths and fades

Flow clips are never trimmed to a fixed duration. After downloading the completed `scene-####.mp4` files, preserve every clip in full and assemble them with short audio/video fades:

```powershell
cd production
npm run edit -- --input-dir .\outputs\youtube-automation-last-bus --output .\outputs\youtube-automation-last-bus\final-with-fades.mp4 --transition 0.35
```

The editor probes each clip's actual duration, keeps its full performance (including dialogue), then overlaps adjacent clips by the selected fade duration. The final runtime is content-driven, not fixed to one minute.

### Google AI Studio narration mix

Use the text and voice direction in `production/outputs/<project>/narration-manifest.json` to generate one narration file per listed scene in Google AI Studio. Download each as `narration-000N.wav` (or `.mp3`) into `production/outputs/<project>/narration/`.

```powershell
cd production
npm run mix-narration -- --input-dir .\outputs\youtube-automation-last-bus --narration-dir .\outputs\youtube-automation-last-bus\narration --output .\outputs\youtube-automation-last-bus\final-narrated.mp4 --transition 0.35
```

For every scene with a narration file, the mixer mutes that source clip's original audio and places the narration over it. Character-dialogue scenes do not receive a narration file, so their native Flow voice remains untouched. The same audio/video fade transition is applied between every scene.

## Configuration

Set optional production environment variables:

```text
FLOW_URL=https://labs.google/flow
FLOW_PROJECT_NAME=Hindi Folk Horror
FLOW_IMAGE_MODEL=
FLOW_VIDEO_MODEL=
FLOW_RATE_LIMIT_MS=1500
```

Selectors are data, not logic. If Flow changes, update the selector candidates and the wait predicates in `production/src/flowClient.ts`.
