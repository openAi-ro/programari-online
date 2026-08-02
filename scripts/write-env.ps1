# Usage:
#   .\scripts\write-env.ps1 -Url "https://xxxx.supabase.co" -AnonKey "eyJ..."
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$AnonKey
)

$envPath = Join-Path $PSScriptRoot "..\apps\mobile\.env"
$content = @"
EXPO_PUBLIC_SUPABASE_URL=$Url
EXPO_PUBLIC_SUPABASE_ANON_KEY=$AnonKey
"@
Set-Content -Path $envPath -Value $content -Encoding UTF8
Write-Host "Wrote $envPath"
Write-Host "Next: cd apps\mobile ; npx expo start"
