param(
  [switch]$Clear,
  [switch]$Web,
  [int]$Port = 8081
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Test-MetroRunning {
  param([int]$ListenPort)
  try {
    $conn = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    return $null -ne $conn
  } catch {
    try {
      $client = New-Object System.Net.Sockets.TcpClient
      $iar = $client.BeginConnect("127.0.0.1", $ListenPort, $null, $null)
      $ok = $iar.AsyncWaitHandle.WaitOne(400)
      if ($ok -and $client.Connected) {
        $client.Close()
        return $true
      }
      $client.Close()
      return $false
    } catch {
      return $false
    }
  }
}

function Open-ExpoWeb {
  param([int]$ListenPort)
  $url = "http://localhost:$ListenPort"
  try {
    Start-Process $url | Out-Null
  } catch {
    Write-Host "Deschide manual: $url" -ForegroundColor Yellow
  }
}

if (Test-MetroRunning -ListenPort $Port) {
  Write-Host "==> Expo / Metro ruleaza deja pe portul $Port" -ForegroundColor Green
  Write-Host "    http://localhost:$Port"
  if ($Web) {
    Open-ExpoWeb -ListenPort $Port
  }
  exit 0
}

Write-Host "==> Expo nu ruleaza. Pornesc Metro pe portul $Port…" -ForegroundColor Cyan

$expoArgs = @("expo", "start", "--port", "$Port")
if ($Clear) { $expoArgs += "--clear" }
if ($Web) { $expoArgs += "--web" }

& npx @expoArgs
exit $LASTEXITCODE