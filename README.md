# Hindi Folk-Horror YouTube Automation Pipeline

This repository contains a two-half pipeline:

- `scripting/`: OpenAI-or-Groq API orchestration for idea -> script -> assets -> scenes -> publishing metadata.
- `production/`: Playwright browser automation for Google Flow using a persistent Chrome profile.

## Fastest local workflow: give one title

This is a local-only project. Nothing requires Railway or a cloud browser session. Copy `scripting/.env.example` to `scripting/.env`, add either your OpenAI or Groq key, ensure Chrome is logged into Google Flow, then run:

```powershell
.\start-video.ps1 -Title "आख़िरी बस की तीसरी सीट" -Concept "बरसाती रात में तीसरी सीट पर बैठी प्रेत-आत्मा"
```

The launcher creates a fresh one-minute project with exactly 12 structured scenes, then opens the persistent local Chrome profile and runs Flow in this order: characters → backgrounds → scenes → downloads. Flow itself decides every scene's natural duration; no scene is forced to six seconds.

### Writing-model selection

The scripting stages (idea, story, characters, backgrounds, scenes, and publishing metadata) automatically choose the first available local key:

1. `OPENAI_API_KEY` → OpenAI, default model `gpt-4.1-mini`.
2. `GROQ_API_KEY` → Groq, default model `openai/gpt-oss-120b`.

If both keys exist, OpenAI is used. Set `OPENAI_MODEL` or `GROQ_MODEL` in `scripting/.env` to override the default. Keys are never committed; `.env` is ignored by Git.

After Flow finishes, generate every listed narrator file in Google AI Studio. If Google AI Studio does not generate after two attempts, pause and ask the human to click **Run**. Put files in `production/outputs/<project>/narration/`, then run the final commands printed by the launcher. Character scenes retain their Flow audio unchanged. Narrator scenes use their Google AI Studio file, while scene ambience/SFX can remain quietly underneath.

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
$env:OPENAI_API_KEY = "your key" # or set GROQ_API_KEY instead
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
npm run mix-narration -- --input-dir .\outputs\youtube-automation-last-bus --narration-dir .\outputs\youtube-automation-last-bus\narration --bgm .\outputs\youtube-automation-last-bus\background-music.mp3 --narration-makeup-db 12 --bgm-lufs -20.9 --output .\outputs\youtube-automation-last-bus\final-narrated.mp4 --transition 0.35
```

For every scene with a narration file, the mixer processes only the Google AI Studio narration through the tested speech-compression/limiter chain (approximately -14 LUFS) and retains low scene ambience/SFX beneath it. Character-dialogue scenes do not receive a narration file, so their native Flow voice remains untouched. The continuous background music is normalized to -20.9 LUFS. The same audio/video fade transition is applied between every scene, and clips use Flow's natural durations rather than a fixed length.

### Channel intro, music, and subtitle policy

Every final export starts with the first five seconds of the private channel intro at `production/assets/channel-intro.mp4`, then cross-fades into the titled story. Put a transparent `channel-logo.png` beside it. The logo is rendered on every final video in the lower-right reference position, inset from the edges (at 1280x720: 76px high, 72px from the right, 75px from the bottom). Both private assets are intentionally not committed; each clone must supply its own licensed copies.

The finishing commands printed by `start-video.ps1` download a Creative Commons Zero Freesound horror music bed and loop it continuously beneath the story at -20.9 LUFS. Narration is held around -14 LUFS after compression, which keeps it clearly intelligible. A 0 LUFS narration target is intentionally not used because it would clip speech. Set these local-only values in `scripting/.env` before the audio step:

```text
FREESOUND_CLIENT_ID=
FREESOUND_CLIENT_SECRET=
FREESOUND_REFRESH_TOKEN=
```

The music downloader saves a license record beside the downloaded file. Final FFmpeg exports map only video and audio, so soft subtitle streams are not carried into the completed video. The pipeline does not add subtitles. Burned-in captions or third-party watermarks must be avoided by obtaining a clean source export; they are not removed or concealed by this project.

### First-run setup and approval uploads

Requires Node.js 22+, Python, FFmpeg and the existing production dependencies.
Copy `scripting/.env.example` to `scripting/.env` once, then fill in your values there. This single file holds writing-model keys, music credentials, Zernio upload settings and logo/intro file paths. Never overwrite an existing `.env` containing credentials.

```dotenv
ZERNIO_API_KEY=your_zernio_key
ZERNIO_YOUTUBE_ACCOUNT_ID=your_connected_account_id
YOUTUBE_VISIBILITY=private
CHANNEL_LOGO_PATH=C:/Users/you/Pictures/logo.png
CHANNEL_INTRO_PATH=C:/Users/you/Videos/intro.mp4
```

Use the connected account ID from Zernio, not the YouTube channel ID. Connect your channel in Zernio first. Paths may be absolute or relative to the repository root. Files stay on disk; only their paths go in `.env`. Visibility defaults to private; set public when ready.

Run `npm install` then `npm run setup` from `production` to validate settings and copy channel assets. `start-video.ps1` also runs this check automatically. Credentials are read from the same Git-ignored `scripting/.env` on each run, with environment variables taking precedence. The earlier `.env.upload.json` is no longer used; move any saved values into `.env`.

The existing Flow and Google AI Studio narration workflow remains in place. The final `add-title --project ...` command renders the intro and logo, records the exact video hash, and in an interactive terminal asks one question: **Is this video good enough to upload to YouTube?** It shows the video path, account and visibility. Yes uploads the local MP4 through Zernio immediately; no records rejection without uploading. No second publishing confirmation is needed.

For an agent or noninteractive run, use:

```powershell
npm run review -- prompt --project <pipeline.json>
# Or record the user's explicit decision:
npm run review -- approve --project <pipeline.json>
npm run review -- reject --project <pipeline.json>
```

Approval is tied to the rendered file hash. Modified videos require a fresh review. Concurrent uploads are locked. Once a post request starts, repeat submissions are blocked even if the network response is lost; check the Zernio dashboard to reconcile before taking further action. A stale `.upload.lock` after a process crash must be inspected before manual removal. Pre-submission failures can be retried with `npm run review -- retry --project <pipeline.json>`.

A submitted post is not reported as published until Zernio returns a published platform status. Pending submissions can be followed in the Zernio dashboard. `review status` shows the locally recorded response, not a live poll.

API references: https://docs.zernio.com/guides/media-uploads and https://docs.zernio.com/platforms/youtube.

Validation: `npm run typecheck` and `npm test` in `production`. Tests mock all network calls; they never upload to YouTube.

### Welcome message for new users

When a connected Codex agent first opens a new clone, AGENTS.md instructs it to say:

> Welcome to YouTube Automation! Please provide your channel logo (transparent PNG) and intro video (MP4, at least 5 seconds long, with audio).

All other settings come from `scripting/.env`. `npm run setup` creates this file if missing, preserves existing values, and shows the same asset-only welcome when configuration is incomplete. Git clone alone cannot execute a message.

### Get Freesound credentials with your connected browser

Ask your Codex agent: “Use my connected Chrome browser to get my Freesound client ID, client secret and refresh token, and save them in my local .env.” You may also provide a specific Google Sheet link containing existing credentials. The agent follows [the onboarding workflow](docs/freesound-onboarding.md), completes the authorized browser steps, then validates using `npm run freesound -- --auth-only`. Login or consent may require your interaction. This workflow requires the connected agent, not just Node.js.

No credentials appear in the welcome message. Refresh tokens are saved after rotation; temporary authorization codes are removed after successful exchange.
