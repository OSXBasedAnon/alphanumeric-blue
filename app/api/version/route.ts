import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // These env vars are provided by Vercel in most deployments.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const url = process.env.VERCEL_URL ?? null;
  const env = process.env.VERCEL_ENV ?? null;

  return NextResponse.json(
    { ok: true, sha, env, url },
    { headers: { "cache-control": "no-store" } }
  );
}

