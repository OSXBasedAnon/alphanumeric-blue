import { NextRequest } from "next/server";

function normalizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const candidate = raw.trim();
  if (candidate.length === 0) return null;

  // x-forwarded-for can include a list of hops; keep the first client hop.
  const first = candidate.split(",")[0]?.trim() ?? "";
  if (first.length === 0) return null;

  // Strip IPv6-mapped IPv4 prefix if present.
  if (first.startsWith("::ffff:")) {
    return first.slice("::ffff:".length);
  }
  return first;
}

export function getClientIp(req: NextRequest): string {
  // Prefer provider-populated values before generic forwarding headers.
  const preferred = normalizeIp(req.headers.get("x-vercel-forwarded-for"));
  if (preferred) return preferred;

  const realIp = normalizeIp(req.headers.get("x-real-ip"));
  if (realIp) return realIp;

  const forwarded = normalizeIp(req.headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;

  return "0.0.0.0";
}
