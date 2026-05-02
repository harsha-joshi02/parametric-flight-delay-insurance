import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const AIRLINES = [
  { code: "AA", name: "American Airlines" },
  { code: "DL", name: "Delta Air Lines" },
  { code: "UA", name: "United Airlines" },
  { code: "SW", name: "Southwest Airlines" },
  { code: "BA", name: "British Airways" },
  { code: "EK", name: "Emirates" },
  { code: "LH", name: "Lufthansa" },
  { code: "AF", name: "Air France" },
  { code: "QR", name: "Qatar Airways" },
  { code: "SQ", name: "Singapore Airlines" },
  { code: "B6", name: "JetBlue" },
  { code: "WN", name: "Southwest Airlines" },
  { code: "AS", name: "Alaska Airlines" },
  { code: "F9", name: "Frontier Airlines" },
  { code: "NK", name: "Spirit Airlines" },
  { code: "BL", name: "Pacific Airlines" },
  { code: "DC", name: "Independence Air" },
  { code: "NY", name: "Air Iceland" },
];

const STATUS_LABELS  = ["ACTIVE", "TRIGGERED", "PAID OUT", "EXPIRED"];
const STATUS_CLASSES = ["s-active", "s-trigger", "s-paid", "s-expired"];
const PR_ROW_CLASSES = ["pr-active", "pr-trigger", "pr-paid", "pr-expired"];

// ─── Module-level helpers ────────────────────────────────────────────────────

function fmt(ts) {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function truncate(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Feature 1 — airline prefix matching
function getAirlineSuggestions(input) {
  if (!input || input.length < 2) return [];
  const upper = input.toUpperCase();
  return AIRLINES
    .filter(a => upper.startsWith(a.code))
    .map(a => ({ label: `${upper} — ${a.name}`, value: upper, airline: a.name }))
    .slice(0, 5);
}

// Feature 5 — countdown formatter
function fmtCountdown(expiryTs) {
  const remaining = expiryTs - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return { text: "Expired", color: "#6b7280" };
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const text = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  const color = remaining < 3600 ? "#ef4444" : remaining < 21600 ? "#f97316" : "#9ca3af";
  return { text, color };
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {

  // ── Existing state (untouched) ──────────────────────────────────────────
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
  const [countBalance, setCountBalance]   = useState("—");
  const [countPolicies, setCountPolicies] = useState("—");

  // ── New feature state ───────────────────────────────────────────────────
  const [suggestions, setSuggestions]     = useState([]);   // F1
  const [showSug, setShowSug]             = useState(false); // F1
  const [calcN, setCalcN]                 = useState(1);     // F2
  const [txStep, setTxStep]               = useState(0);     // F3  0=idle 1=submitted 2=confirming 3=confirmed
  const [txHashVal, setTxHashVal]         = useState("");    // F3
  const [solvency, setSolvency]           = useState(null);  // F4
  const [policyExpiries, setPolicyExpiries] = useState({}); // F5
  const [tick, setTick]                   = useState(0);     // F5 — 1-second heartbeat
  const [darkMode, setDarkMode]           = useState(       // F6
    () => localStorage.getItem("chainSureTheme") !== "light"
  );

  // ── Effects — existing count-up ─────────────────────────────────────────
  useEffect(() => {
    const raw = stats.balance.replace(" ETH", "");
    const target = parseFloat(raw);
    if (stats.balance === "—" || isNaN(target)) { setCountBalance(stats.balance); return; }
    const dec   = (raw.split(".")[1] || "").length;
    const STEPS = 40;
    let s = 0;
    const t = setInterval(() => {
      s++;
      const v = target * Math.min(s / STEPS, 1);
      setCountBalance(v.toFixed(Math.max(dec, 3)) + " ETH");
      if (s >= STEPS) { clearInterval(t); setCountBalance(stats.balance); }
    }, 800 / STEPS);
    return () => clearInterval(t);
  }, [stats.balance]);

  useEffect(() => {
    const target = parseInt(stats.totalPolicies, 10);
    if (isNaN(target)) { setCountPolicies(stats.totalPolicies); return; }
    if (target === 0)  { setCountPolicies("0"); return; }
    const STEPS = Math.min(40, target * 8);
    let s = 0;
    const t = setInterval(() => {
      s++;
      setCountPolicies(String(Math.ceil(target * Math.min(s / STEPS, 1))));
      if (s >= STEPS) clearInterval(t);
    }, 800 / STEPS);
    return () => clearInterval(t);
  }, [stats.totalPolicies]);

  // ── Effects — new features ──────────────────────────────────────────────

  // F6: sync theme to <html> data-theme and localStorage
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    localStorage.setItem("chainSureTheme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // F5: 1-second tick while wallet is connected
  useEffect(() => {
    if (!account) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [account]);

  // F5: load expiry timestamps when policies list updates
  useEffect(() => {
    if (!account || policies.length === 0) return;
    const prov = new ethers.BrowserProvider(window.ethereum);
    loadPolicyExpiries(prov, policies);
  }, [policies]); // eslint-disable-line react-hooks/exhaustive-deps

  // F4: check solvency whenever contract balance refreshes
  useEffect(() => {
    if (stats.balance === "—" || !account) return;
    const prov = new ethers.BrowserProvider(window.ethereum);
    checkSolvency(prov);
  }, [stats.balance, account]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Existing contract / ethers functions (untouched) ────────────────────

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
      const ro                      = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const [createdLogs, paidLogs] = await Promise.all([
        ro.queryFilter(ro.filters.PolicyCreated()),
        ro.queryFilter(ro.filters.PolicyPaid()),
      ]);
      const createdItems = await Promise.all(
        createdLogs.map(async e => {
          let travelDateTs = null;
          try {
            const p = await c.getPolicy(e.args.policyId);
            travelDateTs = Number(p.travelDate);
          } catch {}
          return {
            type: "purchased", blockNumber: e.blockNumber,
            policyId: e.args.policyId.toString(),
            flightId: e.args.flightId, holder: e.args.holder, travelDate: travelDateTs,
          };
        })
      );
      const paidItems = paidLogs.map(e => ({
        type: "payout", blockNumber: e.blockNumber,
        policyId: e.args.policyId.toString(),
        holder: e.args.holder, amount: ethers.formatEther(e.args.amount),
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
            id: i, policyholder: p.policyholder,
            flightId: p.flightId, travelDate: p.travelDate, status: p.status,
          });
        }
      }
      setPolicies(mine);
    } catch (e) { console.error(e); }
  }

  // buyPolicy — ethers calls identical; txStep state added between them (F3)
  async function buyPolicy() {
    if (!contract) { setMsg("Connect wallet first."); return; }
    if (!flightId || !travelDate) { setMsg("Fill in flight ID and travel date."); return; }
    const unixDate = Math.floor(new Date(travelDate).getTime() / 1000);
    if (unixDate <= Math.floor(Date.now() / 1000)) { setMsg("Travel date must be in the future."); return; }

    setLoading(true);
    setMsg("");
    setTxStep(1);          // ← Step 1: Submitted
    setTxHashVal("");
    try {
      const premium = await contract.PREMIUM();
      const tx      = await contract.buyPolicy(flightId.toUpperCase(), unixDate, { value: premium });
      setTxStep(2);         // ← Step 2: Confirming
      setTxHashVal(tx.hash);
      await tx.wait();
      setTxStep(3);         // ← Step 3: Confirmed
      setFlightId("");
      setTravelDate("");
      await handleRefresh();
      setTimeout(() => { setTxStep(0); }, 5000);
    } catch (e) {
      setMsg("Error: " + (e.reason || e.message));
      setTxStep(0);
    }
    setLoading(false);
  }

  // ── New feature functions ───────────────────────────────────────────────

  // F4: count all active policies and compare with contract balance
  async function checkSolvency(prov) {
    try {
      const ro    = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const total = await ro.nextPolicyId();
      const n     = Number(total);
      let activeCount = 0;
      for (let i = 0; i < n; i++) {
        const p = await ro.getPolicy(i);
        if (Number(p.status) === 0) activeCount++;
      }
      const balWei  = await prov.getBalance(CONTRACT_ADDRESS);
      const balEth  = parseFloat(ethers.formatEther(balWei));
      const required = activeCount * 0.003;
      setSolvency({ ok: balEth >= required, balEth, required, activeCount });
    } catch (e) { console.error("checkSolvency", e); }
  }

  // F5: fetch block timestamp for each active policy's creation event → expiry = ts + 2 days
  async function loadPolicyExpiries(prov, userPolicies) {
    const active = userPolicies.filter(p => Number(p.status) === 0);
    if (active.length === 0) return;
    try {
      const ro          = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const createdLogs = await ro.queryFilter(ro.filters.PolicyCreated());
      const expiries    = {};
      await Promise.all(
        active.map(async p => {
          const log = createdLogs.find(l => l.args.policyId.toString() === p.id.toString());
          if (log) {
            const block = await prov.getBlock(log.blockNumber);
            if (block) expiries[p.id] = block.timestamp + 172800; // + 2 days
          }
        })
      );
      setPolicyExpiries(expiries);
    } catch (e) { console.error("loadPolicyExpiries", e); }
  }

  // F7: generate and download CSV
  function exportCSV() {
    const today   = new Date().toISOString().split("T")[0];
    const headers = ["Policy ID", "Flight Number", "Travel Date", "Status", "Purchase Block"];
    const rows    = policies.map(p => {
      const si    = Number(p.status);
      const event = eventLog.find(e => e.type === "purchased" && e.policyId === p.id.toString());
      return [
        `#${p.id}`,
        p.flightId,
        fmt(p.travelDate),
        STATUS_LABELS[si],
        event ? `Block #${event.blockNumber}` : "N/A",
      ];
    });
    const csv  = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `chainsure-policies-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Computed ────────────────────────────────────────────────────────────
  const formFilled = flightId.trim() !== "" && travelDate !== "" && !loading;

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ══ HERO ══════════════════════════════════════════════════════════ */}
      <div className="hero">
        <div className="hero-inner">
          <div className="hero-brand">
            <h1 className="hero-title">✈ ChainSure</h1>
            <p className="hero-sub">Parametric Flight Insurance on Ethereum</p>
          </div>

          <div className="hero-actions">
            {/* F6: dark/light toggle */}
            <button
              className="btn-theme"
              onClick={() => setDarkMode(m => !m)}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? "☀" : "☾"}
            </button>

            {account ? (
              <div className="wallet-pill">
                <div className="dot dot-green" />
                <span className="wallet-addr">{truncate(account)}</span>
              </div>
            ) : (
              <button className="btn-connect" onClick={connect}>Connect Wallet</button>
            )}
          </div>
        </div>
        <div className="hero-shimmer" aria-hidden="true" />
      </div>

      {/* ══ PAGE CONTENT ════════════════════════════════════════════════ */}
      <div className="page">

        {/* F4: Solvency Banner */}
        {solvency !== null && (
          <div className={`solvency-banner${solvency.ok ? " solvency-ok" : " solvency-warn"}`}>
            {solvency.ok
              ? `✓ Fully funded — Contract can cover all ${solvency.activeCount} active ${solvency.activeCount === 1 ? "policy" : "policies"}`
              : `⚠ Underfunded — Contract has ${solvency.balEth.toFixed(4)} ETH but ${solvency.required.toFixed(4)} ETH needed to cover all active policies`
            }
          </div>
        )}

        {/* Stats Bar */}
        <div className="stats-bar" id="stats">
          <div className="stat-tile">
            <span className="stat-label">Contract Balance</span>
            <span className="stat-value">Ξ {countBalance}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Total Policies</span>
            <span className="stat-value">{countPolicies}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Network</span>
            <span className="stat-value">Sepolia</span>
          </div>
        </div>

        {/* F2: Coverage Calculator */}
        {account && (
          <div className="card" id="calculator">
            <div className="section-head">
              <span className="section-title">Coverage Calculator</span>
            </div>

            <div className="calc-slider-row">
              <label className="field-label" style={{ marginBottom: 0 }}>
                Number of policies: <strong style={{ color: "#f9fafb" }}>{calcN}</strong>
              </label>
              <input
                type="range"
                min="1" max="10" value={calcN}
                onChange={e => setCalcN(Number(e.target.value))}
                className="calc-slider"
              />
            </div>

            <div className="calc-stats">
              <div className="calc-tile">
                <span className="stat-label">Total Premium</span>
                <span className="calc-value">{(calcN * 0.001).toFixed(3)} ETH</span>
              </div>
              <div className="calc-tile">
                <span className="stat-label">Potential Payout</span>
                <span className="calc-value green">{(calcN * 0.003).toFixed(3)} ETH</span>
              </div>
              <div className="calc-tile">
                <span className="stat-label">Return</span>
                <span className="calc-value accent">3×</span>
              </div>
            </div>

            <div className="calc-bars">
              <div className="calc-bar-row">
                <span className="calc-bar-label">Premium</span>
                <div className="calc-bar-track">
                  <div
                    className="calc-bar calc-bar-blue"
                    style={{ width: `${(calcN / 10) * 33.33}%` }}
                  />
                </div>
                <span className="calc-bar-val">{(calcN * 0.001).toFixed(3)}</span>
              </div>
              <div className="calc-bar-row">
                <span className="calc-bar-label">Payout</span>
                <div className="calc-bar-track">
                  <div
                    className="calc-bar calc-bar-green"
                    style={{ width: `${(calcN / 10) * 100}%` }}
                  />
                </div>
                <span className="calc-bar-val">{(calcN * 0.003).toFixed(3)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Buy a Policy */}
        {account && (
          <div className="card card-buy" id="buy">
            <div className="card-accent-bar" />

            <div className="section-head">
              <span className="section-title">Buy a Policy</span>
            </div>

            <div className="form-row">
              {/* F1: Autocomplete flight number */}
              <div className="form-field" style={{ position: "relative" }}>
                <label className="field-label">Flight Number</label>
                <input
                  value={flightId}
                  onChange={e => {
                    setFlightId(e.target.value);
                    const s = getAirlineSuggestions(e.target.value);
                    setSuggestions(s);
                    setShowSug(s.length > 0);
                  }}
                  onFocus={() => {
                    const s = getAirlineSuggestions(flightId);
                    setSuggestions(s);
                    setShowSug(s.length > 0);
                  }}
                  onBlur={() => setTimeout(() => setShowSug(false), 150)}
                  placeholder="AA123"
                  disabled={loading}
                  autoComplete="off"
                />
                {showSug && (
                  <div className="autocomplete-dropdown">
                    {suggestions.map((s, i) => (
                      <div
                        key={i}
                        className="autocomplete-item"
                        onMouseDown={() => { setFlightId(s.value); setShowSug(false); }}
                      >
                        {s.label}
                      </div>
                    ))}
                  </div>
                )}
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

            <div className="coverage-pills">
              <span className="cov-pill">Premium: 0.001 ETH</span>
              <span className="cov-pill">Payout: 0.003 ETH</span>
              <span className="cov-pill cov-pill-accent">3× return</span>
            </div>

            <button
              className={`btn-primary${formFilled ? " btn-ready" : ""}`}
              onClick={buyPolicy}
              disabled={loading}
            >
              {loading ? "Processing…" : "Buy Policy — 0.001 ETH"}
            </button>

            {/* F3: TX Stepper */}
            {txStep > 0 && (
              <div className="tx-stepper">
                {[
                  { label: "Submitted",  step: 1 },
                  { label: "Confirming", step: 2 },
                  { label: "Confirmed",  step: 3 },
                ].map(({ label, step }, idx) => {
                  const isDone   = txStep > step;
                  const isActive = txStep === step;
                  return (
                    <div key={step} className={`tx-step ${isDone ? "tx-done" : isActive ? "tx-active" : "tx-pending"}`}>
                      <div className="tx-circle">
                        {isDone ? "✓" : isActive && step === 2
                          ? <span className="tx-spinner" />
                          : step
                        }
                      </div>
                      <span className="tx-label">{label}</span>
                      {idx < 2 && <div className={`tx-line${isDone ? " tx-line-done" : ""}`} />}
                    </div>
                  );
                })}
                {txStep === 3 && (
                  <p className="tx-success">Policy created successfully!</p>
                )}
              </div>
            )}

            {/* Error messages (success replaced by stepper) */}
            {msg && txStep === 0 && (
              <div className="tx-msg err">{msg}</div>
            )}
          </div>
        )}

        {/* My Policies */}
        {account && (
          <div className="card" id="policies">
            <div className="section-head">
              <span className="section-title">My Policies</span>
              <div style={{ display: "flex", gap: 8 }}>
                {/* F7: CSV Export */}
                {policies.length > 0 && (
                  <button className="btn-sm" onClick={exportCSV}>⬇ Export CSV</button>
                )}
                <button className="btn-sm" onClick={() => loadMyPolicies(contract, account)}>
                  ↻ Refresh
                </button>
              </div>
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
                  <span className="th">Expires In</span>
                </div>

                {policies.map(p => {
                  const si       = Number(p.status);
                  // F5: live countdown (re-evaluates on each tick)
                  void tick;
                  const expiry   = policyExpiries[p.id];
                  const cdResult = si === 0 && expiry ? fmtCountdown(expiry) : null;

                  return (
                    <div className={`policy-row ${PR_ROW_CLASSES[si]}`} key={p.id}>
                      <span className="cell-id">#{p.id}</span>
                      <span className="cell-flight">{p.flightId}</span>
                      <span className="cell-date">{fmt(p.travelDate)}</span>
                      <span className={`status-badge ${STATUS_CLASSES[si]}`}>
                        {STATUS_LABELS[si]}
                      </span>
                      <span
                        className="cell-expires"
                        style={{ color: cdResult ? cdResult.color : "#4b5563" }}
                      >
                        {cdResult ? cdResult.text : si === 0 ? "Loading…" : "—"}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Event Log */}
        {account && (
          <div className="card" id="events">
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
                  <div className={`event-row${i % 2 === 1 ? " event-row-alt" : ""}`} key={i}>
                    {ev.type === "purchased" ? (
                      <span className="event-badge eb-purchased">Purchased</span>
                    ) : (
                      <span className="event-badge eb-payout">Payout</span>
                    )}
                    <div className="event-info">
                      {ev.type === "purchased" ? (
                        <>
                          <span className="event-main">
                            Policy <strong>#{ev.policyId}</strong> — {ev.flightId}
                          </span>
                          <span className="event-sub">
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
                    <a
                      className="event-blk"
                      href={`https://sepolia.etherscan.io/block/${ev.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      blk {ev.blockNumber}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* How It Works */}
        <div className="card" id="how">
          <div className="section-head" style={{ marginBottom: 28 }}>
            <span className="section-title">How It Works</span>
          </div>
          <div className="steps-wrapper">
            <div className="steps-line" aria-hidden="true" />
            <div className="steps-track">
              {[
                { n: "1", label: "Connect",        desc: "Connect your MetaMask wallet on the Sepolia testnet." },
                { n: "2", label: "Buy a Policy",   desc: "Enter your flight and travel date. Pay 0.001 ETH." },
                { n: "3", label: "Oracle Reports", desc: "After landing, the oracle checks the delay and reports it on-chain." },
                { n: "4", label: "Auto Payout",    desc: "Delayed ≥60 min? 0.003 ETH lands in your wallet. No claim needed." },
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

      </div>{/* end .page */}
    </div>
  );
}

export default App;
