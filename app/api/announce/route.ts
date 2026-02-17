import { NextRequest, NextResponse } from "next/server";
import { canonicalize } from "@/lib/canonical";
import { verifyEd25519 } from "@/lib/crypto";
import { rateLimitScoped } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { savePeer, type PeerRecord } from "@/lib/storage";

const MAX_SKEW_SECONDS = Number(process.env.MAX_SKEW_SECONDS ?? 600);
const RATE_LIMIT = Number(process.env.ANNOUNCE_RL_LIMIT ?? 10);
const RATE_WINDOW = Number(process.env.ANNOUNCE_RL_WINDOW ?? 60);
const SUBNET_LIMIT = Number(process.env.ANNOUNCE_SUBNET_RL_LIMIT ?? 30);
const SUBNET_WINDOW = Number(process.env.ANNOUNCE_SUBNET_RL_WINDOW ?? 60);
const TRUSTED_ANNOUNCE_KEYS = new Set(
  (process.env.TRUSTED_ANNOUNCE_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
);
const REQUIRE_TRUSTED_KEYS = (process.env.REQUIRE_TRUSTED_ANNOUNCE_KEYS ?? "true").toLowerCase() !== "false";

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
  if (REQUIRE_TRUSTED_KEYS && TRUSTED_ANNOUNCE_KEYS.size === 0) {
    return response({ ok: false, error: "server_missing_trusted_announce_keys" }, 500);
  }

  const ip = getClientIp(req);
  const allowed = await rateLimitScoped("announce_ip", ip, RATE_LIMIT, RATE_WINDOW);
  if (!allowed) return response({ ok: false, error: "rate_limited" }, 429);
  const subnet = subnetKey(ip);
  if (subnet) {
    const subnetAllowed = await rateLimitScoped("announce_subnet", subnet, SUBNET_LIMIT, SUBNET_WINDOW);
    if (!subnetAllowed) return response({ ok: false, error: "subnet_rate_limited" }, 429);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const required = ["port", "node_id", "public_key", "version", "height", "last_seen", "signature"];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null) {
      return response({ ok: false, error: `missing_${field}` }, 400);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(payload.last_seen)) > MAX_SKEW_SECONDS) {
    return response({ ok: false, error: "timestamp_skew" }, 400);
  }

  const payloadIp = typeof payload.ip === "string" ? payload.ip.trim() : "";
  const canOverrideIp = TRUSTED_ANNOUNCE_KEYS.has(String(payload.public_key));
  const recordIp = canOverrideIp && payloadIp.trim().length > 0 ? payloadIp : ip;
  const statsPort = payload.stats_port === undefined ? undefined : Number(payload.stats_port);
  const messageIp = payloadIp.length > 0 ? payloadIp : "";
  const message = canonicalize({
    // Keep signature verification aligned with node canonical payload.
    ip: messageIp,
    port: Number(payload.port),
    node_id: String(payload.node_id),
    public_key: String(payload.public_key),
    version: String(payload.version),
    height: Number(payload.height),
    last_seen: Number(payload.last_seen),
    latency_ms: payload.latency_ms === undefined ? undefined : Number(payload.latency_ms),
    stats_port: payload.stats_port === undefined ? undefined : statsPort
  });

  const valid = verifyEd25519(message, String(payload.signature), String(payload.public_key));
  if (!valid) return response({ ok: false, error: "bad_signature" }, 401);

  if ((REQUIRE_TRUSTED_KEYS || TRUSTED_ANNOUNCE_KEYS.size > 0) && !TRUSTED_ANNOUNCE_KEYS.has(String(payload.public_key))) {
    return response({ ok: false, error: "untrusted_key" }, 403);
  }

  const port = Number(payload.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return response({ ok: false, error: "invalid_port" }, 400);
  }

  if (statsPort !== undefined && (!Number.isFinite(statsPort) || statsPort <= 0 || statsPort > 65535)) {
    return response({ ok: false, error: "invalid_stats_port" }, 400);
  }

  const record: PeerRecord = {
    ip: recordIp,
    port,
    node_id: String(payload.node_id),
    version: String(payload.version),
    height: Number(payload.height),
    last_seen: Number(payload.last_seen),
    stats_port: statsPort,
    latency_ms: payload.latency_ms === undefined ? undefined : Number(payload.latency_ms),
    signature: String(payload.signature)
  };

  await savePeer(record);
  return response({ ok: true });
}

function subnetKey(ip: string): string | null {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length < 2) return null;
    return `subnet:${parts.slice(0, 4).join(":")}`;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  return `subnet:${parts[0]}.${parts[1]}.${parts[2]}`;
}
