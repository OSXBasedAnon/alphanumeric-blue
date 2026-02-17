"use client";

import { useEffect, useState } from "react";

type SnapshotResponse = {
  ok: boolean;
  source: "indexer" | "snapshot" | "pending" | "peer" | "push";
  peers: number;
  stats?: any;
  snapshot?: {
    height: number;
    last_block_time: number;
    received_at: number;
  } | null;
  stale?: boolean;
  verified?: boolean;
  last_updated?: number;
  diagnostics?: {
    has_pending?: boolean;
  };
};

export default function StatusPanel() {
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/chain-snapshot", { cache: "no-store" })
        .then((res) => res.json())
        .then((snapshotJson) => {
          if (!cancelled) {
            setData(snapshotJson);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setError("unavailable");
        });

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="panel">
      <div className="panel-row">
        <span className="label">Network</span>
        <span className="value">{data?.peers ?? "-"} peers</span>
      </div>
      <div className="panel-row">
        <span className="label">Source</span>
        <span className="value">{data?.source ?? "-"}</span>
      </div>
      <div className="panel-row">
        <span className="label">Height</span>
        <span className="value">
          {data?.stats?.height ?? data?.snapshot?.height ?? "-"}
        </span>
      </div>
      <div className="panel-row">
        <span className="label">Last Block</span>
        <span className="value">
          {data?.stats?.last_block_time ?? data?.snapshot?.last_block_time ?? "-"}
        </span>
      </div>
      <div className="panel-row">
        <span className="label">Pending</span>
        <span className="value">
          {data?.diagnostics?.has_pending ? "yes" : "no"}
        </span>
      </div>
      <div className="panel-row">
        <span className="label">Status</span>
        <span className={`badge ${data?.verified ? "ok" : "warn"}`}>
          {data?.verified ? "Verified" : "Pending"}
        </span>
      </div>
      <div className="panel-row">
        <span className="label">Updated</span>
        <span className="value">{formatTime(data?.last_updated)}</span>
      </div>
      {data?.stale && (
        <div className="panel-alert">Snapshot is stale. Waiting for new node updates.</div>
      )}
      {error && <div className="panel-alert">Status unavailable</div>}
    </div>
  );
}

function formatTime(ts?: number) {
  if (!ts) return "-";
  const date = new Date(ts * 1000);
  return date.toLocaleString();
}
