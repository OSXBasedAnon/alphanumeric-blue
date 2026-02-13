import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BootstrapLatest = {
  url: string;
  updated_at: number;
};

const LATEST_KEY = "bootstrap:latest";

export async function GET() {
  const latest = (await kv.get(LATEST_KEY)) as BootstrapLatest | null;
  if (latest?.url) {
    // Redirect to the current blob URL. Node bootstrap uses this stable path.
    return NextResponse.redirect(latest.url, {
      status: 302,
      headers: {
        "access-control-allow-origin": "*",
        // Avoid caching the redirect; clients should re-check for the latest.
        "cache-control": "no-store"
      }
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "bootstrap_not_published",
      hint: "POST /api/bootstrap/publish with BOOTSTRAP_PUBLISH_TOKEN to publish latest snapshot"
    },
    {
      status: 404,
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store"
      }
    }
  );
}
