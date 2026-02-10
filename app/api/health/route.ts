import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "alphanumeric-blue",
      time: Math.floor(Date.now() / 1000)
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store"
      }
    }
  );
}
