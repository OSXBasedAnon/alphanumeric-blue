import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  return NextResponse.json(
    {
      ok: true,
      latest,
      configured: {
        kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
        blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        publish_token: Boolean(process.env.BOOTSTRAP_PUBLISH_TOKEN)
      }
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store"
      }
    }
  );
}

