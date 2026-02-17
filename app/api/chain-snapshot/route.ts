import { NextResponse } from "next/server";
import {
  getHeaderSnapshot,
  listPeers,
  listPendingSnapshots,
  listStatsSnapshots,
  getLatestStatsSnapshot,
  dedupePeersByEndpoint,
  type HeaderSnapshot,
  type PeerRecord
} from "@/lib/storage";
import { scorePeer } from "@/lib/peerScore";

const STATS_API_URL = process.env.STATS_API_URL;
const PEER_STATS_ENABLED = (process.env.PEER_STATS_ENABLED ?? "true").toLowerCase() !== "false";
const PEER_STATS_TIMEOUT_MS = Number(process.env.PEER_STATS_TIMEOUT_MS ?? 1500);
const PEER_STATS_PORT_DEFAULT = Number(process.env.PEER_STATS_PORT_DEFAULT ?? 8787);
const PEER_STATS_MAX_LAG = Number(process.env.PEER_STATS_MAX_LAG ?? 50);
const PEER_STATS_MAX_ATTEMPTS = Number(process.env.PEER_STATS_MAX_ATTEMPTS ?? 4);
const PEER_STATS_MAX_SUCCESSES = Number(process.env.PEER_STATS_MAX_SUCCESSES ?? 2);
const PEER_STATS_ALLOW_PRIVATE = (process.env.PEER_STATS_ALLOW_PRIVATE ?? "false").toLowerCase() === "true";
const PUSH_STATS_ENABLED = (process.env.PUSH_STATS_ENABLED ?? "true").toLowerCase() !== "false";
const PUSH_STATS_MAX_LAG = Number(process.env.PUSH_STATS_MAX_LAG ?? 50);
const SIGNED_SNAPSHOT_MAX_LAG = Number(process.env.SIGNED_SNAPSHOT_MAX_LAG ?? 2);
const STATS_MAX_AGE_SECONDS = Number(process.env.STATS_MAX_AGE_SECONDS ?? 600);
const SOURCE_STICKY_SECONDS = Number(process.env.SOURCE_STICKY_SECONDS ?? 6);
const SOURCE_SWITCH_MIN_HEIGHT_DELTA = Number(process.env.SOURCE_SWITCH_MIN_HEIGHT_DELTA ?? 2);
const CHAIN_SNAPSHOT_CACHE_MS = Number(process.env.CHAIN_SNAPSHOT_CACHE_MS ?? 3000);

function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => Number.isNaN(n))) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return false;
  }
  return true;
}

function isForbiddenPublicProbeTarget(ip: string): boolean {
  if (!isValidIpv4(ip)) return true;
  const [a, b] = ip.split(".").map((p) => Number(p));
  // RFC 6890 special-use ranges (non-routable or sensitive).
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 88) return true; // 192.88.99.0/24 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark nets
  if (a >= 224) return true; // multicast and reserved
  return false;
}

const STALE_SECONDS = Number(process.env.SNAPSHOT_STALE_SECONDS ?? 900);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

function snapshotToStats(snapshot: HeaderSnapshot): {
  height: number;
  difficulty: number;
  hashrate_ths: number;
  last_block_time: number;
} {
  return {
    height: snapshot.height,
    difficulty: Number.isFinite(snapshot.difficulty ?? NaN) ? Number(snapshot.difficulty) : 0,
    hashrate_ths: Number.isFinite(snapshot.hashrate_ths ?? NaN) ? Number(snapshot.hashrate_ths) : 0,
    last_block_time: snapshot.last_block_time
  };
}

function resolvePeerCount(primary: number, ...candidates: Array<unknown>): number {
  let best = Number.isFinite(primary) ? Math.max(0, Number(primary)) : 0;
  for (const candidate of candidates) {
    const value = Number(
      candidate && typeof candidate === "object" && "peers" in (candidate as Record<string, unknown>)
        ? (candidate as Record<string, unknown>).peers
        : NaN
    );
    if (Number.isFinite(value)) {
      best = Math.max(best, value);
    }
  }
  return best;
}

function resolveObservedAt(candidate: any | null | undefined): number {
  if (!candidate || typeof candidate !== "object") return 0;
  const received = Number(candidate.received_at ?? 0);
  if (Number.isFinite(received) && received > 0) return received;
  const lastBlock = Number(candidate.last_block_time ?? 0);
  if (Number.isFinite(lastBlock) && lastBlock > 0) return lastBlock;
  return 0;
}

function deriveAnnounceStats(peers: PeerRecord[], nowSec: number): any | null {
  if (peers.length === 0) return null;

  const fresh = peers
    .filter((p) => Number.isFinite(p.last_seen) && p.last_seen > 0)
    .filter((p) => Math.max(0, nowSec - p.last_seen) <= STATS_MAX_AGE_SECONDS);

  if (fresh.length === 0) return null;

  const best = fresh
    .slice()
    .sort((a, b) => {
      const heightA = Number(a.height ?? 0);
      const heightB = Number(b.height ?? 0);
      if (heightB !== heightA) return heightB - heightA;
      const seenA = Number(a.last_seen ?? 0);
      const seenB = Number(b.last_seen ?? 0);
      return seenB - seenA;
    })[0];

  return {
    height: Number(best.height ?? 0),
    difficulty: 0,
    hashrate_ths: 0,
    last_block_time: 0,
    peers: fresh.length,
    received_at: Number(best.last_seen ?? nowSec)
  };
}

async function fetchStats(): Promise<any | null> {
  if (!STATS_API_URL) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(STATS_API_URL, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchPeerStats(peers: PeerRecord[]): Promise<any | null> {
  if (!PEER_STATS_ENABLED) return null;
  if (peers.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const maxAnnounceHeight = peers.reduce((max, peer) => Math.max(max, peer.height ?? 0), 0);
  const minHeight = Math.max(0, maxAnnounceHeight - PEER_STATS_MAX_LAG);

  const sorted = peers
    .filter((p) => p.ip && p.ip !== "0.0.0.0")
    .filter((p) => !isForbiddenPublicProbeTarget(p.ip))
    .filter((p) => PEER_STATS_ALLOW_PRIVATE || !isPrivateIp(p.ip))
    .filter((p) => (p.height ?? 0) >= minHeight)
    .sort((a, b) => scorePeer(b, nowSec) - scorePeer(a, nowSec))
    .slice(0, Math.max(6, PEER_STATS_MAX_ATTEMPTS));

  const selected = sorted.slice(0, PEER_STATS_MAX_ATTEMPTS);
  const probeResults = await Promise.allSettled(
    selected.map(async (peer) => {
      const port = peer.stats_port ?? PEER_STATS_PORT_DEFAULT;
      if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PEER_STATS_TIMEOUT_MS);
      try {
        const res = await fetch(`http://${peer.ip}:${port}/stats`, {
          signal: controller.signal,
          cache: "no-store"
        });
        if (!res.ok) return null;
        return await res.json();
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  const successes = probeResults
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean)
    .slice(0, PEER_STATS_MAX_SUCCESSES);

  if (successes.length === 0) return null;

  successes.sort((a, b) => {
    const heightA = Number(a.height ?? 0);
    const heightB = Number(b.height ?? 0);
    if (heightB !== heightA) return heightB - heightA;
    const timeA = Number(a.last_block_time ?? 0);
    const timeB = Number(b.last_block_time ?? 0);
    return timeB - timeA;
  });

  return successes[0] ?? null;
}

async function selectPushedStats(): Promise<any | null> {
  if (!PUSH_STATS_ENABLED) return null;
  const stats = await listStatsSnapshots();
  const latest = await getLatestStatsSnapshot();
  const merged = latest ? [latest, ...stats] : stats;
  if (merged.length === 0) return null;

  const maxHeight = merged.reduce((max, s) => Math.max(max, s.height ?? 0), 0);
  const minHeight = Math.max(0, maxHeight - PUSH_STATS_MAX_LAG);
  const filtered = merged.filter((s) => (s.height ?? 0) >= minHeight);
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    if (b.last_block_time !== a.last_block_time) return b.last_block_time - a.last_block_time;
    return (b.received_at ?? 0) - (a.received_at ?? 0);
  });

  return filtered[0] ?? null;
}

type CachedResult = {
  expiresAt: number;
  payload: unknown;
};

type SourceSelection = {
  source: "indexer" | "push" | "peer" | "snapshot" | "pending";
  height: number;
  expiresAt: number;
};

let cachedResult: CachedResult | null = null;
let inflight: Promise<NextResponse> | null = null;
let stickySelection: SourceSelection | null = null;

export async function GET() {
  const nowMs = Date.now();
  if (cachedResult && nowMs < cachedResult.expiresAt) {
    return response(cachedResult.payload);
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const kvEnabled = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
    const [snapshot, peers, stats, pushedStats, pending] = await Promise.all([
      getHeaderSnapshot(),
      listPeers(),
      fetchStats(),
      selectPushedStats(),
      listPendingSnapshots()
    ]);
    const dedupedPeers = dedupePeersByEndpoint(peers);
    const peerStats = await fetchPeerStats(dedupedPeers);
    const announceStats = deriveAnnounceStats(dedupedPeers, nowSec);
    const peerCount = resolvePeerCount(dedupedPeers.length, stats, pushedStats, peerStats);
    const sortedPending = pending.sort((a, b) => {
      if (b.snapshot.height !== a.snapshot.height) return b.snapshot.height - a.snapshot.height;
      return b.received_at - a.received_at;
    });
    const topPending = sortedPending[0] ?? null;
    const signedHeight = Math.max(snapshot?.height ?? 0, topPending?.snapshot.height ?? 0);

    const isTooFarBehindSigned = (candidate: any | null): boolean => {
      if (!candidate || signedHeight === 0) return false;
      return Number(candidate.height ?? 0) < Math.max(0, signedHeight - SIGNED_SNAPSHOT_MAX_LAG);
    };

    const networkCandidates = [
      { source: "indexer" as const, stats },
      { source: "push" as const, stats: pushedStats },
      { source: "peer" as const, stats: peerStats ?? announceStats }
    ]
      .filter((c) => c.stats && !isTooFarBehindSigned(c.stats))
      .filter((c) => {
        const observed = Number(c.stats.received_at ?? c.stats.last_block_time ?? 0);
        return observed > 0 && Math.max(0, nowSec - observed) <= STATS_MAX_AGE_SECONDS;
      })
      .sort((a, b) => {
        const heightA = Number(a.stats.height ?? 0);
        const heightB = Number(b.stats.height ?? 0);
        if (heightB !== heightA) return heightB - heightA;
        const timeA = Number(a.stats.last_block_time ?? 0);
        const timeB = Number(b.stats.last_block_time ?? 0);
        return timeB - timeA;
      });

    let bestNetwork = networkCandidates[0] ?? null;
    if (bestNetwork && stickySelection && stickySelection.expiresAt >= nowSec) {
      const stickyCandidate = networkCandidates.find((c) => c.source === stickySelection?.source);
      if (stickyCandidate) {
        const stickyHeight = Number(stickyCandidate.stats.height ?? 0);
        const bestHeight = Number(bestNetwork.stats.height ?? 0);
        if (stickyHeight + SOURCE_SWITCH_MIN_HEIGHT_DELTA >= bestHeight) {
          bestNetwork = stickyCandidate;
        }
      }
    }
    const snapshotStats = snapshot ? snapshotToStats(snapshot) : null;
    const pendingStats = topPending ? snapshotToStats(topPending.snapshot) : null;

    if (
      snapshotStats &&
      (!pendingStats || snapshotStats.height >= pendingStats.height) &&
      (!bestNetwork || snapshotStats.height >= Number(bestNetwork.stats.height ?? 0))
    ) {
      stickySelection = {
        source: "snapshot",
        height: snapshotStats.height,
        expiresAt: nowSec + SOURCE_STICKY_SECONDS
      };
      const payload = {
        ok: true,
        source: "snapshot",
        peers: peerCount,
        stats: snapshotStats,
        snapshot,
        verified: true,
        verify_state: "verified",
        verify_reason: "signed_snapshot_available",
        last_updated: snapshot?.received_at ?? Math.floor(Date.now() / 1000),
        diagnostics: {
          announce_peers: dedupedPeers.length,
          has_pushed_stats: Boolean(pushedStats),
          has_peer_stats: Boolean(peerStats),
          has_snapshot: Boolean(snapshot),
          has_pending: sortedPending.length > 0
        },
        kv_enabled: kvEnabled
      };
      cachedResult = { expiresAt: Date.now() + CHAIN_SNAPSHOT_CACHE_MS, payload };
      return response(payload);
    }

    if (bestNetwork && (!pendingStats || Number(bestNetwork.stats.height ?? 0) > pendingStats.height)) {
      stickySelection = {
        source: bestNetwork.source,
        height: Number(bestNetwork.stats.height ?? 0),
        expiresAt: nowSec + SOURCE_STICKY_SECONDS
      };
      const verified = bestNetwork.source === "indexer" || Boolean(snapshot);
      const payload = {
        ok: true,
        source: bestNetwork.source,
        peers: peerCount,
        stats: bestNetwork.stats,
        snapshot,
        verified,
        verify_state: verified ? "verified" : "pending",
        verify_reason: verified ? "signed_snapshot_available" : "awaiting_signed_snapshot_quorum",
        last_updated: resolveObservedAt(bestNetwork.stats) || Math.floor(Date.now() / 1000),
        diagnostics: {
          announce_peers: dedupedPeers.length,
          has_pushed_stats: Boolean(pushedStats),
          has_peer_stats: Boolean(peerStats),
          has_snapshot: Boolean(snapshot),
          has_pending: sortedPending.length > 0
        },
        kv_enabled: kvEnabled
      };
      cachedResult = { expiresAt: Date.now() + CHAIN_SNAPSHOT_CACHE_MS, payload };
      return response(payload);
    }

    if (pendingStats) {
      stickySelection = {
        source: "pending",
        height: pendingStats.height,
        expiresAt: nowSec + SOURCE_STICKY_SECONDS
      };
      const payload = {
        ok: true,
        source: "pending",
        peers: resolvePeerCount(peerCount, pendingStats),
        stats: pendingStats,
        snapshot: topPending?.snapshot,
        verified: false,
        verify_state: "pending",
        verify_reason: "awaiting_signed_snapshot_quorum",
        last_updated: topPending?.received_at ?? Math.floor(Date.now() / 1000),
        diagnostics: {
          announce_peers: dedupedPeers.length,
          has_pushed_stats: Boolean(pushedStats),
          has_peer_stats: Boolean(peerStats),
          has_snapshot: Boolean(snapshot),
          has_pending: true
        },
        kv_enabled: kvEnabled
      };
      cachedResult = { expiresAt: Date.now() + CHAIN_SNAPSHOT_CACHE_MS, payload };
      return response(payload);
    }

    const fallbackSource: "snapshot" | "pending" = snapshot ? "snapshot" : "pending";
    const lastUpdated = snapshot?.received_at ?? 0;
    const stale = lastUpdated > 0 ? Math.floor(Date.now() / 1000) - lastUpdated > STALE_SECONDS : true;
    const fallbackStats = snapshot ? snapshotToStats(snapshot) : null;
    const verified = Boolean(snapshot);
    stickySelection = {
      source: fallbackSource,
      height: fallbackStats?.height ?? 0,
      expiresAt: nowSec + SOURCE_STICKY_SECONDS
    };
    const payload = {
      ok: true,
      source: fallbackSource,
      peers: resolvePeerCount(peerCount, fallbackStats),
      stats: fallbackStats,
      snapshot,
      stale,
      verified,
      verify_state: verified ? "verified" : "pending",
      verify_reason: verified ? "signed_snapshot_available" : "awaiting_signed_snapshot_quorum",
      last_updated: lastUpdated,
      diagnostics: {
        announce_peers: dedupedPeers.length,
        has_pushed_stats: false,
        has_peer_stats: false,
        has_snapshot: Boolean(snapshot),
        has_pending: sortedPending.length > 0
      },
      kv_enabled: kvEnabled
    };
    cachedResult = { expiresAt: Date.now() + CHAIN_SNAPSHOT_CACHE_MS, payload };
    return response(payload);
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
