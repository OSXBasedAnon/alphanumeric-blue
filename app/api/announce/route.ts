import { NextRequest, NextResponse } from "next/server";
import { canonicalize } from "@/lib/canonical";
import { verifyEd25519 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rateLimit";
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0.0.0.0";
  const allowed = await rateLimit(ip, RATE_LIMIT, RATE_WINDOW);
  if (!allowed) return response({ ok: false, error: "rate_limited" }, 429);
  const subnet = subnetKey(ip);
  if (subnet) {
    const subnetAllowed = await rateLimit(subnet, SUBNET_LIMIT, SUBNET_WINDOW);
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

  const ipValue = typeof payload.ip === "string" && payload.ip.trim().length > 0 ? payload.ip : ip;
  const message = canonicalize({
    ip: ipValue,
    port: Number(payload.port),
    node_id: String(payload.node_id),
    public_key: String(payload.public_key),
    version: String(payload.version),
    height: Number(payload.height),
    last_seen: Number(payload.last_seen),
    latency_ms: payload.latency_ms === undefined ? undefined : Number(payload.latency_ms)
  });

  const valid = verifyEd25519(message, String(payload.signature), String(payload.public_key));
  if (!valid) return response({ ok: false, error: "bad_signature" }, 401);

  if (TRUSTED_ANNOUNCE_KEYS.size > 0 && !TRUSTED_ANNOUNCE_KEYS.has(String(payload.public_key))) {
    return response({ ok: false, error: "untrusted_key" }, 403);
  }

  const port = Number(payload.port);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return response({ ok: false, error: "invalid_port" }, 400);
  }

  const record: PeerRecord = {
    ip: ipValue,
    port,
    node_id: String(payload.node_id),
    version: String(payload.version),
    height: Number(payload.height),
    last_seen: Number(payload.last_seen),
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
