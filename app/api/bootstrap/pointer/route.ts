import { NextResponse } from "next/server";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const input = body as Partial<BootstrapLatest>;
  if (!input.url || typeof input.url !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_url" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const latest: BootstrapLatest = {
    url: input.url,
    height: typeof input.height === "number" ? input.height : undefined,
    tip_hash: typeof input.tip_hash === "string" ? input.tip_hash : undefined,
    sha256: typeof input.sha256 === "string" ? input.sha256 : undefined,
    publisher_pubkey:
      typeof input.publisher_pubkey === "string" ? input.publisher_pubkey : undefined,
    manifest_sig: typeof input.manifest_sig === "string" ? input.manifest_sig : undefined,
    updated_at:
      typeof input.updated_at === "number"
        ? input.updated_at
        : Math.floor(Date.now() / 1000)
  };

  await kv.set(LATEST_KEY, latest);

  return NextResponse.json(
    { ok: true, latest },
    { headers: { "cache-control": "no-store" } }
  );
}
