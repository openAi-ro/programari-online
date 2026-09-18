param(
  [switch]$SkipOpenBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

$bundleId = "com.programari.app"

Write-Host ""
Write-Host "=== Setup push iOS (APNs) pentru Programari ===" -ForegroundColor Cyan
Write-Host "Bundle ID: $bundleId"
Write-Host ""

# 1) Verifica app.json
$appJsonPath = Join-Path $root "app.json"
$app = Get-Content -LiteralPath $appJsonPath -Raw | ConvertFrom-Json
$ios = $app.expo.ios
if ($ios.bundleIdentifier -eq $bundleId) {
  Write-Host "[OK] app.json ios.bundleIdentifier = $bundleId" -ForegroundColor Green
} else {
  Write-Host "[ATENTIE] ios.bundleIdentifier = $($ios.bundleIdentifier) (asteptat $bundleId)" -ForegroundColor Yellow
}
if ($ios.buildNumber) {
  Write-Host "[OK] ios.buildNumber = $($ios.buildNumber)" -ForegroundColor Green
} else {
  Write-Host "[LIPSA] ios.buildNumber in app.json" -ForegroundColor Yellow
}

# 2) Verifica profiluri iOS in eas.json
$easPath = Join-Path $root "eas.json"
if (Test-Path -LiteralPath $easPath) {
  $eas = Get-Content -LiteralPath $easPath -Raw | ConvertFrom-Json
  foreach ($profile in @("development", "preview", "production")) {
    $iosProfile = $eas.build.$profile.ios
    if ($iosProfile) {
      Write-Host "[OK] eas.json build.$profile.ios prezent" -ForegroundColor Green
    } else {
      Write-Host "[LIPSA] eas.json build.$profile.ios" -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "[LIPSA] eas.json" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Pasi manuali (o singura data, cer cont Apple Developer - 99 USD/an):" -ForegroundColor Cyan
Write-Host ""
Write-Host "A) Apple Developer (https://developer.apple.com/account):"
Write-Host "   1) Inscrie-te in Apple Developer Program (daca nu esti deja)"
Write-Host "   2) Certificates, Identifiers & Profiles > Keys > Create a key"
Write-Host "      - Name: Programari Push"
Write-Host "      - Bifeaza 'Apple Push Notifications service (APNs)'"
Write-Host "      - Download .p8 (SE ARATA O SINGURA DATA) + noteaza Key ID + Team ID"
Write-Host ""
Write-Host "B) Incarca cheia APNs in EAS (din acest director):"
Write-Host "   npx eas-cli credentials -p ios"
Write-Host "   -> Push Notifications -> Upload Apple Push Key (.p8 + Key ID + Team ID)"
Write-Host "   sau din dashboard: https://expo.dev/accounts/promixt/projects/programari/credentials"
Write-Host ""
Write-Host "C) Inregistreaza iPhone-ul de test (doar pentru preview ad-hoc):"
Write-Host "   npx eas-cli device:create"
Write-Host "   (deschizi linkul pe iPhone, instalezi profilul, revii in terminal)"
Write-Host "   ALTERNATIVA fara UDID: TestFlight (vezi pasul E)"
Write-Host ""
Write-Host "D) Build iOS:"
Write-Host "   npx eas-cli build -p ios --profile preview"
Write-Host "   -> instalezi .ipa din linkul EAS (sau QR) pe iPhone-ul inregistrat"
Write-Host "   -> pe telefon: Setari -> Activeaza notificarile (toate verde)"
Write-Host ""
Write-Host "E) Productie (App Store / TestFlight):"
Write-Host "   1) App Store Connect (https://appstoreconnect.apple.com) > Apps > + "
Write-Host "      (Bundle ID exact: $bundleId, SKU: orice unic)"
Write-Host "   2) Pune App ID-ul numeric in eas.json > submit > production > ios > ascAppId"
Write-Host "   3) npx eas-cli build -p ios --profile production"
Write-Host "   4) npx eas-cli submit -p ios --profile production"
Write-Host "   5) In TestFlight (appstoreconnect) adauga testerii interni/externi"
Write-Host ""
Write-Host "F) Dupa primul build iOS reusit, da-mi linkul de instalare iOS"
Write-Host "   (TestFlight public link sau linkul .ipa EAS) ca sa-l pun in QR:"
Write-Host "   app.json > extra > iosInstallUrl  (sau env EXPO_PUBLIC_IOS_INSTALL_URL)"
Write-Host "   apoi: publish-update pe canalul preview"
Write-Host ""
Write-Host "NOTE:" -ForegroundColor Cyan
Write-Host "- Nu ai nevoie de Mac: build-ul se face in cloud (EAS)."
Write-Host "- Push-ul pe iOS NU merge pe simulator, doar pe iPhone fizic."
Write-Host "- OTA update-urile merg si pe iOS (acelasi canal preview/production)."
Write-Host ""

if (-not $SkipOpenBrowser) {
  $choice = Read-Host "Deschid Apple Developer + EAS credentials in browser? (d/n)"
  if ($choice -eq "d") {
    try { Start-Process "https://developer.apple.com/account/resources/authkeys/list" } catch {}
    try { Start-Process "https://expo.dev/accounts/promixt/projects/programari/credentials" } catch {}
  }
}
