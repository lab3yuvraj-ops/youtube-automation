<#!
.SYNOPSIS
Shows the first-run welcome and creates a private local .env template.

.DESCRIPTION
Run this once immediately after cloning. It does not install packages, call an
API, upload anything, or overwrite an existing .env file.
#>

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$template = Join-Path $repoRoot 'scripting\.env.example'
$environment = Join-Path $repoRoot 'scripting\.env'

Write-Host ''
Write-Host 'Welcome to YouTube Automation!' -ForegroundColor Cyan
Write-Host 'Please provide your channel logo image (PNG or JPG) and intro video' -ForegroundColor Cyan
Write-Host '(MP4, at least 5 seconds long, with audio).' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $environment)) {
    Copy-Item -LiteralPath $template -Destination $environment
    Write-Host "Created your private settings file: $environment"
} else {
    Write-Host "Your existing settings file is already present: $environment"
}

Write-Host 'Set CHANNEL_LOGO_PATH and CHANNEL_INTRO_PATH in that file, then run:'
Write-Host '  cd production'
Write-Host '  npm install'
Write-Host '  npm run setup'
