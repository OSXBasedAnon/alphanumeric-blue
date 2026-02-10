import { NextResponse } from "next/server";
import { getHeaderSnapshot, listPeers, listPendingSnapshots } from "@/lib/storage";
import { scorePeer } from "@/lib/peerScore";

const STATS_API_URL = process.env.STATS_API_URL;
const PEER_STATS_ENABLED = (process.env.PEER_STATS_ENABLED ?? "true").toLowerCase() !== "false";
const PEER_STATS_TIMEOUT_MS = Number(process.env.PEER_STATS_TIMEOUT_MS ?? 1500);
const PEER_STATS_PORT_DEFAULT = Number(process.env.PEER_STATS_PORT_DEFAULT ?? 8787);
const PEER_STATS_MAX_LAG = Number(process.env.PEER_STATS_MAX_LAG ?? 50);
const PEER_STATS_MAX_ATTEMPTS = Number(process.env.PEER_STATS_MAX_ATTEMPTS ?? 8);
const PEER_STATS_MAX_SUCCESSES = Number(process.env.PEER_STATS_MAX_SUCCESSES ?? 4);
const PEER_STATS_ALLOW_PRIVATE = (process.env.PEER_STATS_ALLOW_PRIVATE ?? "false").toLowerCase() === "true";

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

async function fetchPeerStats(): Promise<any | null> {
  if (!PEER_STATS_ENABLED) return null;
  const peers = await listPeers();
  if (peers.length === 0) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const maxAnnounceHeight = peers.reduce((max, peer) => Math.max(max, peer.height ?? 0), 0);
  const minHeight = Math.max(0, maxAnnounceHeight - PEER_STATS_MAX_LAG);

  const sorted = peers
    .filter((p) => p.ip && p.ip !== "0.0.0.0")
    .filter((p) => PEER_STATS_ALLOW_PRIVATE || !isPrivateIp(p.ip))
    .filter((p) => (p.height ?? 0) >= minHeight)
    .sort((a, b) => scorePeer(b, nowSec) - scorePeer(a, nowSec))
    .slice(0, Math.max(6, PEER_STATS_MAX_ATTEMPTS));

  const successes: any[] = [];
  let attempts = 0;
  for (const peer of sorted) {
    if (attempts >= PEER_STATS_MAX_ATTEMPTS) break;
    if (successes.length >= PEER_STATS_MAX_SUCCESSES) break;
    const port = peer.stats_port ?? PEER_STATS_PORT_DEFAULT;
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
    try {
      attempts += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PEER_STATS_TIMEOUT_MS);
      const res = await fetch(`http://${peer.ip}:${port}/stats`, {
        signal: controller.signal,
        cache: "no-store"
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const json = await res.json();
      successes.push(json);
    } catch {
      continue;
    }
  }

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

export async function GET() {
  const kvEnabled = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const [snapshot, peers, stats, peerStats] = await Promise.all([
    getHeaderSnapshot(),
    listPeers(),
    fetchStats(),
    fetchPeerStats()
  ]);

  if (stats) {
    return response({
      ok: true,
      source: "indexer",
      peers: peers.length,
      stats,
      verified: true,
      last_updated: stats.last_block_time ?? Math.floor(Date.now() / 1000),
      kv_enabled: kvEnabled
    });
  }

  if (peerStats) {
    return response({
      ok: true,
      source: "peer",
      peers: peers.length,
      stats: peerStats,
      verified: false,
      last_updated: peerStats.last_block_time ?? Math.floor(Date.now() / 1000),
      kv_enabled: kvEnabled
    });
  }

  let selected = snapshot;
  let source: "snapshot" | "pending" = "snapshot";

  if (!selected) {
    const pending = await listPendingSnapshots();
    if (pending.length > 0) {
      pending.sort((a, b) => {
        if (b.snapshot.height !== a.snapshot.height) {
          return b.snapshot.height - a.snapshot.height;
        }
        return b.received_at - a.received_at;
      });
      selected = pending[0].snapshot;
      source = "pending";
    }
  }

  const lastUpdated = selected?.received_at ?? 0;
  const stale = lastUpdated > 0 ? Math.floor(Date.now() / 1000) - lastUpdated > STALE_SECONDS : true;

  return response({
    ok: true,
    source,
    peers: peers.length,
    snapshot: selected,
    stale,
    verified: Boolean(snapshot),
    last_updated: lastUpdated,
    kv_enabled: kvEnabled
  });
}
