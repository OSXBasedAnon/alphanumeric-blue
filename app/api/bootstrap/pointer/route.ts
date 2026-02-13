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

function requireAuth(req: Request): boolean {
  const expectedRaw = process.env.BOOTSTRAP_PUBLISH_TOKEN;
  const expected = expectedRaw?.trim();
  if (!expected) return false;

  const got = (req.headers.get("authorization") ?? "").trim();

  if (got === `Bearer ${expected}`) return true;
  if (expected.toLowerCase().startsWith("bearer ")) return got === expected;
  return got === expected;
}

export async function POST(request: Request) {
  if (!requireAuth(request)) {
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
