<#
.SYNOPSIS
  One-time setup: store the Microsoft Partner Center API credentials as GitHub Actions secrets, for
  submitting each new .appx to the Microsoft Store from CI (msstore-cli).

.DESCRIPTION
  Prompts for the five values from Partner Center and stores them as repository secrets. Nothing
  is written to disk.

  No workflow uses these secrets yet: Build Windows (.github/workflows/build-windows.yml) builds
  the .appx and keeps it on the run, and the submission is made by hand in Partner Center. This
  script prepares the credentials for a submission step; it does not add one.

  Works in Windows PowerShell 5.1 (the `powershell` command below) and in PowerShell 7.

  Where each value comes from:

    Tenant ID, Client ID, Client secret
        Partner Center -> Settings (gear) -> Account settings -> User management ->
        Azure AD applications -> your CI application. The secret is shown ONCE when you create a
        key; paste it here.
    Seller ID
        Partner Center -> Settings -> Account settings -> Organization profile -> Legal info
        (also shown on the Azure AD applications page).
    Store ID
        Partner Center -> Apps and games -> FATE -> Product management -> Product identity,
        the "Store ID" that starts with 9N.

  Secret names match the ones Microsoft's own GitHub Action documentation uses.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup-msstore-credentials.ps1
#>
param(
  [string]$Repo = 'VagueDustin/FATE'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'gh is not installed or not on PATH.' }
# Windows PowerShell 5.1 turns a redirected native command's stderr into a terminating error while
# ErrorActionPreference is Stop, so a logged-out gh would end the script with its own message
# instead of this one. Judge gh by its exit code.
$ErrorActionPreference = 'Continue'
gh auth status *> $null
$ghLoggedIn = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $ghLoggedIn) { throw "gh is not logged in: run 'gh auth login' first." }

function Read-Guid([string]$label) {
  while ($true) {
    $v = (Read-Host $label).Trim()
    if ($v -match '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') { return $v }
    Write-Host "  That does not look like a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Try again." -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host "Microsoft Store publishing credentials for $Repo" -ForegroundColor Cyan
Write-Host 'Values are sent straight to GitHub as repository secrets; nothing is saved locally.' -ForegroundColor Cyan
Write-Host ''

$tenantId = Read-Guid 'Tenant ID'
$clientId = Read-Guid 'Client ID (Application ID)'
$secure   = Read-Host 'Client secret' -AsSecureString
$sellerId = (Read-Host 'Seller ID (digits)').Trim()
$storeId  = (Read-Host 'Store ID of FATE (starts with 9N)').Trim()

if ($sellerId -notmatch '^\d+$') { throw 'Seller ID should be all digits.' }
if ($storeId -notmatch '^9[A-Z0-9]{11}$') { throw 'Store ID should be 12 characters starting with 9, e.g. 9NBLGGH4R315.' }

# ConvertFrom-SecureString -AsPlainText exists only in PowerShell 7; the BSTR round trip works in
# 5.1 as well. The unmanaged copy is zeroed and freed straight away.
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $clientSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($clientSecret)) { throw 'Client secret was empty.' }

# A failing native command does not stop the script by itself, so each one is checked: the
# message at the end must not claim secrets that were never stored.
$failed = @()
gh secret set PARTNER_CENTER_TENANT_ID     --repo $Repo --body $tenantId
if ($LASTEXITCODE -ne 0) { $failed += 'PARTNER_CENTER_TENANT_ID' }
gh secret set PARTNER_CENTER_CLIENT_ID     --repo $Repo --body $clientId
if ($LASTEXITCODE -ne 0) { $failed += 'PARTNER_CENTER_CLIENT_ID' }
$clientSecret | gh secret set PARTNER_CENTER_CLIENT_SECRET --repo $Repo
if ($LASTEXITCODE -ne 0) { $failed += 'PARTNER_CENTER_CLIENT_SECRET' }
gh secret set PARTNER_CENTER_SELLER_ID     --repo $Repo --body $sellerId
if ($LASTEXITCODE -ne 0) { $failed += 'PARTNER_CENTER_SELLER_ID' }
gh secret set MSSTORE_APP_ID               --repo $Repo --body $storeId
if ($LASTEXITCODE -ne 0) { $failed += 'MSSTORE_APP_ID' }
$clientSecret = $null
if ($failed.Count -gt 0) { throw "gh could not store $($failed -join ', ') on $Repo. Run the script again." }

Write-Host ''
Write-Host "Stored PARTNER_CENTER_TENANT_ID, PARTNER_CENTER_CLIENT_ID, PARTNER_CENTER_CLIENT_SECRET, PARTNER_CENTER_SELLER_ID and MSSTORE_APP_ID on $Repo." -ForegroundColor Green
Write-Host 'No workflow submits to the Microsoft Store yet. Until one does, upload the .appx from the Build Windows run in Partner Center.'
