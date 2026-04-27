$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root 'storage\.runtime'
$supervisorPidFile = Join-Path $runtimeDir 'supervisor.pid'
$serverPidFile = Join-Path $runtimeDir 'server.pid'

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

function Get-ProcessLabel {
  param([int]$PidValue)

  if (-not $PidValue) {
    return 'parado'
  }

  $process = Get-Process -Id $PidValue -ErrorAction SilentlyContinue
  if (-not $process) {
    return "parado (PID antigo: $PidValue)"
  }

  return "rodando (PID $PidValue)"
}

$supervisorPid = Read-PidFile -Path $supervisorPidFile
$serverPid = Read-PidFile -Path $serverPidFile
$portStatus = Test-NetConnection -ComputerName localhost -Port 3000 -WarningAction SilentlyContinue

Write-Output "Supervisor: $(Get-ProcessLabel -PidValue $supervisorPid)"
Write-Output "Server: $(Get-ProcessLabel -PidValue $serverPid)"
Write-Output "Porta 3000: $(if ($portStatus.TcpTestSucceeded) { 'aberta' } else { 'fechada' })"

if (Test-Path (Join-Path $runtimeDir 'supervisor.log')) {
  Write-Output "Logs: $runtimeDir"
}
