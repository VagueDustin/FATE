<#
.SYNOPSIS
  One-time setup: store the Microsoft Partner Center API credentials as GitHub Actions secrets so
  the release workflow can submit each new .appx to the Microsoft Store (msstore-cli).

.DESCRIPTION
  Prompts for the five values from Partner Center and stores them as repository secrets. Nothing
  is written to disk. Where each value comes from:

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
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { throw "gh is not logged in: run 'gh auth login' first." }

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

$clientSecret = ConvertFrom-SecureString -SecureString $secure -AsPlainText
if ([string]::IsNullOrWhiteSpace($clientSecret)) { throw 'Client secret was empty.' }

gh secret set PARTNER_CENTER_TENANT_ID     --repo $Repo --body $tenantId
gh secret set PARTNER_CENTER_CLIENT_ID     --repo $Repo --body $clientId
$clientSecret | gh secret set PARTNER_CENTER_CLIENT_SECRET --repo $Repo
gh secret set PARTNER_CENTER_SELLER_ID     --repo $Repo --body $sellerId
gh secret set MSSTORE_APP_ID               --repo $Repo --body $storeId
$clientSecret = $null

Write-Host ''
Write-Host "Stored PARTNER_CENTER_TENANT_ID, PARTNER_CENTER_CLIENT_ID, PARTNER_CENTER_CLIENT_SECRET, PARTNER_CENTER_SELLER_ID and MSSTORE_APP_ID on $Repo." -ForegroundColor Green
Write-Host 'The release workflow will submit each new .appx to the Microsoft Store from now on.'
