import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { kv } from "@vercel/kv";

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
const MAX_BOOTSTRAP_BYTES = Number(process.env.MAX_BOOTSTRAP_BYTES ?? 512 * 1024 * 1024);

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
  // Tolerate accidental quoting in env var UIs.
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

  const gotHeader = req.headers.get("authorization") ?? "";
  const got = normalizeToken(gotHeader);

  // Accept either:
  // - expected = "<token>", header = "Bearer <token>" (recommended)
  // - expected = "Bearer <token>", header = "Bearer <token>" (tolerate misconfigured env)
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

  // Fail with a useful error if the deployment is missing required integrations.
  // (Otherwise Vercel will return a generic 500 and debugging is painful.)
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return jsonError(500, "server_missing_blob_token", {
      hint: "Set BLOB_READ_WRITE_TOKEN in Vercel Environment Variables (production)."
    });
  }
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return jsonError(500, "server_missing_kv_env", {
      hint: "Ensure Vercel KV is connected and KV_REST_API_URL / KV_REST_API_TOKEN exist in production."
    });
  }

  const url = new URL(request.url);
  const heightRaw = url.searchParams.get("height") ?? undefined;
  const tipHash = url.searchParams.get("tip") ?? undefined;
  const sha256 = url.searchParams.get("sha256") ?? undefined;
  const updatedAtRaw = url.searchParams.get("updated_at") ?? undefined;

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return NextResponse.json(
      { ok: false, error: "empty_body" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  if (body.byteLength > MAX_BOOTSTRAP_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413, headers: { "cache-control": "no-store" } }
    );
  }

  const height = heightRaw ? Number(heightRaw) : undefined;
  if (heightRaw && (!Number.isFinite(height) || height! < 0)) {
    return NextResponse.json(
      { ok: false, error: "invalid height" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const pathname = tipHash
    ? `bootstrap/blockchain.db-h${height ?? "x"}-${tipHash}.zip`
    : `bootstrap/blockchain.db-h${height ?? "x"}.zip`;

  let blob: { url: string };
  try {
    // If the same height/tip is published twice (common during retries), avoid failing with
    // "blob already exists" by always making the object key unique.
    blob = await put(pathname, body, { access: "public", addRandomSuffix: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(500, "blob_put_failed", { message: msg });
  }

  const latest: BootstrapLatest = {
    url: blob.url,
    height,
    tip_hash: tipHash,
    sha256,
    publisher_pubkey: undefined,
    manifest_sig: undefined,
    updated_at: updatedAtRaw ? Number(updatedAtRaw) : Math.floor(Date.now() / 1000)
  };

  try {
    await kv.set(LATEST_KEY, latest);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Blob upload succeeded, but pointer update failed; allow operator to recover via /api/bootstrap/pointer.
    return jsonError(500, "kv_set_failed", {
      message: msg,
      blob_url: blob.url
    });
  }

  return NextResponse.json(
    { ok: true, blob, latest },
    { headers: { "cache-control": "no-store" } }
  );
}
