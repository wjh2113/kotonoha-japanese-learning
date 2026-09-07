param(
  [ValidateSet('init', 'start', 'stop', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cluster = Join-Path $projectRoot '.postgres-data'
$logFile = Join-Path $cluster 'postgres.log'
$candidates = @(
  $env:POSTGRES_BIN,
  'D:\Program Files\PostgreSQL\18\bin',
  'C:\Program Files\PostgreSQL\18\bin'
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'pg_ctl.exe')) }

if (-not $candidates) { throw 'PostgreSQL 18 binaries were not found. Set POSTGRES_BIN or use Docker Compose.' }
$pgBin = @($candidates)[0]
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'

function Test-Running {
  & $pgCtl status -D $cluster *> $null
  return $LASTEXITCODE -eq 0
}

function Start-LocalPostgres {
  if (Test-Running) { Write-Output 'KOTONOHA PostgreSQL is already running on port 5433.'; return }
  & $pgCtl start -D $cluster -l $logFile -o '-p 5433 -h 127.0.0.1' -w
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start. Check .postgres-data/postgres.log.' }
}

if ($Action -eq 'init') {
  if (-not (Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION'))) {
    & (Join-Path $pgBin 'initdb.exe') -D $cluster -U postgres -A trust --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
  }
  Start-LocalPostgres
  $psql = Join-Path $pgBin 'psql.exe'
  $roleExists = ((& $psql -w -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='kotonoha_app'") -join '').Trim()
  if ($roleExists -ne '1') { & $psql -w -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE ROLE kotonoha_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;' }
  $databaseExists = ((& $psql -w -h 127.0.0.1 -p 5433 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='kotonoha'") -join '').Trim()
  if ($databaseExists -ne '1') { & (Join-Path $pgBin 'createdb.exe') -w -h 127.0.0.1 -p 5433 -U postgres -O kotonoha_app kotonoha }
  Write-Output 'KOTONOHA PostgreSQL is initialized.'
  exit 0
}

if ($Action -eq 'start') { Start-LocalPostgres; exit 0 }
if ($Action -eq 'status') { if (Test-Running) { Write-Output 'running'; exit 0 } else { Write-Output 'stopped'; exit 1 } }
if ($Action -eq 'stop') {
  if (Test-Running) { & $pgCtl stop -D $cluster -m fast -w }
  Write-Output 'KOTONOHA PostgreSQL is stopped.'
}
