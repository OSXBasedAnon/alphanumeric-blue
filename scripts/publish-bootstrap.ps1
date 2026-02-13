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
const nacl = require('tweetnacl');

(async () => {
  const zipPath = process.argv[2];
  const pathname = process.argv[3];
  const cacheMaxAge = Number(process.argv[4] || '60');
  const heightRaw = process.argv[5];
  const tipHash = process.argv[6] || '';
  const sha256 = process.argv[7] || '';
  const signingSeedHex = process.env.BOOTSTRAP_SIGNING_SEED || '';

  const stream = fs.createReadStream(zipPath);
  const blob = await put(pathname, stream, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: cacheMaxAge,
    contentType: 'application/zip',
  });

  const manifest = {
    url: blob.url,
    height: Number.isFinite(Number(heightRaw)) && Number(heightRaw) >= 0 ? Number(heightRaw) : undefined,
    tip_hash: tipHash || undefined,
    sha256: sha256 || undefined,
    updated_at: Math.floor(Date.now() / 1000),
  };

  let publisher_pubkey;
  let manifest_sig;
  if (signingSeedHex && signingSeedHex.length === 64) {
    const seed = Buffer.from(signingSeedHex, 'hex');
    const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
    publisher_pubkey = Buffer.from(kp.publicKey).toString('hex');
    const msg = Buffer.from(JSON.stringify(manifest), 'utf8');
    const sig = nacl.sign.detached(new Uint8Array(msg), kp.secretKey);
    manifest_sig = Buffer.from(sig).toString('hex');
  }

  process.stdout.write(JSON.stringify({ url: blob.url, manifest, publisher_pubkey, manifest_sig }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
"@

  $out = & node -e $js $ZipPath $pathname 60 $Height $TipHash $sha256
  $obj = $out | ConvertFrom-Json
  if (!$obj.url) { throw "Blob upload did not return a URL" }

  $pointerUrl = ($PublishUrl -replace "/api/bootstrap/publish.*$", "/api/bootstrap/pointer")
  Write-Output "Updating pointer: $pointerUrl"

  $payload = @{
    url      = $obj.url
    height   = $(if ($Height -ge 0) { $Height } else { $null })
    tip_hash = $(if ($TipHash -ne "") { $TipHash } else { $null })
    sha256   = $sha256
    updated_at = $(if ($obj.manifest -and $obj.manifest.updated_at) { [int]$obj.manifest.updated_at } else { $null })
    publisher_pubkey = $(if ($obj.publisher_pubkey) { [string]$obj.publisher_pubkey } else { $null })
    manifest_sig = $(if ($obj.manifest_sig) { [string]$obj.manifest_sig } else { $null })
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
