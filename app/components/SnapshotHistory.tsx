"use client";

import { useEffect, useMemo, useState } from "react";

type HistoryResponse = {
  ok: boolean;
  count: number;
  history: Array<{
    height: number;
    received_at: number;
  }>;
};

export default function SnapshotHistory() {
  const [data, setData] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/snapshot-history", { cache: "no-store" })
        .then((res) => res.json())
        .then((json) => {
          if (!cancelled) setData(json);
        })
        .catch(() => null);

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const bars = useMemo(() => {
    const history = data?.history ?? [];
    const trimmed = history.slice(0, 8).reverse();
    if (trimmed.length === 0) return [] as number[];
    const maxHeight = Math.max(...trimmed.map((h) => h.height));
    return trimmed.map((h) => {
      if (maxHeight === 0) return 10;
      return Math.max(10, Math.round((h.height / maxHeight) * 100));
    });
  }, [data]);

  return (
    <section className="history">
      <h2>Snapshot History (24h)</h2>
      <div className="history-chart">
        {bars.length > 0
          ? bars.map((value, idx) => (
              <div key={idx} className="bar" style={{ height: `${value}%` }} />
            ))
          : Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="bar" style={{ height: "20%", opacity: 0.25 }} />
            ))}
      </div>
      <p className="history-note">
        {bars.length > 0 ? "Based on recent signed snapshots." : "Waiting for snapshot history."}
      </p>
    </section>
  );
}
