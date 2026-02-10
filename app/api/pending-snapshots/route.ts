import { NextResponse } from "next/server";
import { listPendingSnapshots } from "@/lib/storage";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

export async function GET() {
  const pending = await listPendingSnapshots();
  const sorted = pending.sort((a, b) => b.snapshot.height - a.snapshot.height).slice(0, 20);
  return response({ ok: true, count: sorted.length, pending: sorted });
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
