# Parametric Flight Delay Insurance

A blockchain-based insurance system where a smart contract automatically pays out ETH when your flight is delayed — no claims, no adjusters.

**Stack:** Solidity · Hardhat · ethers.js · React · Vite

---

## How it works

1. A user pays **0.001 ETH** to buy a policy for a specific flight.
2. After the flight, an **oracle script** checks the actual delay from a flight API.
3. If the delay is **≥ 60 minutes**, the smart contract instantly sends **0.003 ETH** to the user's wallet.
4. No human intervention. The code enforces the rules.

```
User (MetaMask)  →  buyPolicy()  →  Smart Contract
                                         ↑
Oracle Script    →  reportDelay()  ──────┘
(reads flight API)
```

---

## Project Structure

```
blockchain project/
├── contracts/
│   └── FlightInsurance.sol   ← the smart contract
├── scripts/
│   ├── deploy.js             ← deploys the contract
│   └── oracle.js             ← reads flight data, calls reportDelay()
├── test/
│   └── FlightInsurance.test.js
├── frontend/
│   └── src/
│       ├── App.jsx           ← main UI
│       └── contract.js       ← contract address + ABI
├── hardhat.config.js
└── .env.example
```

---

## Step 1 — Install

```bash
# Root project (contract + oracle)
npm install

# Frontend
cd frontend
npm install
```

---

## Step 2 — Run Tests (no setup needed)

```bash
npm test
```

You should see **6 passing** tests covering the full policy lifecycle.

---

## Step 3 — Set Up Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY   # from alchemy.com (free)
PRIVATE_KEY=your_metamask_private_key                    # MetaMask → Account Details → Export Key
ORACLE_ADDRESS=                                          # same as your wallet address for this demo
AVIATIONSTACK_KEY=                                       # optional, from aviationstack.com (free tier)
```

> **How to get Sepolia test ETH:** Go to `sepoliafaucet.com` and paste your wallet address.

---

## Step 4 — Deploy to Sepolia

```bash
npm run deploy:sepolia
```

Copy the printed `CONTRACT_ADDRESS` into:
- `.env` → `CONTRACT_ADDRESS=0x...`
- `frontend/src/contract.js` → `CONTRACT_ADDRESS = "0x..."`

---

## Step 5 — Run the Frontend

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

1. Click **Connect MetaMask** (make sure MetaMask is on Sepolia network)
2. Enter a flight number (e.g. `AA123`) and a future travel date
3. Click **Buy Policy** and confirm the 0.001 ETH transaction

---

## Step 6 — Run the Oracle

After your flight date, run:

```bash
# Simulate a DELAYED flight (triggers payout):
node scripts/oracle.js 0 DELAYED

# Simulate an ON-TIME flight (no payout):
node scripts/oracle.js 0 ONTIME

# Real flight (needs AVIATIONSTACK_KEY in .env):
node scripts/oracle.js 0 AA123 2025-05-01
```

The script reports the delay to the contract. If delay ≥ 60 min, the contract sends 0.003 ETH to the policyholder automatically.

---

## Contract Summary

| Function | Who calls it | What it does |
|---|---|---|
| `buyPolicy(flightId, date)` | User (+ 0.001 ETH) | Creates a new policy |
| `reportDelay(policyId, minutes)` | Oracle only | Triggers payout if delay ≥ 60 min |
| `expirePolicy(policyId)` | Anyone | Marks policy expired after 2 days past travel |
| `fund()` | Owner (+ ETH) | Deposits ETH so contract can pay out |

**Policy states:** Active → Triggered → Paid (or) Active → Expired

---

## Security Notes (as required by the proposal)

1. **Oracle access control** — only the address set as `oracle` at deploy time can call `reportDelay()`. Anyone else gets "Not oracle".
2. **Reentrancy** — `transfer()` is used instead of `call()` to cap gas and prevent reentrancy attacks.
3. **Integer overflow** — Solidity 0.8+ has built-in overflow checks.
4. **Underfunding** — the contract checks its own balance before paying out and reverts if insufficient.

---

## Known Limitations

- The oracle is a single trusted address (centralized). Production would use Chainlink.
- Policy data (flight, wallet, date) is public on-chain — privacy trade-off acknowledged.
- Premiums are fixed tiers, not actuarially priced.
- Sepolia testnet only — no real money.
