param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$PublishUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $false)][int]$Height = -1,
  [Parameter(Mandatory = $false)][string]$TipHash = ""
)

if (!(Test-Path $ZipPath)) {
  throw "ZipPath not found: $ZipPath"
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $ZipPath))
$sha256 = [System.BitConverter]::ToString(
  [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
).Replace("-", "").ToLowerInvariant()

$u = $PublishUrl
if ($Height -ge 0) { $u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "height=$Height") }
if ($TipHash -ne "") { $u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "tip=$TipHash") }
$u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "sha256=$sha256")

Write-Output "Publishing $ZipPath"
Write-Output "sha256=$sha256"
Write-Output "url=$u"

Invoke-RestMethod `
  -Method Post `
  -Uri $u `
  -Headers @{ Authorization = "Bearer $Token" } `
  -ContentType "application/zip" `
  -Body $bytes

