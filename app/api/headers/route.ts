import { NextRequest, NextResponse } from "next/server";
import { canonicalize } from "@/lib/canonical";
import { verifyEd25519 } from "@/lib/crypto";
import { rateLimitScoped } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import {
  dedupePeersByEndpoint,
  getHeaderSnapshot,
  listPeers,
  saveHeaderSnapshot,
  upsertPendingSnapshot,
  type HeaderSnapshot
} from "@/lib/storage";

const MAX_SKEW_SECONDS = Number(process.env.MAX_SKEW_SECONDS ?? 600);
const RATE_LIMIT = Number(process.env.HEADERS_RL_LIMIT ?? 10);
const RATE_WINDOW = Number(process.env.HEADERS_RL_WINDOW ?? 60);
const TRUSTED_KEYS = new Set(
  (process.env.TRUSTED_HEADER_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
);
const REQUIRED_QUORUM = Number(process.env.SNAPSHOT_QUORUM ?? 2);
const MIN_REQUIRED_QUORUM = Math.max(2, Number(process.env.SNAPSHOT_MIN_QUORUM ?? 2));
const EXPECTED_NETWORK_ID = process.env.EXPECTED_NETWORK_ID ?? "";
const BOOTSTRAP_QUORUM_THRESHOLD = Number(process.env.BOOTSTRAP_QUORUM_THRESHOLD ?? 2);
const BOOTSTRAP_QUORUM = Number(process.env.BOOTSTRAP_QUORUM ?? 1);
const BOOTSTRAP_PENDING_WINDOW = Number(process.env.BOOTSTRAP_PENDING_WINDOW ?? 900);
const REQUIRE_TRUSTED_KEYS = (process.env.REQUIRE_TRUSTED_HEADER_KEYS ?? "true").toLowerCase() !== "false";
const ALLOW_SINGLE_SIGNER_BOOTSTRAP =
  (process.env.ALLOW_SINGLE_SIGNER_BOOTSTRAP ?? "false").toLowerCase() === "true";

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
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function GET() {
  const snapshot = await getHeaderSnapshot();
  return response({ ok: true, snapshot });
}

export async function POST(req: NextRequest) {
  if (REQUIRE_TRUSTED_KEYS && TRUSTED_KEYS.size === 0) {
    return response({ ok: false, error: "server_missing_trusted_header_keys" }, 500);
  }

  const ip = getClientIp(req);
  const allowed = await rateLimitScoped("headers_ip", ip, RATE_LIMIT, RATE_WINDOW);
  if (!allowed) return response({ ok: false, error: "rate_limited" }, 429);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return response({ ok: false, error: "invalid_json" }, 400);
  }

  const required = ["height", "last_block_time", "headers", "node_id", "public_key", "signature"];
  for (const field of required) {
    if (payload[field] === undefined || payload[field] === null) {
      return response({ ok: false, error: `missing_${field}` }, 400);
    }
  }

  if (!Array.isArray(payload.headers) || payload.headers.length === 0 || payload.headers.length > 256) {
    return response({ ok: false, error: "invalid_headers" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(payload.last_block_time)) > MAX_SKEW_SECONDS * 24) {
    return response({ ok: false, error: "timestamp_skew" }, 400);
  }

  if (payload.difficulty !== undefined && !Number.isFinite(Number(payload.difficulty))) {
    return response({ ok: false, error: "invalid_difficulty" }, 400);
  }
  if (payload.hashrate_ths !== undefined && !Number.isFinite(Number(payload.hashrate_ths))) {
    return response({ ok: false, error: "invalid_hashrate" }, 400);
  }

  const message = canonicalize({
    height: Number(payload.height),
    network_id: payload.network_id ? String(payload.network_id) : undefined,
    last_block_time: Number(payload.last_block_time),
    difficulty: payload.difficulty === undefined ? undefined : Number(payload.difficulty),
    hashrate_ths: payload.hashrate_ths === undefined ? undefined : Number(payload.hashrate_ths),
    headers: payload.headers,
    node_id: String(payload.node_id),
    public_key: String(payload.public_key)
  });

  if ((REQUIRE_TRUSTED_KEYS || TRUSTED_KEYS.size > 0) && !TRUSTED_KEYS.has(String(payload.public_key))) {
    return response({ ok: false, error: "untrusted_key" }, 403);
  }

  if (EXPECTED_NETWORK_ID && String(payload.network_id ?? "") !== EXPECTED_NETWORK_ID) {
    return response({ ok: false, error: "network_id_mismatch" }, 403);
  }

  const valid = verifyEd25519(message, String(payload.signature), String(payload.public_key));
  if (!valid) return response({ ok: false, error: "bad_signature" }, 401);

  if (!validateHeaderChain(payload.headers)) {
    return response({ ok: false, error: "invalid_header_chain" }, 400);
  }

  const snapshot: HeaderSnapshot = {
    height: Number(payload.height),
    network_id: payload.network_id ? String(payload.network_id) : undefined,
    last_block_time: Number(payload.last_block_time),
    difficulty: payload.difficulty === undefined ? undefined : Number(payload.difficulty),
    hashrate_ths: payload.hashrate_ths === undefined ? undefined : Number(payload.hashrate_ths),
    headers: payload.headers,
    node_id: String(payload.node_id),
    public_key: String(payload.public_key),
    signature: String(payload.signature),
    received_at: now
  };

  const headerKey = `${snapshot.network_id ?? "unknown"}:${snapshot.height}:${snapshot.headers.at(-1)?.hash ?? "none"}`;
  const peers = dedupePeersByEndpoint(await listPeers());
  const bootstrapMode = peers.length < BOOTSTRAP_QUORUM_THRESHOLD;
  const pendingTtl = bootstrapMode ? BOOTSTRAP_PENDING_WINDOW : undefined;
  const pending = await upsertPendingSnapshot(
    headerKey,
    snapshot,
    String(payload.public_key),
    pendingTtl
  );
  const trustedSigners = pending.signers.filter((k) => TRUSTED_KEYS.has(k));
  const baseQuorum = Math.max(REQUIRED_QUORUM, MIN_REQUIRED_QUORUM);
  const bootstrapQuorum = ALLOW_SINGLE_SIGNER_BOOTSTRAP
    ? Math.max(1, BOOTSTRAP_QUORUM)
    : Math.max(2, BOOTSTRAP_QUORUM);
  const effectiveQuorum = bootstrapMode ? bootstrapQuorum : baseQuorum;
  const quorumReached = trustedSigners.length >= effectiveQuorum;

  if (quorumReached) {
    await saveHeaderSnapshot(snapshot);
  }

  return response({
    ok: true,
    quorum: trustedSigners.length,
    required_quorum: effectiveQuorum,
    verified: quorumReached,
    bootstrap: bootstrapMode
  });
}

function validateHeaderChain(headers: Array<any>): boolean {
  for (let i = 1; i < headers.length; i += 1) {
    const prev = headers[i - 1];
    const current = headers[i];
    if (typeof prev.hash !== "string" || typeof current.prev_hash !== "string") return false;
    if (current.prev_hash !== prev.hash) return false;
    if (typeof current.height !== "number" || typeof prev.height !== "number") return false;
    if (current.height !== prev.height + 1) return false;
    if (typeof current.timestamp !== "number" || typeof prev.timestamp !== "number") return false;
    if (current.timestamp < prev.timestamp) return false;
  }
  return true;
}
