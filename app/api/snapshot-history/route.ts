import { NextResponse } from "next/server";
import { listSnapshotHistory } from "@/lib/storage";

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
  const history = await listSnapshotHistory();
  return response({ ok: true, count: history.length, history });
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
