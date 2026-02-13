"use client";

import { useEffect, useMemo, useState } from "react";

type ChainSnapshotResponse = {
  ok: boolean;
  source: "indexer" | "snapshot" | "pending" | "peer" | "push";
  peers: number;
  stats?: any;
  snapshot?: {
    height: number;
    last_block_time: number;
    received_at: number;
    headers?: Array<{
      height: number;
      hash: string;
      prev_hash: string;
      timestamp: number;
    }>;
  } | null;
  stale?: boolean;
  verified?: boolean;
  verify_state?: "verified" | "pending";
  verify_reason?: string;
  last_updated?: number;
  diagnostics?: {
    announce_peers?: number;
    has_pending?: boolean;
    has_snapshot?: boolean;
    has_pushed_stats?: boolean;
    has_peer_stats?: boolean;
  };
};

type PendingResponse = {
  ok: boolean;
  count: number;
  pending: Array<{
    key: string;
    snapshot: {
      height: number;
      last_block_time: number;
      headers?: Array<{
        height: number;
        hash: string;
        prev_hash: string;
        timestamp: number;
      }>;
    };
    signers: string[];
    received_at: number;
  }>;
};

type HistoryResponse = {
  ok: boolean;
  count: number;
  history: Array<{
    height: number;
    received_at: number;
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

export default function NetworkWorkbench() {
  const [snapshot, setSnapshot] = useState<ChainSnapshotResponse | null>(null);
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/chain-snapshot", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/pending-snapshots", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/snapshot-history", { cache: "no-store" }).then((res) => res.json())
      ])
        .then(([chainJson, pendingJson, historyJson]) => {
          if (cancelled) return;
          setSnapshot(chainJson);
          setPending(pendingJson);
          setHistory(historyJson);
        })
        .catch(() => null);

    load();
    const interval = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const topPending = pending?.pending?.[0];
  const currentHeight = Number(snapshot?.stats?.height ?? snapshot?.snapshot?.height ?? 0);
  const pendingHeight = Number(topPending?.snapshot?.height ?? 0);
  const heightLag = Math.max(0, pendingHeight - currentHeight);

  const headers = (snapshot?.snapshot?.headers ?? topPending?.snapshot?.headers ?? []).slice(-3).reverse();
  const transactions = coerceTxList(snapshot?.stats).slice(0, 3);
  const verifyLabel = snapshot?.verify_state ?? (snapshot?.verified ? "verified" : "pending");
  const bars = useMemo(() => {
    const points = (history?.history ?? []).slice(0, 16).reverse();
    if (points.length === 0) return [] as Array<{ h: number; ts: number; pct: number }>;
    const maxHeight = Math.max(...points.map((p) => p.height), 1);
    return points.map((p) => ({
      h: p.height,
      ts: p.received_at,
      pct: Math.max(10, Math.round((p.height / maxHeight) * 100))
    }));
  }, [history]);

  return (
    <section className="workbench">
      <div className="workbench-head">
        <h2>Network Operations</h2>
        <p>Live gateway telemetry, chain explorer view, and recent network activity.</p>
      </div>

      <div className="ops-grid">
        <div className="ops-column">
          <div className="ops-cards">
            <div className="ops-card">
              <span>Canonical Height</span>
              <strong>{formatNumber(currentHeight)}</strong>
            </div>
            <div className="ops-card">
              <span>Pending Head</span>
              <strong>{formatNumber(pendingHeight)}</strong>
            </div>
            <div className="ops-card">
              <span>Height Lag</span>
              <strong>{formatNumber(heightLag)}</strong>
            </div>
            <div className="ops-card">
              <span>Verification</span>
              <strong>{verifyLabel}</strong>
            </div>
            <div className="ops-card">
              <span>Source</span>
              <strong>{snapshot?.source ?? "-"}</strong>
            </div>
            <div className="ops-card">
              <span>Updated</span>
              <strong>{formatAgo(snapshot?.last_updated)}</strong>
            </div>
          </div>

          <div className="ops-chart-card">
            <div className="ops-chart-title">Snapshot Height Trend</div>
            <div className="ops-chart">
              {bars.length > 0
                ? bars.map((bar, idx) => (
                    <div
                      key={`${bar.ts}-${idx}`}
                      className="ops-bar"
                      title={`Height ${bar.h} - ${formatAgo(bar.ts)}`}
                      style={{ height: `${bar.pct}%` }}
                    />
                  ))
                : Array.from({ length: 16 }).map((_, idx) => (
                    <div key={idx} className="ops-bar ghost" style={{ height: "20%" }} />
                  ))}
            </div>
          </div>
        </div>

        <div className="ops-column">
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
        </div>
      </div>
    </section>
  );
}
