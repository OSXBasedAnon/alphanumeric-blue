import { NextRequest, NextResponse } from "next/server";
import { listPeers } from "@/lib/storage";
import { sortPeers } from "@/lib/peerScore";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const peers = await listPeers();
  const sorted = sortPeers(peers).slice(0, limit);
  return response({ ok: true, count: sorted.length, peers: sorted });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}
