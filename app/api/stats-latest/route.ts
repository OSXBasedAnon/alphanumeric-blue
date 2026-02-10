import { NextResponse } from "next/server";
import { getLatestStatsSnapshot, listStatsSnapshots } from "@/lib/storage";

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
  const latest = await getLatestStatsSnapshot();
  if (latest) {
    return response({ ok: true, count: 1, latest });
  }

  const stats = await listStatsSnapshots();
  stats.sort((a, b) => b.received_at - a.received_at);
  return response({ ok: true, count: stats.length, latest: stats[0] ?? null });
}
