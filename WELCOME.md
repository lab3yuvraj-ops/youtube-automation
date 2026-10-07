# Welcome to YouTube Automation

Please provide your channel logo image (PNG or JPG) and intro video (MP4, at
least 5 seconds long, with audio).

Immediately after cloning, run on Mac or Windows:

```sh
node welcome.mjs
```

It creates your private `scripting/.env` from the included template without
overwriting existing settings. Set `CHANNEL_LOGO_PATH` and
`CHANNEL_INTRO_PATH` to your files, then follow the printed setup command.

Git cannot display a prompt or run code merely because it cloned a repository.
This is the shortest safe first-run command. The older `welcome.ps1` remains available on Windows.
