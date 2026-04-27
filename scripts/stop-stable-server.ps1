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

function Stop-TrackedProcess {
  param([string]$Label, [string]$PidFile)

  $pidValue = Read-PidFile -Path $PidFile
  if (-not $pidValue) {
    return $false
  }

  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    Write-Output "$Label encerrado (PID $pidValue)."
  }

  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  return $true
}

$stoppedSupervisor = Stop-TrackedProcess -Label 'Supervisor' -PidFile $supervisorPidFile
Start-Sleep -Milliseconds 400
$stoppedServer = Stop-TrackedProcess -Label 'Server' -PidFile $serverPidFile

if (-not $stoppedSupervisor -and -not $stoppedServer) {
  Write-Output 'Nenhum servidor estavel em execucao.'
}
