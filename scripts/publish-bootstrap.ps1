param(
  [Parameter(Mandatory = $true)][string]$ZipPath,
  # Legacy server-upload publish route (can be limited by serverless body size).
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

# Preferred path: upload directly to Vercel Blob (no serverless proxy),
# then atomically update the bootstrap pointer via /api/bootstrap/pointer.
$blobToken = $env:BLOB_READ_WRITE_TOKEN
if ($blobToken -and $blobToken.Trim().Length -gt 0) {
  $node = (Get-Command node -ErrorAction SilentlyContinue)
  if (!$node) { throw "node not found in PATH; required for direct blob upload" }

  # Stable pathname so the URL remains predictable; redirect uses KV pointer for flexibility anyway.
  $pathname = "bootstrap/blockchain.db.zip"

  Write-Output "Uploading to Vercel Blob (direct)..."
  Write-Output "pathname=$pathname"
  Write-Output "sha256=$sha256"

  $js = @"
const fs = require('fs');
const { put } = require('@vercel/blob');

(async () => {
  const zipPath = process.argv[2];
  const pathname = process.argv[3];
  const cacheMaxAge = Number(process.argv[4] || '60');

  const stream = fs.createReadStream(zipPath);
  const blob = await put(pathname, stream, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: cacheMaxAge,
    contentType: 'application/zip',
  });

  process.stdout.write(JSON.stringify({ url: blob.url }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
"@

  $out = & node -e $js $ZipPath $pathname 60
  $obj = $out | ConvertFrom-Json
  if (!$obj.url) { throw "Blob upload did not return a URL" }

  $pointerUrl = ($PublishUrl -replace "/api/bootstrap/publish.*$", "/api/bootstrap/pointer")
  Write-Output "Updating pointer: $pointerUrl"

  $payload = @{
    url      = $obj.url
    height   = $(if ($Height -ge 0) { $Height } else { $null })
    tip_hash = $(if ($TipHash -ne "") { $TipHash } else { $null })
    sha256   = $sha256
  } | ConvertTo-Json -Depth 5

  Invoke-RestMethod `
    -Method Post `
    -Uri $pointerUrl `
    -Headers @{ Authorization = "Bearer $Token" } `
    -ContentType "application/json" `
    -Body $payload

  return
}

# Fallback: server-upload (may fail for large snapshots).
$u = $PublishUrl
if ($Height -ge 0) { $u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "height=$Height") }
if ($TipHash -ne "") { $u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "tip=$TipHash") }
$u += ($(if ($u.Contains("?")) { "&" } else { "?" }) + "sha256=$sha256")

Write-Output "Publishing via server upload (fallback) $ZipPath"
Write-Output "sha256=$sha256"
Write-Output "url=$u"

Invoke-RestMethod `
  -Method Post `
  -Uri $u `
  -Headers @{ Authorization = "Bearer $Token" } `
  -ContentType "application/zip" `
  -Body $bytes
