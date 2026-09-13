param(
  [ValidateSet("live", "prompt", "response", "events")]
  [string]$View = "live"
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$liveDir = Join-Path $repoRoot ".cursor-live"
$files = @{
  live = "LIVE.md"
  prompt = "PROMPT.md"
  response = "RESPONSE.md"
  events = "EVENTS.jsonl"
}
$target = Join-Path $liveDir $files[$View]

New-Item -ItemType Directory -Force -Path $liveDir | Out-Null
if (-not (Test-Path $target)) {
  New-Item -ItemType File -Path $target | Out-Null
}

Write-Host "Watching $target"
Write-Host "Keep this terminal open. Press Ctrl+C to stop watching."
Write-Host ""

$lastContent = $null
while ($true) {
  $content = if (Test-Path $target) {
    Get-Content -Path $target -Raw
  } else {
    "Waiting for $target ..."
  }

  if ($content -ne $lastContent) {
    Clear-Host
    Write-Host "Watching $target"
    Write-Host "Press Ctrl+C to stop watching."
    Write-Host ""
    Write-Host $content
    $lastContent = $content
  }

  Start-Sleep -Milliseconds 250
}
