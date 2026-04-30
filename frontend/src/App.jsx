import { useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract.js";

const STATUS_LABELS  = ["ACTIVE", "TRIGGERED", "PAID OUT", "EXPIRED"];
const STATUS_CLASSES = ["s-active", "s-trigger", "s-paid", "s-expired"];

function fmt(ts) {
  // Bug fix: contract timestamps are unix seconds — multiply by 1000 before Date()
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function truncate(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── All ethers / contract logic is unchanged below ───────────────────────────

function App() {
  const [account, setAccount]             = useState(null);
  const [contract, setContract]           = useState(null);
  const [balance, setBalance]             = useState("—");
  const [policies, setPolicies]           = useState([]);
  const [flightId, setFlightId]           = useState("");
  const [travelDate, setTravelDate]       = useState("");
  const [msg, setMsg]                     = useState("");
  const [loading, setLoading]             = useState(false);
  const [stats, setStats]                 = useState({ balance: "—", totalPolicies: "—" });
  const [eventLog, setEventLog]           = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function connect() {
    if (!window.ethereum) { alert("Install MetaMask first!"); return; }
    const prov   = new ethers.BrowserProvider(window.ethereum);
    await prov.send("eth_requestAccounts", []);
    const signer = await prov.getSigner();
    const addr   = await signer.getAddress();
    const c      = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    setAccount(addr);
    setContract(c);
    await Promise.all([
      refreshBalance(c),
      loadMyPolicies(c, addr),
      loadStats(prov),
      loadEventLog(prov, c),
    ]);
  }

  async function refreshBalance(c) {
    try {
      const bal = await c.contractBalance();
      setBalance(ethers.formatEther(bal) + " ETH");
    } catch { setBalance("—"); }
  }

  async function loadStats(prov) {
    try {
      const ro           = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const [bal, total] = await Promise.all([
        prov.getBalance(CONTRACT_ADDRESS),
        ro.nextPolicyId(),
      ]);
      setStats({
        balance:       ethers.formatEther(bal) + " ETH",
        totalPolicies: total.toString(),
      });
    } catch (e) { console.error("loadStats", e); }
  }

  async function loadEventLog(prov, c) {
    setEventsLoading(true);
    try {
      const ro                       = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const [createdLogs, paidLogs]  = await Promise.all([
        ro.queryFilter(ro.filters.PolicyCreated()),
        ro.queryFilter(ro.filters.PolicyPaid()),
      ]);

      const createdItems = await Promise.all(
        createdLogs.map(async e => {
          let travelDateTs = null;
          try {
            const p    = await c.getPolicy(e.args.policyId);
            travelDateTs = Number(p.travelDate);
          } catch {}
          return {
            type: "purchased",
            blockNumber: e.blockNumber,
            policyId:    e.args.policyId.toString(),
            flightId:    e.args.flightId,
            holder:      e.args.holder,
            travelDate:  travelDateTs,
          };
        })
      );

      const paidItems = paidLogs.map(e => ({
        type:        "payout",
        blockNumber: e.blockNumber,
        policyId:    e.args.policyId.toString(),
        holder:      e.args.holder,
        amount:      ethers.formatEther(e.args.amount),
      }));

      const all = [...createdItems, ...paidItems].sort((a, b) => b.blockNumber - a.blockNumber);
      setEventLog(all);
    } catch (e) { console.error("loadEventLog", e); }
    setEventsLoading(false);
  }

  async function handleRefresh() {
    if (!contract) return;
    const prov = new ethers.BrowserProvider(window.ethereum);
    await Promise.all([
      refreshBalance(contract),
      loadMyPolicies(contract, account),
      loadStats(prov),
      loadEventLog(prov, contract),
    ]);
  }

  async function loadMyPolicies(c, addr) {
    try {
      const total = await c.nextPolicyId();
      const mine  = [];
      for (let i = 0; i < Number(total); i++) {
        const p = await c.getPolicy(i);
        if (p.policyholder.toLowerCase() === addr.toLowerCase()) {
          mine.push({
            id:           i,
            policyholder: p.policyholder,
            flightId:     p.flightId,
            travelDate:   p.travelDate,   // BigInt — fmt() converts via Number(ts)*1000
            status:       p.status,
          });
        }
      }
      setPolicies(mine);
    } catch (e) { console.error(e); }
  }

  async function buyPolicy() {
    if (!contract) { setMsg("Connect wallet first."); return; }
    if (!flightId || !travelDate) { setMsg("Fill in flight ID and travel date."); return; }

    const unixDate = Math.floor(new Date(travelDate).getTime() / 1000);
    if (unixDate <= Math.floor(Date.now() / 1000)) {
      setMsg("Travel date must be in the future."); return;
    }

    setLoading(true);
    setMsg("Sending transaction...");
    try {
      const premium = await contract.PREMIUM();
      const tx      = await contract.buyPolicy(flightId.toUpperCase(), unixDate, { value: premium });
      setMsg("Waiting for confirmation...");
      await tx.wait();
      setMsg(`Policy bought! Tx: ${tx.hash.slice(0, 18)}...`);
      setFlightId("");
      setTravelDate("");
      await handleRefresh();
    } catch (e) {
      setMsg("Error: " + (e.reason || e.message));
    }
    setLoading(false);
  }

  // ─── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* ── Header ── */}
      <header className="header">
        <div className="brand">
          <div className="brand-name">
            <span>✈</span>
            <span>ChainSure</span>
          </div>
          <div className="brand-sub">Parametric Flight Insurance on Ethereum</div>
        </div>

        {account ? (
          <div className="wallet-pill">
            <div className="dot dot-green" />
            <span className="wallet-addr">{truncate(account)}</span>
          </div>
        ) : (
          <button className="btn-connect" onClick={connect}>Connect Wallet</button>
        )}
      </header>

      {/* ── Stats Bar ── */}
      <div className="stats-bar">
        <div className="stat-tile">
          <span className="stat-label">Contract Balance</span>
          <span className="stat-value">{stats.balance}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Total Policies</span>
          <span className="stat-value">{stats.totalPolicies}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Network</span>
          <span className="stat-value">Sepolia</span>
        </div>
      </div>

      {/* ── Buy a Policy ── */}
      {account && (
        <div className="card">
          <div className="section-head">
            <span className="section-title">Buy a Policy</span>
          </div>
          <p className="buy-meta">
            Premium: 0.001 ETH&nbsp;&nbsp;·&nbsp;&nbsp;Payout: 0.003 ETH&nbsp;&nbsp;·&nbsp;&nbsp;Trigger: ≥60 min delay
          </p>

          <div className="form-row">
            <div className="form-field">
              <label className="field-label">Flight Number</label>
              <input
                value={flightId}
                onChange={e => setFlightId(e.target.value)}
                placeholder="AA123"
                disabled={loading}
              />
            </div>
            <div className="form-field">
              <label className="field-label">Travel Date</label>
              <input
                type="date"
                value={travelDate}
                onChange={e => setTravelDate(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button className="btn-primary" onClick={buyPolicy} disabled={loading}>
            {loading ? "Processing…" : "Buy Policy — 0.001 ETH"}
          </button>

          {msg && (
            <div className={`tx-msg${msg.startsWith("Error") ? " err" : ""}`}>{msg}</div>
          )}
        </div>
      )}

      {/* ── My Policies ── */}
      {account && (
        <div className="card">
          <div className="section-head">
            <span className="section-title">My Policies</span>
            <button className="btn-sm" onClick={() => loadMyPolicies(contract, account)}>
              ↻ Refresh
            </button>
          </div>

          {policies.length === 0 ? (
            <div className="empty-state">No policies found for this wallet.</div>
          ) : (
            <>
              <div className="table-head">
                <span className="th">ID</span>
                <span className="th">Flight</span>
                <span className="th">Travel Date</span>
                <span className="th">Status</span>
              </div>

              {policies.map(p => {
                const statusIdx = Number(p.status);
                return (
                  <div className="policy-row" key={p.id}>
                    <span className="cell-id">#{p.id}</span>
                    <span className="cell-flight">{p.flightId}</span>
                    {/* Bug fix: Number(p.travelDate) * 1000 — contract stores unix seconds */}
                    <span className="cell-date">{fmt(p.travelDate)}</span>
                    <span className={`status-badge ${STATUS_CLASSES[statusIdx]}`}>
                      {STATUS_LABELS[statusIdx]}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Event Log ── */}
      {account && (
        <div className="card">
          <div className="section-head">
            <span className="section-title">
              Event Log
              <div className="dot-live" title="Live data" />
            </span>
            <button className="btn-sm" onClick={handleRefresh}>↻ Refresh</button>
          </div>

          {eventsLoading ? (
            <div className="empty-state">Loading events…</div>
          ) : eventLog.length === 0 ? (
            <div className="empty-state">No on-chain events found.</div>
          ) : (
            <div className="event-list">
              {eventLog.map((ev, i) => (
                <div className="event-row" key={i}>
                  {ev.type === "purchased" ? (
                    <span className="event-badge eb-blue">Purchased</span>
                  ) : (
                    <span className="event-badge eb-green">Payout</span>
                  )}

                  <div className="event-info">
                    {ev.type === "purchased" ? (
                      <>
                        <span className="event-main">
                          Policy <strong>#{ev.policyId}</strong> — {ev.flightId}
                        </span>
                        <span className="event-sub">
                          {/* Bug fix: ev.travelDate is already Number; still guard with Number() */}
                          {ev.travelDate
                            ? `${fmt(ev.travelDate)}  ·  ${truncate(ev.holder)}`
                            : truncate(ev.holder)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="event-main">
                          Policy <strong>#{ev.policyId}</strong> — {ev.amount} ETH paid out
                        </span>
                        <span className="event-sub">→ {truncate(ev.holder)}</span>
                      </>
                    )}
                  </div>

                  <span className="event-blk">blk {ev.blockNumber}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── How It Works ── */}
      <div className="card">
        <div className="section-head" style={{ marginBottom: 28 }}>
          <span className="section-title">How It Works</span>
        </div>

        <div className="steps-wrapper">
          <div className="steps-line" aria-hidden="true" />
          <div className="steps-track">
            {[
              {
                n: "1",
                label: "Connect",
                desc: "Connect your MetaMask wallet on the Sepolia testnet.",
              },
              {
                n: "2",
                label: "Buy a Policy",
                desc: "Enter your flight and travel date. Pay 0.001 ETH.",
              },
              {
                n: "3",
                label: "Oracle Reports",
                desc: "After landing, the oracle checks the delay and reports it on-chain.",
              },
              {
                n: "4",
                label: "Auto Payout",
                desc: "Delayed ≥60 min? 0.003 ETH lands in your wallet. No claim needed.",
              },
            ].map(s => (
              <div className="step" key={s.n}>
                <div className="step-num">{s.n}</div>
                <div className="step-label">{s.label}</div>
                <div className="step-desc">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

export default App;
