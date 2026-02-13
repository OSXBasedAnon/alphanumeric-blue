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

type AuthCheck = "ok" | "missing" | "mismatch";

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
    return NextResponse.json(
      { ok: false, error: "server_missing_publish_token" },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  if (auth !== "ok") {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const url = new URL(request.url);
  const heightRaw = url.searchParams.get("height") ?? undefined;
  const tipHash = url.searchParams.get("tip") ?? undefined;
  const sha256 = url.searchParams.get("sha256") ?? undefined;
  const publisherPubkey = url.searchParams.get("publisher_pubkey") ?? undefined;
  const manifestSig = url.searchParams.get("manifest_sig") ?? undefined;
  const updatedAtRaw = url.searchParams.get("updated_at") ?? undefined;

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return NextResponse.json(
      { ok: false, error: "empty_body" },
      { status: 400, headers: { "cache-control": "no-store" } }
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

  const blob = await put(pathname, body, { access: "public" });

  const latest: BootstrapLatest = {
    url: blob.url,
    height,
    tip_hash: tipHash,
    sha256,
    publisher_pubkey: publisherPubkey,
    manifest_sig: manifestSig,
    updated_at: updatedAtRaw ? Number(updatedAtRaw) : Math.floor(Date.now() / 1000)
  };

  await kv.set(LATEST_KEY, latest);

  return NextResponse.json(
    { ok: true, blob, latest },
    { headers: { "cache-control": "no-store" } }
  );
}
