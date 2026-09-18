# YouTube Automation operating rules

When the user supplies a video title, start a new local project from that title using `start-video.ps1`. The scripting stage must retain the literal templates in `scripting/prompts/`, produce a one-minute Hindi folk-horror story with exactly 12 scenes, and preserve the reference style: flat, semi-realistic 2D Indian animation with natural adult human proportions.

Run Google Flow only through the authenticated persistent local Chrome profile. Create characters, backgrounds, then scenes; download every completed scene. Never require or assume six-second clips: Flow determines the natural duration required for each action and spoken line.

For every non-character-speaking scene, generate the matching Hindi narrator audio in Google AI Studio. Try Run twice. If no audio is produced, pause and say exactly: **“Hey, when I open Google AI Studio, just click on the Run button so I can proceed.”** Never continue a silent scene if narration is expected.

Edit clips in scene order. Preserve full character dialogue, trim only unused narrator padding, use brief fade transitions, mute Flow audio wherever the narrator track plays, retain Flow character audio on character-speaking scenes, and add a premium fade/pop title only over scene 1. Do not store or commit API keys, browser profiles, downloaded media, project outputs, or `.env` files.
