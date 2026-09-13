param(
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,

  [ValidateSet("agent", "plan", "ask")]
  [string]$Mode = "agent",

  [string]$Model,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedPrompt = (Resolve-Path $PromptFile).Path
$liveDir = Join-Path $repoRoot ".cursor-live"
$liveFile = Join-Path $liveDir "LIVE.md"
$promptCopy = Join-Path $liveDir "PROMPT.md"
$responseFile = Join-Path $liveDir "RESPONSE.md"
$eventsFile = Join-Path $liveDir "EVENTS.jsonl"
$agent = Join-Path $env:LOCALAPPDATA "cursor-agent\agent.cmd"

if (-not (Test-Path $agent)) {
  throw "Cursor CLI was not found at $agent"
}

New-Item -ItemType Directory -Force -Path $liveDir | Out-Null
$prompt = Get-Content $resolvedPrompt -Raw
$startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"

Set-Content -Path $promptCopy -Value $prompt -Encoding utf8
Set-Content -Path $responseFile -Value "" -Encoding utf8
Set-Content -Path $eventsFile -Value "" -Encoding utf8

$header = @"
# Cursor Live Session

- Started: $startedAt
- Mode: $Mode
- Prompt file: $resolvedPrompt

## Prompt sent to Cursor

$prompt

## Cursor response

"@
Set-Content -Path $liveFile -Value $header -Encoding utf8

$agentArgs = @(
  "--trust",
  "-p",
  "--output-format", "stream-json",
  "--stream-partial-output",
  "--workspace", $repoRoot
)

if ($Mode -ne "agent") {
  $agentArgs += @("--mode", $Mode)
}
if ($Model) {
  $agentArgs += @("--model", $Model)
}
if ($Force) {
  $agentArgs += "--force"
}

Write-Host "Cursor prompt: $promptCopy"
Write-Host "Live transcript: $liveFile"
Write-Host "Raw events: $eventsFile"
Write-Host ""

$exitCode = 0
$prompt | & $agent @agentArgs 2>&1 | ForEach-Object {
  $line = $_.ToString()
  Add-Content -Path $eventsFile -Value $line -Encoding utf8

  try {
    $event = $line | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Add-Content -Path $liveFile -Value "`n[Cursor CLI] $line`n" -Encoding utf8
    Write-Host $line
    return
  }

  if ($event.type -eq "assistant" -and $event.timestamp_ms) {
    foreach ($content in $event.message.content) {
      if ($content.type -eq "text" -and $null -ne $content.text) {
        Add-Content -Path $responseFile -Value $content.text -NoNewline -Encoding utf8
        Add-Content -Path $liveFile -Value $content.text -NoNewline -Encoding utf8
        Write-Host $content.text -NoNewline
      }
    }
  } elseif ($event.type -eq "tool_call") {
    $toolName = if ($event.subtype) { $event.subtype } else { "tool" }
    $toolLine = "`n`n[Cursor tool: $toolName]`n`n"
    Add-Content -Path $liveFile -Value $toolLine -Encoding utf8
    Write-Host $toolLine
  } elseif ($event.type -eq "result") {
    $status = if ($event.is_error) { "failed" } else { "completed" }
    $resultLine = "`n`n---`nCursor $status.`n"
    Add-Content -Path $liveFile -Value $resultLine -Encoding utf8
    Add-Content -Path $responseFile -Value "`n" -Encoding utf8
    Write-Host $resultLine
  }
}

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  $failureLine = "`nCursor CLI exited with code $exitCode.`n"
  Add-Content -Path $liveFile -Value $failureLine -Encoding utf8
  throw "Cursor CLI exited with code $exitCode"
}
