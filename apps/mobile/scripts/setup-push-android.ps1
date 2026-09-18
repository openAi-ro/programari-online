param(
  [switch]$SkipOpenBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$gsPath = Join-Path $root "google-services.json"
$pkg = "com.programari.app"

Write-Host ""
Write-Host "=== Setup push Android (FCM) pentru Programari ===" -ForegroundColor Cyan
Write-Host "Package: $pkg"
Write-Host ""

if (Test-Path -LiteralPath $gsPath) {
  Write-Host "[OK] gasit google-services.json" -ForegroundColor Green
} else {
  Write-Host "[LIPSA] google-services.json" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Pasi (o singura data):" -ForegroundColor Yellow
  Write-Host "1) Deschide Firebase Console: https://console.firebase.google.com/"
  Write-Host "2) Creeaza / alege un proiect Firebase"
  Write-Host "3) Adauga o aplicatie Android cu package name exact: $pkg"
  Write-Host "4) Descarca google-services.json"
  Write-Host "5) Copiaza fisierul aici:"
  Write-Host "   $gsPath"
  Write-Host "6) Ruleaza din nou acest script"
  Write-Host ""
  if (-not $SkipOpenBrowser) {
    try { Start-Process "https://console.firebase.google.com/" } catch {}
  }
  exit 1
}

# Verifica package-ul din fisier
try {
  $json = Get-Content -LiteralPath $gsPath -Raw | ConvertFrom-Json
  $packages = @()
  foreach ($client in @($json.client)) {
    $p = $client.client_info.android_client_info.package_name
    if ($p) { $packages += $p }
  }
  if ($packages -contains $pkg) {
    Write-Host "[OK] package $pkg gasit in google-services.json" -ForegroundColor Green
  } else {
    Write-Host "[ATENTIE] package-ul $pkg nu apare in google-services.json" -ForegroundColor Red
    Write-Host "   Package-uri gasite: $($packages -join ', ')"
    Write-Host "   Adauga aplicatia Android cu package-ul corect in Firebase, apoi re-descarca fisierul."
    exit 1
  }
} catch {
  Write-Host "[EROARE] nu am putut citi google-services.json: $_" -ForegroundColor Red
  exit 1
}

# Asigura app.json
$appJsonPath = Join-Path $root "app.json"
$app = Get-Content -LiteralPath $appJsonPath -Raw | ConvertFrom-Json
if (-not $app.expo.android.googleServicesFile) {
  $app.expo.android | Add-Member -NotePropertyName googleServicesFile -NotePropertyValue "./google-services.json" -Force
  $app | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $appJsonPath -Encoding UTF8
  Write-Host "[OK] app.json actualizat: android.googleServicesFile = ./google-services.json" -ForegroundColor Green
} else {
  Write-Host "[OK] app.json deja are googleServicesFile = $($app.expo.android.googleServicesFile)" -ForegroundColor Green
}

Write-Host ""
Write-Host "Urmatorii pasi (obligatoriu pentru push pe telefon):" -ForegroundColor Cyan
Write-Host "A) In Firebase: Project settings > Service accounts > Generate new private key"
Write-Host "   (NU comite acest JSON in git — e secret)"
Write-Host "B) Incarca cheia FCM V1 in EAS:"
Write-Host "   npx eas-cli credentials -p android"
Write-Host "   → Google Service Account → FCM V1 → Upload"
Write-Host "   sau din dashboard: https://expo.dev/accounts/promixt/projects/programari/credentials"
Write-Host "C) Rebuild APK (OTA nu ajuta):"
Write-Host "   npm run build:preview"
Write-Host "D) Instaleaza noul APK pe telefon, deschide Setari → Activeaza notificari"
Write-Host ""
