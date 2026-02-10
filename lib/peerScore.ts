import type { PeerRecord } from "./storage";

export function scorePeer(peer: PeerRecord, nowSec: number): number {
  const age = Math.max(0, nowSec - peer.last_seen);
  const firstSeen = peer.first_seen ?? peer.last_seen;
  const uptime = Math.max(0, nowSec - firstSeen);
  const seenCount = peer.seen_count ?? 1;
  const heightScore = peer.height * 0.001;
  const recencyScore = -age * 0.01;
  const latencyPenalty = (peer.latency_ms ?? 50) * -0.005;
  const uptimeScore = Math.min(1, uptime / 86400) * 6;
  const consistencyScore = Math.min(6, Math.log10(seenCount + 1) * 3);
  const newPeerPenalty = uptime < 900 ? -5 : 0;
  return heightScore + recencyScore + latencyPenalty + uptimeScore + consistencyScore + newPeerPenalty;
}

export function sortPeers(peers: PeerRecord[]): PeerRecord[] {
  const now = Math.floor(Date.now() / 1000);
  return peers
    .filter((p) => p.port > 0 && p.port <= 65535)
    .sort((a, b) => scorePeer(b, now) - scorePeer(a, now));
}
