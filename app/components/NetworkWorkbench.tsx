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

type PeerResponse = {
  ok: boolean;
  count: number;
  peers: Array<{
    node_id: string;
    height: number;
    last_seen: number;
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

function formatHashrate(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0 TH/s";
  if (Math.abs(n) < 0.001) return `${n.toExponential(2)} TH/s`;
  return `${n.toFixed(6)} TH/s`;
}

function formatSeconds(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 60) return `${Math.round(n)}s`;
  const mins = Math.round(n / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h`;
}

export default function NetworkWorkbench() {
  const [snapshot, setSnapshot] = useState<ChainSnapshotResponse | null>(null);
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [peers, setPeers] = useState<PeerResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/chain-snapshot", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/pending-snapshots", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/snapshot-history", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/peers?limit=64", { cache: "no-store" }).then((res) => res.json())
      ])
        .then(([chainJson, pendingJson, historyJson, peersJson]) => {
          if (cancelled) return;
          setSnapshot(chainJson);
          setPending(pendingJson);
          setHistory(historyJson);
          setPeers(peersJson);
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
  const lastBlockTime = Number(
    snapshot?.stats?.last_block_time ??
      snapshot?.snapshot?.last_block_time ??
      topPending?.snapshot?.last_block_time ??
      0
  );
  const tipAgeSeconds = Math.max(0, Math.floor(Date.now() / 1000) - lastBlockTime);
  const hashrate = snapshot?.stats?.hashrate_ths;
  const difficulty = snapshot?.stats?.difficulty;

  const sourceHeaders = snapshot?.snapshot?.headers ?? topPending?.snapshot?.headers ?? [];
  const verifyLabel = snapshot?.verify_state ?? (snapshot?.verified ? "verified" : "pending");
  const avgBlockIntervalSec = useMemo(() => {
    if (!Array.isArray(sourceHeaders) || sourceHeaders.length < 2) return null;
    const tail = sourceHeaders.slice(-8);
    let total = 0;
    let count = 0;
    for (let i = 1; i < tail.length; i += 1) {
      const prev = Number(tail[i - 1]?.timestamp ?? 0);
      const curr = Number(tail[i]?.timestamp ?? 0);
      if (curr > prev) {
        total += curr - prev;
        count += 1;
      }
    }
    return count > 0 ? total / count : null;
  }, [sourceHeaders]);
  const topHeightPendingVariants = (pending?.pending ?? []).filter((p) => p.snapshot.height === pendingHeight).length;
  const pendingSigners = topPending?.signers?.length ?? 0;
  const peerList = peers?.peers ?? [];
  const agreementPeers = peerList.filter((p) => Number(p.height ?? -1) === currentHeight).length;
  const freshPeers60s = peerList.filter((p) => Math.max(0, Math.floor(Date.now() / 1000) - Number(p.last_seen ?? 0)) <= 60).length;
  const trend = useMemo(() => {
    const points = (history?.history ?? []).slice(0, 16).reverse();
    if (points.length === 0) {
      return {
        flat: true,
        points: [] as Array<{ h: number; ts: number; norm: number }>
      };
    }

    const minHeight = Math.min(...points.map((p) => p.height));
    const maxHeight = Math.max(...points.map((p) => p.height));
    const span = Math.max(0, maxHeight - minHeight);
    const flat = span === 0;
    const normalized = points.map((p, idx) => {
      const base = flat ? 0.5 + (((idx % 4) - 1.5) * 0.05) : (p.height - minHeight) / span;
      const norm = Math.max(0.12, Math.min(0.88, base));
      return { h: p.height, ts: p.received_at, norm };
    });

    return { flat, points: normalized };
  }, [history]);

  const sparkline = useMemo(() => {
    if (trend.points.length === 0) return null;
    const width = 100;
    const height = 40;
    const pad = 4;
    const n = trend.points.length;
    const coords = trend.points.map((p, i) => {
      const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
      const y = height - pad - p.norm * (height - pad * 2);
      return { x, y, h: p.h, ts: p.ts };
    });
    const line = coords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
    const area = `0,${height} ${line} ${width},${height}`;
    return { width, height, coords, line, area };
  }, [trend]);

  return (
    <section className="workbench">
      <div className="workbench-head">
        <h2>Network Operations</h2>
        <p>Live gateway telemetry, chain health signals, and recent network activity.</p>
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
              {sparkline ? (
                <svg className={`ops-spark ${trend.flat ? "flat" : ""}`} viewBox={`0 0 ${sparkline.width} ${sparkline.height}`} preserveAspectRatio="none">
                  <polyline className="ops-spark-area" points={sparkline.area} />
                  <polyline className="ops-spark-line" points={sparkline.line} />
                  {sparkline.coords.map((c, idx) => (
                    <circle
                      key={`${c.ts}-${idx}`}
                      className="ops-spark-dot"
                      cx={c.x}
                      cy={c.y}
                      r={1.2}
                    >
                      <title>{`Height ${c.h} - ${formatAgo(c.ts)}`}</title>
                    </circle>
                  ))}
                </svg>
              ) : (
                <div className="ops-spark-empty">No recent snapshot history.</div>
              )}
            </div>
          </div>
        </div>

        <div className="ops-column">
          <div className="ops-metrics-card">
            <div className="panel-title">Chain Signals</div>
            <div className="signal-grid">
              <div className="signal-item tone-cyan">
                <span>Difficulty</span>
                <strong>{formatNumber(difficulty)}</strong>
              </div>
              <div className="signal-item tone-amber">
                <span>Hashrate</span>
                <strong>{formatHashrate(hashrate)}</strong>
              </div>
              <div className="signal-item">
                <span>Tip Age</span>
                <strong>{formatSeconds(tipAgeSeconds)}</strong>
              </div>
              <div className="signal-item">
                <span>Avg Block Interval</span>
                <strong>{formatSeconds(avgBlockIntervalSec ?? NaN)}</strong>
              </div>
              <div className="signal-item">
                <span>Pending Signers</span>
                <strong>{pendingSigners}</strong>
              </div>
              <div className="signal-item">
                <span>Competing Tips</span>
                <strong>{Math.max(0, topHeightPendingVariants - 1)}</strong>
              </div>
              <div className="signal-item tone-green">
                <span>Height Agreement</span>
                <strong>{agreementPeers}/{peerList.length}</strong>
              </div>
              <div className="signal-item tone-green">
                <span>Fresh Peers (60s)</span>
                <strong>{freshPeers60s}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
