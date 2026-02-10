import { headers } from "next/headers";

export function getClientIp(): string {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    return fwd.split(",")[0].trim();
  }
  return h.get("x-real-ip") ?? "0.0.0.0";
}
