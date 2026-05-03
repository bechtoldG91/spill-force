$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

function Get-RuntimeConfig {
  Push-Location $root
  try {
    $json = node .\scripts\print-runtime-config.js
    return $json | ConvertFrom-Json
  } finally {
    Pop-Location
  }
}

$runtimeConfig = Get-RuntimeConfig
$runtimeDir = $runtimeConfig.logDir
$port = [int]$runtimeConfig.port
$supervisorPidFile = Join-Path $runtimeDir 'supervisor.pid'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$supervisorScript = Join-Path $root 'scripts\server-supervisor.js'

function Read-PidFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  $raw = (Get-Content $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $raw) {
    return $null
  }

  $trimmed = $raw.ToString().Trim()
  if ($trimmed -notmatch '^\d+$') {
    return $null
  }

  return [int]$trimmed
}

function Remove-StalePid {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item $Path -Force -ErrorAction SilentlyContinue
  }
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$existingSupervisorPid = Read-PidFile -Path $supervisorPidFile
if ($existingSupervisorPid) {
  $existingSupervisor = Get-Process -Id $existingSupervisorPid -ErrorAction SilentlyContinue
  if ($existingSupervisor) {
    Write-Output "Servidor estavel ja esta rodando. Supervisor PID: $existingSupervisorPid"
    exit 0
  }

  Remove-StalePid -Path $supervisorPidFile
}

$activeOnPort = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($activeOnPort) {
  $ownerPid = [int]$activeOnPort.OwningProcess
  $ownerProcess = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  $ownerName = if ($ownerProcess) { $ownerProcess.ProcessName } else { 'desconhecido' }
  Write-Error "A porta $port ja esta ocupada pelo processo $ownerName (PID $ownerPid). Pare esse processo antes de iniciar o modo estavel."
}

$process = Start-Process -FilePath node -ArgumentList $supervisorScript -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2

$supervisorPid = Read-PidFile -Path $supervisorPidFile
$serverPid = Read-PidFile -Path $serverPidFile

if (-not $supervisorPid) {
  throw 'O supervisor nao gravou o PID. Veja storage\.runtime\supervisor.log.'
}

Write-Output "Servidor estavel iniciado."
Write-Output "Supervisor PID: $supervisorPid"

if ($serverPid) {
  Write-Output "Server PID: $serverPid"
}

Write-Output "Abra: http://localhost:$port"
