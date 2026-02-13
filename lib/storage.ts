import { kv } from "@vercel/kv";

export type PeerRecord = {
  ip: string;
  port: number;
  node_id: string;
  version: string;
  height: number;
  last_seen: number;
  first_seen?: number;
  seen_count?: number;
  stats_port?: number;
  latency_ms?: number;
  signature: string;
};

export type HeaderSnapshot = {
  height: number;
  network_id?: string;
  last_block_time: number;
  difficulty?: number;
  hashrate_ths?: number;
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

export type StatsSnapshot = {
  node_id: string;
  public_key: string;
  height: number;
  difficulty: number;
  hashrate_ths: number;
  last_block_time: number;
  peers: number;
  version: string;
  uptime_secs: number;
  received_at: number;
  signature: string;
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
const HISTORY_LIMIT = Number(process.env.SNAPSHOT_HISTORY_LIMIT ?? 48);
const STATS_TTL_SECONDS = Number(process.env.STATS_TTL_SECONDS ?? 600);
const STATS_LATEST_TTL_SECONDS = Number(process.env.STATS_LATEST_TTL_SECONDS ?? STATS_TTL_SECONDS * 2);
const PENDING_TTL_SECONDS = Number(process.env.PENDING_TTL_SECONDS ?? QUORUM_WINDOW_SECONDS);

const memoryPeers = new Map<string, PeerRecord>();
let memorySnapshot: HeaderSnapshot | null = null;
const memoryPending = new Map<string, PendingSnapshot>();
const memoryHistory: HeaderSnapshot[] = [];
const memoryStats = new Map<string, StatsSnapshot>();
let memoryLatestStats: StatsSnapshot | null = null;

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

function historyIndexKey(): string {
  return "chain:history:index";
}

function statsKey(nodeId: string): string {
  return `stats:${nodeId}`;
}

function statsIndexKey(): string {
  return "stats:index";
}

function statsLatestKey(): string {
  return "stats:latest";
}

export async function savePeer(peer: PeerRecord): Promise<void> {
  if (!kvEnabled()) {
    const existing = memoryPeers.get(peer.node_id);
    const firstSeen = existing?.first_seen ?? peer.last_seen;
    const seenCount = (existing?.seen_count ?? 0) + 1;
    memoryPeers.set(peer.node_id, { ...peer, first_seen: firstSeen, seen_count: seenCount });
    return;
  }

  const key = peerKey(peer.node_id);
  const existing = (await kv.get(key)) as PeerRecord | null;
  const firstSeen = existing?.first_seen ?? peer.last_seen;
  const seenCount = (existing?.seen_count ?? 0) + 1;
  const record: PeerRecord = { ...peer, first_seen: firstSeen, seen_count: seenCount };
  await kv.set(key, record, { ex: PEER_TTL_SECONDS });
  await kv.sadd(peerIndexKey(), key);
  await kv.expire(peerIndexKey(), PEER_TTL_SECONDS);
}

export async function listPeers(): Promise<PeerRecord[]> {
  if (!kvEnabled()) {
    const now = Math.floor(Date.now() / 1000);
    for (const [nodeId, peer] of memoryPeers.entries()) {
      if (now - peer.last_seen > PEER_TTL_SECONDS) {
        memoryPeers.delete(nodeId);
      }
    }
    return Array.from(memoryPeers.values()).map((peer) => ({
      ...peer,
      first_seen: peer.first_seen ?? peer.last_seen,
      seen_count: peer.seen_count ?? 1
    }));
  }

  const keys = (await kv.smembers(peerIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const peers = (await kv.mget(...keys)) as Array<PeerRecord | null>;
  const staleKeys = keys.filter((_, idx) => !peers[idx]);
  if (staleKeys.length > 0) {
    await kv.srem(peerIndexKey(), ...staleKeys);
  }
  const filtered = peers.filter(Boolean) as PeerRecord[];
  return filtered.map((peer) => ({
    ...peer,
    first_seen: peer.first_seen ?? peer.last_seen,
    seen_count: peer.seen_count ?? 1
  }));
}

export function dedupePeersByEndpoint(peers: PeerRecord[]): PeerRecord[] {
  const bestByEndpoint = new Map<string, PeerRecord>();

  for (const peer of peers) {
    const endpoint = `${peer.ip}:${peer.port}`;
    const existing = bestByEndpoint.get(endpoint);
    if (!existing) {
      bestByEndpoint.set(endpoint, peer);
      continue;
    }

    if ((peer.last_seen ?? 0) > (existing.last_seen ?? 0)) {
      bestByEndpoint.set(endpoint, peer);
      continue;
    }

    if ((peer.height ?? 0) > (existing.height ?? 0)) {
      bestByEndpoint.set(endpoint, peer);
      continue;
    }
  }

  return Array.from(bestByEndpoint.values());
}

export async function saveHeaderSnapshot(snapshot: HeaderSnapshot): Promise<void> {
  if (!kvEnabled()) {
    memorySnapshot = snapshot;
    memoryHistory.unshift(snapshot);
    if (memoryHistory.length > HISTORY_LIMIT) {
      memoryHistory.length = HISTORY_LIMIT;
    }
    return;
  }

  await kv.set(snapshotKey(), snapshot, { ex: SNAPSHOT_TTL_SECONDS });
  const historyKey = `chain:history:${snapshot.received_at}:${snapshot.height}`;
  await kv.set(historyKey, snapshot, { ex: SNAPSHOT_TTL_SECONDS });
  await kv.sadd(historyIndexKey(), historyKey);
  await kv.expire(historyIndexKey(), SNAPSHOT_TTL_SECONDS);
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
  signer: string,
  ttlSeconds = QUORUM_WINDOW_SECONDS
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
  await kv.set(pendingKey, pending, { ex: ttlSeconds });
  await kv.sadd(pendingIndexKey(), pendingKey);
  await kv.expire(pendingIndexKey(), ttlSeconds);
  return pending;
}

export async function listPendingSnapshots(): Promise<PendingSnapshot[]> {
  if (!kvEnabled()) {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, pending] of memoryPending.entries()) {
      if (now - pending.received_at > PENDING_TTL_SECONDS) {
        memoryPending.delete(key);
      }
    }
    return Array.from(memoryPending.values());
  }

  const keys = (await kv.smembers(pendingIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const pending = (await kv.mget(...keys)) as Array<PendingSnapshot | null>;
  return pending.filter(Boolean) as PendingSnapshot[];
}

export async function listSnapshotHistory(): Promise<HeaderSnapshot[]> {
  if (!kvEnabled()) {
    return memoryHistory.slice(0, HISTORY_LIMIT);
  }

  const keys = (await kv.smembers(historyIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const snapshots = (await kv.mget(...keys)) as Array<HeaderSnapshot | null>;
  const filtered = snapshots.filter(Boolean) as HeaderSnapshot[];
  filtered.sort((a, b) => b.received_at - a.received_at);
  return filtered.slice(0, HISTORY_LIMIT);
}

export async function saveStatsSnapshot(snapshot: StatsSnapshot): Promise<void> {
  if (!kvEnabled()) {
    memoryStats.set(snapshot.node_id, snapshot);
    memoryLatestStats = snapshot;
    return;
  }

  const key = statsKey(snapshot.node_id);
  await kv.set(key, snapshot, { ex: STATS_TTL_SECONDS });
  await kv.sadd(statsIndexKey(), key);
  await kv.expire(statsIndexKey(), STATS_TTL_SECONDS);
  await kv.set(statsLatestKey(), snapshot, { ex: STATS_LATEST_TTL_SECONDS });
}

export async function listStatsSnapshots(): Promise<StatsSnapshot[]> {
  if (!kvEnabled()) {
    return Array.from(memoryStats.values());
  }

  const keys = (await kv.smembers(statsIndexKey())) as string[];
  if (!keys || keys.length === 0) return [];

  const stats = (await kv.mget(...keys)) as Array<StatsSnapshot | null>;
  const staleKeys = keys.filter((_, idx) => !stats[idx]);
  if (staleKeys.length > 0) {
    await kv.srem(statsIndexKey(), ...staleKeys);
  }
  return stats.filter(Boolean) as StatsSnapshot[];
}

export async function getLatestStatsSnapshot(): Promise<StatsSnapshot | null> {
  if (!kvEnabled()) {
    return memoryLatestStats;
  }

  const latest = (await kv.get(statsLatestKey())) as StatsSnapshot | null;
  return latest;
}
