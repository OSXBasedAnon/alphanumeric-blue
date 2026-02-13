import Image from "next/image";
import NetworkWorkbench from "./components/NetworkWorkbench";
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
              <h1>alphanumeric</h1>
              <p className="tagline">Discovery, light snapshots, network status.</p>
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
          <div className="top-links">
            <a
              className="top-link"
              href="https://github.com/OSXBasedAnon/alphanumeric"
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
            <a
              className="top-link"
              href="https://blog.invariantdata.com/p/alphanumeric.html"
              target="_blank"
              rel="noreferrer"
            >
              Whitepaper
            </a>
          </div>
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

      <NetworkWorkbench />

      <section className="download">
        <div className="download-card">
          <h2>Run a Node</h2>
          <ol>
            <li>Set <code>ALPHANUMERIC_DISCOVERY_BASES</code></li>
            <li>Run the binary and keep it online</li>
            <li>Expose <code>ALPHANUMERIC_STATS_PORT</code> if you host stats</li>
          </ol>
          <div className="cta-row">
            <a className="cta" href="/api/health">Gateway Health</a>
            <a className="cta ghost" href="/api/peers">Peer List</a>
          </div>
        </div>
        <div className="download-card">
          <h2>Recommended Env</h2>
          <pre>{`ALPHANUMERIC_DISCOVERY_BASES=https://alphanumeric.blue\nALPHANUMERIC_STATS_PORT=8787\nALPHANUMERIC_STATS_ENABLED=true`}</pre>
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

      <section className="flow-lite">
        <h2>How It Works</h2>
        <div className="flow-lite-row">
          <div className="flow-lite-step"><strong>1.</strong> Nodes announce signed state.</div>
          <div className="flow-lite-step"><strong>2.</strong> Clients discover and rank peers.</div>
          <div className="flow-lite-step"><strong>3.</strong> Gateway tracks signed headers and pending quorum.</div>
          <div className="flow-lite-step"><strong>4.</strong> Clients sync from canonical chain peers.</div>
        </div>
      </section>
    </main>
  );
}
