"use client";

import { useEffect, useState } from "react";

type SnapshotResponse = {
  ok: boolean;
  peers: number;
  source: "indexer" | "snapshot" | "pending" | "peer" | "push";
  stats?: any;
  snapshot?: {
    height: number;
    last_block_time: number;
    received_at: number;
  } | null;
};

export default function MetricsStrip() {
  const [data, setData] = useState<SnapshotResponse | null>(null);
  const [pending, setPending] = useState<{ pending?: Array<{ snapshot: { height: number } }> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetch("/api/chain-snapshot", { cache: "no-store" }).then((res) => res.json()),
        fetch("/api/pending-snapshots", { cache: "no-store" }).then((res) => res.json())
      ])
        .then(([snapshotJson, pendingJson]) => {
          if (!cancelled) {
            setData(snapshotJson);
            setPending(pendingJson);
          }
        })
        .catch(() => null);

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const height = data?.stats?.height ?? data?.snapshot?.height ?? pending?.pending?.[0]?.snapshot.height ?? "-";
  const difficulty = data?.stats?.difficulty ?? "-";
  const hashrate = data?.stats?.hashrate_ths ?? "-";

  return (
    <section className="strip">
      <div className="strip-item">
        <span className="strip-label">Peers</span>
        <span className="strip-value">{data?.peers ?? "-"}</span>
      </div>
      <div className="strip-item">
        <span className="strip-label">Height</span>
        <span className="strip-value">{height}</span>
      </div>
      <div className="strip-item">
        <span className="strip-label">Difficulty</span>
        <span className="strip-value">{difficulty}</span>
      </div>
      <div className="strip-item">
        <span className="strip-label">Hashrate</span>
        <span className="strip-value">{hashrate}</span>
      </div>
    </section>
  );
}
