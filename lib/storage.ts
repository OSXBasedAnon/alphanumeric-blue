import { kv } from "@vercel/kv";

export type PeerRecord = {
  ip: string;
  port: number;
  node_id: string;
  version: string;
  height: number;
  last_seen: number;
  latency_ms?: number;
  signature: string;
};

export type HeaderSnapshot = {
  height: number;
  network_id?: string;
  last_block_time: number;
  headers: Array<{
    height: number;
    hash: string;
    prev_hash: string;
    timestamp: number;
  }>;
  node_id: string;
  public_key?: string;
  signature: string;
  received_at: number;
};

export type PendingSnapshot = {
  key: string;
  snapshot: HeaderSnapshot;
  signers: string[];
  received_at: number;
};

const PEER_TTL_SECONDS = Number(process.env.PEER_TTL_SECONDS ?? 1800);
const SNAPSHOT_TTL_SECONDS = Number(process.env.SNAPSHOT_TTL_SECONDS ?? 3600);
const QUORUM_WINDOW_SECONDS = Number(process.env.SNAPSHOT_QUORUM_WINDOW ?? 3600);

const memoryPeers = new Map<string, PeerRecord>();
let memorySnapshot: HeaderSnapshot | null = null;
const memoryPending = new Map<string, PendingSnapshot>();

function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function peerKey(nodeId: string): string {
  return `peer:${nodeId}`;
}

function peerIndexKey(): string {
  return "peers:index";
}

function snapshotKey(): string {
  return "chain:snapshot";
}

function pendingPrefix(): string {
  return "chain:pending:";
}

function pendingIndexKey(): string {
  return "chain:pending:index";
}

export async function savePeer(peer: PeerRecord): Promise<void> {
  if (!kvEnabled()) {
    memoryPeers.set(peer.node_id, peer);
    return;
  }

  const key = peerKey(peer.node_id);
  await kv.set(key, peer, { ex: PEER_TTL_SECONDS });
  await kv.sadd(peerIndexKey(), key);
  await kv.expire(peerIndexKey(), PEER_TTL_SECONDS);
}

export async function listPeers(): Promise<PeerRecord[]> {
  if (!kvEnabled()) {
    const now = Math.floor(Date.now() / 1000);
    const peers = Array.from(memoryPeers.values()).filter(
      (p) => now - p.last_seen <= PEER_TTL_SECONDS
    );
    return peers;
  }

  const keys = (await kv.smembers(peerIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const peers = (await kv.mget(...keys)) as Array<PeerRecord | null>;
  const filtered = peers.filter(Boolean) as PeerRecord[];
  return filtered;
}

export async function saveHeaderSnapshot(snapshot: HeaderSnapshot): Promise<void> {
  if (!kvEnabled()) {
    memorySnapshot = snapshot;
    return;
  }

  await kv.set(snapshotKey(), snapshot, { ex: SNAPSHOT_TTL_SECONDS });
}

export async function getHeaderSnapshot(): Promise<HeaderSnapshot | null> {
  if (!kvEnabled()) {
    return memorySnapshot;
  }

  const snapshot = (await kv.get(snapshotKey())) as HeaderSnapshot | null;
  return snapshot;
}

export async function upsertPendingSnapshot(
  key: string,
  snapshot: HeaderSnapshot,
  signer: string
): Promise<PendingSnapshot> {
  const now = Math.floor(Date.now() / 1000);

  if (!kvEnabled()) {
    const existing = memoryPending.get(key);
    const signers = new Set(existing?.signers ?? []);
    signers.add(signer);
    const pending: PendingSnapshot = {
      key,
      snapshot,
      signers: Array.from(signers),
      received_at: now
    };
    memoryPending.set(key, pending);
    return pending;
  }

  const pendingKey = `${pendingPrefix()}${key}`;
  const existing = (await kv.get(pendingKey)) as PendingSnapshot | null;
  const signers = new Set(existing?.signers ?? []);
  signers.add(signer);

  const pending: PendingSnapshot = {
    key,
    snapshot,
    signers: Array.from(signers),
    received_at: now
  };
  await kv.set(pendingKey, pending, { ex: QUORUM_WINDOW_SECONDS });
  await kv.sadd(pendingIndexKey(), pendingKey);
  await kv.expire(pendingIndexKey(), QUORUM_WINDOW_SECONDS);
  return pending;
}

export async function listPendingSnapshots(): Promise<PendingSnapshot[]> {
  if (!kvEnabled()) {
    return Array.from(memoryPending.values());
  }

  const keys = (await kv.smembers(pendingIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const pending = (await kv.mget(...keys)) as Array<PendingSnapshot | null>;
  return pending.filter(Boolean) as PendingSnapshot[];
}
