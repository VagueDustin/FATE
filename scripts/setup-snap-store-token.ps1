<#
.SYNOPSIS
  One-time setup: create a Snap Store upload token for the `fate` snap and store it as the
  GitHub Actions secret SNAPCRAFT_STORE_CREDENTIALS, so the Build Linux workflow can publish to
  the stable channel on every release.

.DESCRIPTION
  snapcraft does not run natively on Windows, so this uses Canonical's official container image
  (ghcr.io/canonical/snapcraft). The container prompts for your Ubuntu One email, password and
  two-factor code — that is snapcraft authenticating with Ubuntu One directly. Only the resulting
  token (limited to the `fate` snap and to upload/release rights) is stored in the repository
  secret; the local copy is deleted afterwards.

  Prerequisites: Docker Desktop running; `gh` logged in as the repository owner; the snap name
  registered at https://snapcraft.io/register-snap and the developer terms accepted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-snap-store-token.ps1
#>
param(
  [string]$Repo = 'VagueDustin/FATE',
  [string]$SnapName = 'fate',
  [string]$Image = 'ghcr.io/canonical/snapcraft:8_core24'
)

$ErrorActionPreference = 'Stop'

foreach ($tool in 'docker', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed or not on PATH." }
}
docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "gh is not logged in: run 'gh auth login' first." }

$work = Join-Path $env:TEMP ("snap-token-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$tokenFile = Join-Path $work 'snap-token.txt'

try {
  Write-Host ''
  Write-Host "Creating a Snap Store token for '$SnapName' (upload + release only)." -ForegroundColor Cyan
  Write-Host 'snapcraft will now ask for your Ubuntu One email, password and two-factor code.' -ForegroundColor Cyan
  Write-Host ''

  docker run -it --rm --entrypoint snapcraft -v "${work}:/out" $Image `
    export-login --snaps $SnapName `
    --acls package_access,package_push,package_update,package_release `
    /out/snap-token.txt
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tokenFile)) { throw 'snapcraft export-login did not produce a token.' }

  Get-Content $tokenFile -Raw | gh secret set SNAPCRAFT_STORE_CREDENTIALS --repo $Repo
  if ($LASTEXITCODE -ne 0) { throw 'gh secret set failed.' }

  Write-Host ''
  Write-Host "Stored as SNAPCRAFT_STORE_CREDENTIALS on $Repo." -ForegroundColor Green
  Write-Host 'The next Build Linux run that publishes a release will upload the snap to the stable channel.'
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
