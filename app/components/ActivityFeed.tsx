"use client";

import { useEffect, useState } from "react";

type ChainSnapshotResponse = {
  ok: boolean;
  stats?: any;
  snapshot?: {
    headers?: Array<{
      height: number;
      hash: string;
      prev_hash: string;
      timestamp: number;
    }>;
  } | null;
};

type PendingResponse = {
  ok: boolean;
  pending: Array<{
    snapshot: {
      headers?: Array<{
        height: number;
        hash: string;
        prev_hash: string;
        timestamp: number;
      }>;
    };
  }>;
};

function formatAgo(ts?: number): string {
  if (!ts || ts <= 0) return "-";
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function shortHash(value?: string): string {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString();
}

function coerceTxList(stats: any): Array<any> {
  const candidates = [
    stats?.latest_transactions,
    stats?.transactions,
    stats?.txs,
    stats?.recent_transactions
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export default function ActivityFeed() {
  const [snapshot, setSnapshot] = useState<ChainSnapshotResponse | null>(null);
  const [pending, setPending] = useState<PendingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/chain-snapshot", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/pending-snapshots", { cache: "no-store" }).then((res) => res.json())
      ])
        .then(([chainJson, pendingJson]) => {
          if (cancelled) return;
          setSnapshot(chainJson);
          setPending(pendingJson);
        })
        .catch(() => null);

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const sourceHeaders = snapshot?.snapshot?.headers ?? pending?.pending?.[0]?.snapshot?.headers ?? [];
  const headers = sourceHeaders.slice(-3).reverse();
  const transactions = coerceTxList(snapshot?.stats).slice(0, 3);

  return (
    <section className="ops-feed-grid">
      <div className="explorer-card">
        <div className="panel-title">Explorer</div>
        <div className="explorer-list">
          {headers.length > 0 ? (
            headers.map((header) => (
              <div key={`${header.height}-${header.hash}`} className="explorer-row">
                <span className="explorer-height">#{header.height}</span>
                <span className="explorer-hash">{shortHash(header.hash)}</span>
                <span className="explorer-time">{formatAgo(header.timestamp)}</span>
              </div>
            ))
          ) : (
            <div className="explorer-empty">No signed headers available yet.</div>
          )}
        </div>
      </div>

      <div className="tx-card">
        <div className="panel-title">Latest Transactions</div>
        <div className="tx-list">
          {transactions.length > 0 ? (
            transactions.map((tx, idx) => (
              <div key={idx} className="tx-row">
                <span className="tx-hash">{shortHash(String(tx?.hash ?? tx?.id ?? tx?.txid ?? ""))}</span>
                <span className="tx-amount">{formatNumber(tx?.amount ?? tx?.value ?? tx?.fee ?? "")}</span>
              </div>
            ))
          ) : (
            <div className="explorer-empty">
              Transaction feed not provided by upstream stats yet.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
