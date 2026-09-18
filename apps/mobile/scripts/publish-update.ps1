param(
  [Parameter(Mandatory = $false)]
  [string]$Message = "",

  [ValidateSet("preview", "production", "development")]
  [string]$Channel = "preview",

  [ValidateSet("android", "ios", "all")]
  [string]$Platform = "all",

  [switch]$Build
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if (-not $Message -or -not $Message.Trim()) {
  $Message = "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

if (-not $env:EXPO_TOKEN -or -not $env:EXPO_TOKEN.Trim()) {
  Write-Host "EXPO_TOKEN lipsa. Seteaza-l din expo.dev -> Access Tokens inainte de publish:" -ForegroundColor Yellow
  Write-Host '  $env:EXPO_TOKEN = "...."' -ForegroundColor Yellow
  exit 1
}

Write-Host "==> EAS Update pe canalul '$Channel' ($Platform)" -ForegroundColor Cyan
Write-Host "    message: $Message"

$platArgs = @()
if ($Platform -eq "android") { $platArgs = @("--platform", "android") }
elseif ($Platform -eq "ios") { $platArgs = @("--platform", "ios") }

& npx --yes eas-cli update --channel $Channel --environment $Channel --message $Message --non-interactive @platArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Update publicat pe canalul $Channel" -ForegroundColor Green
Write-Host "    https://expo.dev/accounts/promixt/projects/programari/updates"

if ($Build) {
  Write-Host "==> Build Android (profile $Channel)" -ForegroundColor Cyan
  & npx --yes eas-cli build -p android --profile $Channel --non-interactive --no-wait
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "==> Build pornit (vezi dashboard EAS)" -ForegroundColor Green
}