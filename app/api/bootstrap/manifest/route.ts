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

export async function GET() {
  const latest = (await kv.get(LATEST_KEY)) as BootstrapLatest | null;
  if (!latest?.url) {
    return NextResponse.json(
      { ok: false, error: "bootstrap_not_published" },
      {
        status: 404,
        headers: {
          "access-control-allow-origin": "*",
          "cache-control": "no-store"
        }
      }
    );
  }

  // This endpoint is intentionally CORS-friendly for node bootstrapping and tooling.
  return NextResponse.json(
    { ok: true, manifest: latest },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store"
      }
    }
  );
}

