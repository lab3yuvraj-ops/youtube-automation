param(
  [Parameter(Mandatory = $true)][string]$Title,
  [string]$Concept = "",
  [string]$Model = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY) -and [string]::IsNullOrWhiteSpace($env:GROQ_API_KEY)) {
  throw "Set OPENAI_API_KEY or GROQ_API_KEY in scripting/.env or your environment before starting a project."
}

$projectId = "youtube-automation-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$repoRoot = $PSScriptRoot

Push-Location (Join-Path $repoRoot "scripting")
try {
  $arguments = @("-m", "pipeline.one_minute", "--project-id", $projectId, "--title", $Title)
  if (-not [string]::IsNullOrWhiteSpace($Model)) { $arguments += @("--model", $Model) }
  if (-not [string]::IsNullOrWhiteSpace($Concept)) { $arguments += @("--concept", $Concept) }
  & python @arguments
} finally {
  Pop-Location
}

$pipeline = Join-Path $repoRoot "scripting\projects\$projectId\pipeline.json"
$output = Join-Path $repoRoot "production\outputs\$projectId"
Push-Location (Join-Path $repoRoot "production")
try {
  npm run flow -- --project $pipeline --user-data-dir .\chrome-profile --output-dir $output
  npm run narration-manifest -- --project $pipeline --output-dir $output
} finally {
  Pop-Location
}

Write-Host "Flow assets are complete. Generate AI Studio narration files from: $output\narration-manifest.json"
Write-Host "Download them into: $output\narration"
Write-Host "Then run:"
Write-Host "cd $repoRoot\production"
Write-Host "npm run mix-narration -- --input-dir $output --narration-dir $output\narration --output $output\final-narrated.mp4 --transition 0.35"
Write-Host "npm run add-title -- --input $output\final-narrated.mp4 --output $output\final.mp4"
