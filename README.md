# alphanumeric.blue

Serverless discovery + light snapshot gateway for the Alphanumeric network.

## What this does
- `POST /api/announce`: nodes announce themselves with signed payloads
- `GET /api/peers`: clients fetch ranked peer list
- `POST /api/headers`: nodes publish signed header snapshots
- `GET /api/chain-snapshot`: site shows last-known network state
- `GET /api/pending-snapshots`: inspect unverified snapshots
- `GET /api/health`: uptime check

## Environment variables
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: required for Vercel KV persistence
- `PEER_TTL_SECONDS` (default `1800`)
- `SNAPSHOT_TTL_SECONDS` (default `3600`)
- `SNAPSHOT_STALE_SECONDS` (default `900`)
- `MAX_SKEW_SECONDS` (default `600`)
- `ANNOUNCE_RL_LIMIT` (default `10`)
- `ANNOUNCE_RL_WINDOW` (default `60`)
- `ANNOUNCE_SUBNET_RL_LIMIT` (default `30`)
- `ANNOUNCE_SUBNET_RL_WINDOW` (default `60`)
- `HEADERS_RL_LIMIT` (default `10`)
- `HEADERS_RL_WINDOW` (default `60`)
- `STATS_API_URL` (optional) indexer stats URL
- `TRUSTED_HEADER_KEYS` (optional) comma-separated Ed25519 public keys
- `TRUSTED_ANNOUNCE_KEYS` (optional) comma-separated Ed25519 public keys
- `EXPECTED_NETWORK_ID` (optional) hex genesis hash or network id
- `SNAPSHOT_QUORUM` (default `2`)
- `SNAPSHOT_QUORUM_WINDOW` (default `3600`)
- `SNAPSHOT_QUORUM_FALLBACK` (default `true`) allow quorum to drop to trusted key count when only 1 trusted key exists

## Canonical signing
The server verifies signatures against a canonical JSON string.
Sort keys lexicographically and exclude the `signature` field.

### Announce message canonical payload
```
{
  "ip": "203.0.113.7",
  "port": 7177,
  "node_id": "node-abc",
  "public_key": "<ed25519 pubkey>",
  "version": "beta-7.2.7",
  "height": 12345,
  "last_seen": 1700000000,
  "latency_ms": 42
}
```

### Headers message canonical payload
```
{
  "height": 12345,
  "last_block_time": 1700000000,
  "headers": [{ "height": 12345, "hash": "...", "prev_hash": "...", "timestamp": 1700000000 }],
  "node_id": "node-abc",
  "public_key": "<ed25519 pubkey>"
}
```

## Local dev
```
npm install
npm run dev
```

## Notes
- Without `KV_REST_API_URL` and `KV_REST_API_TOKEN`, the service uses in-memory storage.
- This is a discovery and light snapshot layer, not a consensus source of truth.
