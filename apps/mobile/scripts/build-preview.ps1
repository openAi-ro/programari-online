param(
  [ValidateSet("preview", "production", "development")]
  [string]$Profile = "preview",

  [ValidateSet("android", "ios")]
  [string]$Platform = "android",

  [switch]$Wait
)

$ErrorActionPreference = "Stop"
$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $mobileRoot

Write-Host ""
Write-Host "Proiect: $mobileRoot" -ForegroundColor Cyan
Write-Host "Build:   platform=$Platform profile=$Profile" -ForegroundColor Cyan
Write-Host ""

if (-not $env:EXPO_TOKEN -or -not $env:EXPO_TOKEN.Trim()) {
  Write-Host "EXPO_TOKEN lipsa." -ForegroundColor Yellow
  Write-Host "1) https://expo.dev/settings/access-tokens" -ForegroundColor Yellow
  Write-Host '2) $env:EXPO_TOKEN = "expon_..."' -ForegroundColor Yellow
  Write-Host "3) Ruleaza din nou: npm run build:preview" -ForegroundColor Yellow
  exit 1
}

$waitArgs = @()
if (-not $Wait) { $waitArgs = @("--no-wait") }

Write-Host "==> Pornesc EAS Build din proiect..." -ForegroundColor Green
& npx --yes eas-cli build -p $Platform --profile $Profile --non-interactive @waitArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Build trimis pe EAS." -ForegroundColor Green
Write-Host "https://expo.dev/accounts/promixt/projects/programari/builds" -ForegroundColor Green