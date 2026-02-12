import { NextRequest, NextResponse } from "next/server";
import { canonicalize } from "@/lib/canonical";
import { verifyEd25519 } from "@/lib/crypto";
import { rateLimitScoped } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { saveStatsSnapshot, type StatsSnapshot } from "@/lib/storage";

const MAX_SKEW_SECONDS = Number(process.env.MAX_SKEW_SECONDS ?? 600);
const RATE_LIMIT = Number(process.env.STATS_RL_LIMIT ?? 10);
const RATE_WINDOW = Number(process.env.STATS_RL_WINDOW ?? 60);
const TRUSTED_STATS_KEYS = new Set(
  (process.env.TRUSTED_STATS_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const allowed = await rateLimitScoped("stats_ip", ip, RATE_LIMIT, RATE_WINDOW);
  if (!allowed) return response({ ok: false, error: "rate_limited" }, 429);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const required = [
    "node_id",
    "public_key",
    "height",
    "difficulty",
    "hashrate_ths",
    "last_block_time",
    "peers",
    "version",
    "uptime_secs",
    "signature"
  ];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null) {
      return response({ ok: false, error: `missing_${field}` }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(payload.last_block_time)) > MAX_SKEW_SECONDS * 24) {
    return response({ ok: false, error: "timestamp_skew" }, 400);
  }

  const hashrateValue = typeof payload.hashrate_ths === "string"
    ? payload.hashrate_ths
    : Number(payload.hashrate_ths);
  const message = canonicalize({
    node_id: String(payload.node_id),
    public_key: String(payload.public_key),
    height: Number(payload.height),
    difficulty: Number(payload.difficulty),
    hashrate_ths: hashrateValue,
    last_block_time: Number(payload.last_block_time),
    peers: Number(payload.peers),
    version: String(payload.version),
    uptime_secs: Number(payload.uptime_secs)
  });

  if (TRUSTED_STATS_KEYS.size > 0 && !TRUSTED_STATS_KEYS.has(String(payload.public_key))) {
    return response({ ok: false, error: "untrusted_key" }, 403);
  }

  const valid = verifyEd25519(message, String(payload.signature), String(payload.public_key));
  if (!valid) return response({ ok: false, error: "bad_signature" }, 401);

  const snapshot: StatsSnapshot = {
    node_id: String(payload.node_id),
    public_key: String(payload.public_key),
    height: Number(payload.height),
    difficulty: Number(payload.difficulty),
    hashrate_ths: Number(payload.hashrate_ths),
    last_block_time: Number(payload.last_block_time),
    peers: Number(payload.peers),
    version: String(payload.version),
    uptime_secs: Number(payload.uptime_secs),
    received_at: now,
    signature: String(payload.signature)
  };

  await saveStatsSnapshot(snapshot);
  return response({ ok: true });
}
