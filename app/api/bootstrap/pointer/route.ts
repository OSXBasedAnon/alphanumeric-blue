import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import nacl from "tweetnacl";

export const runtime = "nodejs";

type BootstrapLatest = {
  url: string;
  height?: number;
  tip_hash?: string;
  sha256?: string;
  publisher_pubkey?: string;
  manifest_sig?: string;
  updated_at: number;
};

const LATEST_KEY = "bootstrap:latest";
const TRUSTED_PUBLISHER_KEYS = new Set(
  (process.env.TRUSTED_BOOTSTRAP_PUBLISHER_KEYS ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
);
const REQUIRE_TRUSTED_PUBLISHER_KEYS =
  (process.env.REQUIRE_TRUSTED_BOOTSTRAP_PUBLISHER_KEYS ?? "true").toLowerCase() !== "false";

type AuthCheck = "ok" | "missing" | "mismatch";

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error, ...(extra ?? {}) },
    { status, headers: { "cache-control": "no-store" } }
  );
}

function normalizeToken(raw: string): string {
  let t = raw.trim();
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function checkAuth(req: Request): AuthCheck {
  const expectedRaw = process.env.BOOTSTRAP_PUBLISH_TOKEN;
  const expected = expectedRaw ? normalizeToken(expectedRaw) : "";
  if (!expected) return "missing";

  const got = normalizeToken(req.headers.get("authorization") ?? "");

  if (got && got === expected) return "ok";
  return "mismatch";
}

export async function POST(request: Request) {
  const auth = checkAuth(request);
  if (auth === "missing") {
    return jsonError(500, "server_missing_publish_token");
  }

  if (auth !== "ok") {
    return jsonError(401, "unauthorized");
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return jsonError(500, "server_missing_kv_env", {
      hint: "Ensure Vercel KV is connected and KV_REST_API_URL / KV_REST_API_TOKEN exist in production."
    });
  }
  if (REQUIRE_TRUSTED_PUBLISHER_KEYS && TRUSTED_PUBLISHER_KEYS.size === 0) {
    return jsonError(500, "server_missing_trusted_bootstrap_publisher_keys");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json");
  }

  const input = body as Partial<BootstrapLatest>;
  if (!input.url || typeof input.url !== "string") {
    return jsonError(400, "missing_url");
  }
  if (!input.sha256 || typeof input.sha256 !== "string" || input.sha256.trim().length === 0) {
    return jsonError(400, "missing_sha256");
  }
  if (!input.publisher_pubkey || typeof input.publisher_pubkey !== "string") {
    return jsonError(400, "missing_publisher_pubkey");
  }
  if (!input.manifest_sig || typeof input.manifest_sig !== "string") {
    return jsonError(400, "missing_manifest_sig");
  }
  const publisherKey = input.publisher_pubkey.trim().toLowerCase();
  if ((REQUIRE_TRUSTED_PUBLISHER_KEYS || TRUSTED_PUBLISHER_KEYS.size > 0) && !TRUSTED_PUBLISHER_KEYS.has(publisherKey)) {
    return jsonError(403, "untrusted_publisher_pubkey");
  }

  const signedPayload = {
    url: input.url,
    height: typeof input.height === "number" ? input.height : undefined,
    tip_hash: typeof input.tip_hash === "string" ? input.tip_hash : undefined,
    sha256: input.sha256,
    updated_at:
      typeof input.updated_at === "number"
        ? input.updated_at
        : Math.floor(Date.now() / 1000)
  };
  const msg = new TextEncoder().encode(JSON.stringify(signedPayload));
  const decodeHex = (inputHex: string): Uint8Array | null => {
    const clean = inputHex.startsWith("0x") ? inputHex.slice(2) : inputHex;
    if (clean.length % 2 !== 0) return null;
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      const byte = Number.parseInt(clean.slice(i, i + 2), 16);
      if (!Number.isFinite(byte)) return null;
      out[i / 2] = byte;
    }
    return out;
  };
  const pub = decodeHex(publisherKey);
  const sig = decodeHex(input.manifest_sig.trim().toLowerCase());
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) {
    return jsonError(400, "invalid_manifest_signature_encoding");
  }
  const validSig = nacl.sign.detached.verify(msg, sig, pub);
  if (!validSig) {
    return jsonError(401, "invalid_manifest_signature");
  }

  const latest: BootstrapLatest = {
    url: input.url,
    height: typeof input.height === "number" ? input.height : undefined,
    tip_hash: typeof input.tip_hash === "string" ? input.tip_hash : undefined,
    sha256: typeof input.sha256 === "string" ? input.sha256 : undefined,
    publisher_pubkey: publisherKey,
    manifest_sig: input.manifest_sig.trim().toLowerCase(),
    updated_at:
      typeof input.updated_at === "number"
        ? input.updated_at
        : Math.floor(Date.now() / 1000)
  };

  try {
    await kv.set(LATEST_KEY, latest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, "kv_set_failed", { message: msg });
  }

  return NextResponse.json(
    { ok: true, latest },
    { headers: { "cache-control": "no-store" } }
  );
}
