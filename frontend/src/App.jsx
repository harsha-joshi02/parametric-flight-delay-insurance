import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract.js";

const STATUS_LABELS = ["Active", "Triggered", "Paid", "Expired"];

function App() {
  const [account, setAccount]       = useState(null);
  const [contract, setContract]     = useState(null);
  const [balance, setBalance]       = useState("—");
  const [policies, setPolicies]     = useState([]);
  const [flightId, setFlightId]     = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [msg, setMsg]               = useState("");
  const [loading, setLoading]       = useState(false);

  // Connect MetaMask
  async function connect() {
    if (!window.ethereum) { alert("Install MetaMask first!"); return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer   = await provider.getSigner();
    const addr     = await signer.getAddress();
    const c        = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    setAccount(addr);
    setContract(c);
    await refreshBalance(c);
    await loadMyPolicies(c, addr);
  }

  async function refreshBalance(c) {
    try {
      const bal = await c.contractBalance();
      setBalance(ethers.formatEther(bal) + " ETH");
    } catch { setBalance("—"); }
  }

  // Load all policies belonging to connected wallet
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

  // Buy a new policy
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
      await loadMyPolicies(contract, account);
      await refreshBalance(contract);
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
