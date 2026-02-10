import { NextResponse } from "next/server";
import { getHeaderSnapshot, listPeers } from "@/lib/storage";

const STATS_API_URL = process.env.STATS_API_URL;
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

export async function GET() {
  const kvEnabled = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const [snapshot, peers, stats] = await Promise.all([
    getHeaderSnapshot(),
    listPeers(),
    fetchStats()
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

  const lastUpdated = snapshot?.received_at ?? 0;
  const stale = lastUpdated > 0 ? Math.floor(Date.now() / 1000) - lastUpdated > STALE_SECONDS : true;

  return response({
    ok: true,
    source: "snapshot",
    peers: peers.length,
    snapshot,
    stale,
    verified: Boolean(snapshot),
    last_updated: lastUpdated,
    kv_enabled: kvEnabled
  });
}
