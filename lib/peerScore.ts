import type { PeerRecord } from "./storage";

export function scorePeer(peer: PeerRecord, nowSec: number): number {
  const age = Math.max(0, nowSec - peer.last_seen);
  const heightScore = peer.height * 0.001;
  const recencyScore = -age * 0.01;
  const latencyPenalty = (peer.latency_ms ?? 50) * -0.005;
  return heightScore + recencyScore + latencyPenalty;
}

export function sortPeers(peers: PeerRecord[]): PeerRecord[] {
  const now = Math.floor(Date.now() / 1000);
  return peers
    .filter((p) => p.port > 0 && p.port <= 65535)
    .sort((a, b) => scorePeer(b, now) - scorePeer(a, now));
}
