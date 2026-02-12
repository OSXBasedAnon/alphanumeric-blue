import { kv } from "@vercel/kv";

const memoryCounts = new Map<string, { count: number; reset: number }>();

function kvEnabled(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function rateLimit(ip: string, limit: number, windowSeconds: number): Promise<boolean> {
  return rateLimitScoped("global", ip, limit, windowSeconds);
}

export async function rateLimitScoped(
  scope: string,
  ip: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const key = `rl:${scope}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  if (!kvEnabled()) {
    const entry = memoryCounts.get(key);
    if (!entry || now >= entry.reset) {
      memoryCounts.set(key, { count: 1, reset: now + windowSeconds });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count += 1;
    return true;
  }

  const count = (await kv.incr(key)) as number;
  if (count === 1) {
    await kv.expire(key, windowSeconds);
  }
  return count <= limit;
}
