import { useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract.js";

const STATUS_LABELS = ["Active", "Triggered", "Paid", "Expired"];

function truncate(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function App() {
  const [account, setAccount]       = useState(null);
  const [contract, setContract]     = useState(null);
  const [balance, setBalance]       = useState("—");
  const [policies, setPolicies]     = useState([]);
  const [flightId, setFlightId]     = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [msg, setMsg]               = useState("");
  const [loading, setLoading]       = useState(false);
  const [stats, setStats]           = useState({ balance: "—", totalPolicies: "—" });
  const [eventLog, setEventLog]     = useState([]);
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
      const ro    = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const [bal, total] = await Promise.all([
        prov.getBalance(CONTRACT_ADDRESS),
        ro.nextPolicyId(),
      ]);
      setStats({
        balance: ethers.formatEther(bal) + " ETH",
        totalPolicies: total.toString(),
      });
    } catch (e) { console.error("loadStats", e); }
  }

  async function loadEventLog(prov, c) {
    setEventsLoading(true);
    try {
      const ro = new ethers.Contract(CONTRACT_ADDRESS, ABI, prov);
      const [createdLogs, paidLogs] = await Promise.all([
        ro.queryFilter(ro.filters.PolicyCreated()),
        ro.queryFilter(ro.filters.PolicyPaid()),
      ]);

      // Enrich created events with travel date from contract storage
      const createdItems = await Promise.all(
        createdLogs.map(async e => {
          let travelDateTs = null;
          try {
            const p = await c.getPolicy(e.args.policyId);
            travelDateTs = Number(p.travelDate);
          } catch {}
          return {
            type: "purchased",
            blockNumber: e.blockNumber,
            policyId: e.args.policyId.toString(),
            flightId: e.args.flightId,
            holder: e.args.holder,
            travelDate: travelDateTs,
          };
        })
      );

      const paidItems = paidLogs.map(e => ({
        type: "payout",
        blockNumber: e.blockNumber,
        policyId: e.args.policyId.toString(),
        holder: e.args.holder,
        amount: ethers.formatEther(e.args.amount),
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
          mine.push({ id: i, ...p });
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
      const tx = await contract.buyPolicy(flightId.toUpperCase(), unixDate, { value: premium });
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

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1>✈ Flight Delay Insurance</h1>
      <p className="subtitle">
        Pay 0.001 ETH — get 0.003 ETH back if your flight is delayed 60+ minutes.
        <br />Powered by a Solidity smart contract on Ethereum Sepolia.
      </p>

      {/* Stats bar */}
      {account && (
        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-label">Contract Balance</span>
            <span className="stat-value">{stats.balance}</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-label">Total Policies</span>
            <span className="stat-value">{stats.totalPolicies}</span>
          </div>
          <button className="refresh-btn" onClick={handleRefresh}>↻ Refresh</button>
        </div>
      )}

      {/* Wallet section */}
      <div className="card">
        {account ? (
          <>
            <div>Connected: <span className="address">{account}</span></div>
            <div className="muted" style={{ marginTop: "0.4rem" }}>Contract balance: {balance}</div>
          </>
        ) : (
          <button onClick={connect}>Connect MetaMask</button>
        )}
      </div>

      {/* Buy a policy */}
      {account && (
        <div className="card">
          <h2>Buy a Policy</h2>
          <p className="muted">Premium: 0.001 ETH &nbsp;|&nbsp; Payout: 0.003 ETH &nbsp;|&nbsp; Trigger: delay ≥ 60 min</p>
          <div className="row">
            <div className="field">
              <label>Flight Number (e.g. AA123)</label>
              <input
                value={flightId}
                onChange={e => setFlightId(e.target.value)}
                placeholder="AA123"
                disabled={loading}
              />
            </div>
            <div className="field">
              <label>Travel Date</label>
              <input
                type="date"
                value={travelDate}
                onChange={e => setTravelDate(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
          <button onClick={buyPolicy} disabled={loading}>
            {loading ? "Processing..." : "Buy Policy (0.001 ETH)"}
          </button>
          <div className={`msg ${msg.startsWith("Error") ? "err" : ""}`}>{msg}</div>
        </div>
      )}

      {/* My policies */}
      {account && (
        <div className="card">
          <h2>My Policies</h2>
          {policies.length === 0 ? (
            <div className="muted">No policies yet.</div>
          ) : (
            policies.map(p => (
              <div className="policy-row" key={p.id}>
                <div>
                  <div><strong>#{p.id}</strong> &nbsp; {p.flightId}</div>
                  <div className="muted">{new Date(Number(p.travelDate) * 1000).toLocaleDateString()}</div>
                </div>
                <span className={`status-badge status-${p.status}`}>
                  {STATUS_LABELS[p.status]}
                </span>
              </div>
            ))
          )}
          {policies.length > 0 && (
            <button style={{ marginTop: "1rem", background: "#1e40af" }}
              onClick={() => loadMyPolicies(contract, account)}>
              Refresh
            </button>
          )}
        </div>
      )}

      {/* Event Log */}
      {account && (
        <div className="card">
          <h2>Event Log</h2>
          {eventsLoading ? (
            <div className="muted">Loading events…</div>
          ) : eventLog.length === 0 ? (
            <div className="muted">No on-chain events found.</div>
          ) : (
            <div className="event-log">
              {eventLog.map((ev, i) => (
                <div className="event-row" key={i}>
                  {ev.type === "purchased" ? (
                    <>
                      <span className="event-badge event-badge-blue">Purchased</span>
                      <div className="event-details">
                        <span>Policy <strong>#{ev.policyId}</strong> — {ev.flightId}</span>
                        {ev.travelDate && (
                          <span className="muted">
                            Travel: {new Date(ev.travelDate * 1000).toLocaleDateString()}
                          </span>
                        )}
                        <span className="muted address">{truncate(ev.holder)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="event-badge event-badge-green">Payout</span>
                      <div className="event-details">
                        <span>Policy <strong>#{ev.policyId}</strong> — {ev.amount} ETH</span>
                        <span className="muted">
                          → <span className="address">{truncate(ev.holder)}</span>
                        </span>
                      </div>
                    </>
                  )}
                  <span className="event-block muted">blk {ev.blockNumber}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* How it works */}
      <div className="card">
        <h2>How it works</h2>
        <ol style={{ paddingLeft: "1.2rem", lineHeight: "1.9" }}>
          <li>Connect your MetaMask wallet (Sepolia testnet).</li>
          <li>Enter your flight number and travel date, then pay 0.001 ETH.</li>
          <li>After your flight lands, the oracle script checks the delay and calls the contract.</li>
          <li>If the delay was 60+ minutes, 0.003 ETH is sent to your wallet automatically — no claim needed.</li>
        </ol>
      </div>
    </div>
  );
}

export default App;
