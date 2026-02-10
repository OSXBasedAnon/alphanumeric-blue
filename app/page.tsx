import Image from "next/image";
import StatusPanel from "./components/StatusPanel";

export default function Page() {
  return (
    <main className="page">
      <section className="hero">
        <div className="hero-left">
          <div className="eyebrow">Alphanumeric Network Gateway</div>
          <div className="brand">
            <Image src="/logo.png" alt="Alphanumeric logo" width={64} height={64} />
            <div>
              <h1>alphanumeric.blue</h1>
              <p className="tagline">Discovery, light snapshots, and network status.</p>
            </div>
          </div>
          <p>
            A resilient discovery and light snapshot layer for the Alphanumeric network.
            Nodes announce, clients discover peers, and the site stays active even when
            the network is quiet.
          </p>
          <div className="cta-row">
            <a className="cta" href="/api/peers">Discovery API</a>
            <a className="cta ghost" href="/api/chain-snapshot">Chain Snapshot</a>
            <a className="cta ghost" href="/api/pending-snapshots">Pending</a>
          </div>
        </div>
        <div className="hero-right">
          <StatusPanel />
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Discovery</h2>
          <p>
            Nodes POST signed announcements and clients fetch ranked peers. Works
            at small scale and holds up to hundreds of nodes using KV-backed storage.
          </p>
          <div className="code">POST /api/announce</div>
          <div className="code">GET /api/peers</div>
        </div>
        <div className="card">
          <h2>Light Snapshot</h2>
          <p>
            Validators submit signed header snapshots. The site shows last known
            height and timestamps with a clear stale marker.
          </p>
          <div className="code">POST /api/headers</div>
          <div className="code">GET /api/chain-snapshot</div>
        </div>
        <div className="card">
          <h2>Health</h2>
          <p>
            Simple uptime endpoint and CORS-friendly APIs for nodes and tools.
          </p>
          <div className="code">GET /api/health</div>
        </div>
      </section>

      <section className="specs">
        <h2>Signed Announce Payload</h2>
        <pre>
{`{
  "ip": "203.0.113.7",
  "port": 7177,
  "node_id": "node-abc",
  "public_key": "<ed25519 pubkey>",
  "version": "beta-7.2.7",
  "height": 12345,
  "last_seen": 1700000000,
  "latency_ms": 42,
  "signature": "<ed25519 signature>"
}`}
        </pre>
      </section>
    </main>
  );
}
