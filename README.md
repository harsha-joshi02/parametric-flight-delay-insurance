# Parametric Flight Delay Insurance

A blockchain-based insurance system where a smart contract automatically pays out ETH when your flight is delayed — no claims, no adjusters.

**Stack:** Solidity · Hardhat · ethers.js · React · Vite  
**Network:** Ethereum Sepolia Testnet  
**Contract:** `0x37002c178e6B35dc4CfEc9dC6147EB6915033838`

---

## How it works

1. A user pays **0.001 ETH** to buy a policy for a specific flight.
2. After the flight, an oracle script reports the delay to the contract.
3. If the delay is **≥ 60 minutes**, the contract instantly sends **0.003 ETH** to the user's wallet — automatically.

---

## Project Structure

```
├── contracts/FlightInsurance.sol   ← smart contract
├── scripts/deploy.js               ← deploys the contract
├── scripts/oracle.js               ← reports flight delay on-chain
├── test/FlightInsurance.test.js    ← unit tests
└── frontend/                       ← React UI
```

---

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd flight-delay-insurance
npm install
cd frontend && npm install && cd ..

# 2. Create your .env
cp .env.example .env
```

Fill in `.env`:
- `RPC_URL` — create a free app at alchemy.com, select Ethereum Sepolia, copy the URL
- `PRIVATE_KEY` — MetaMask → click account → 3 dots → Account Details → Show private key → add `0x` at the front
- `CONTRACT_ADDRESS` — already deployed: `0x37002c178e6B35dc4CfEc9dC6147EB6915033838`

Also paste the contract address in `frontend/src/contract.js`.

> **Need Sepolia test ETH?** Search "Google Cloud Sepolia Faucet" on Google and paste your wallet address — free.

---

## Run Tests

```bash
npm test
# 9 passing
```

---

## Run the Frontend

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`, connect MetaMask (on Sepolia), enter a flight number (e.g. `AA123`) and a future date, and buy a policy.

---

## Simulate a Payout (Oracle)

> Only the person who deployed the contract can run this.

```bash
# Delayed flight → triggers payout
node scripts/oracle.js <policyId> DELAYED

# On-time flight → no payout
node scripts/oracle.js <policyId> ONTIME
```

Replace `<policyId>` with the policy number shown on the frontend. If delayed, 0.003 ETH lands in the policyholder's wallet automatically.

---

## Contract Summary

| Function | Who | What |
|---|---|---|
| `buyPolicy(flightId, date)` | User + 0.001 ETH | Creates a policy |
| `reportDelay(policyId, minutes)` | Oracle only | Pays out if delay ≥ 60 min |
| `expirePolicy(policyId)` | Anyone | Expires policy after 2 days past travel |

**Policy states:** Active → Paid (or) Active → Expired

---

## Known Limitations

- Oracle is a single trusted address — production would use Chainlink.
- All policy data is public on-chain (no privacy).
- Fixed premium/payout — no dynamic pricing.
- Sepolia testnet only, no real money involved.

---

## Production Roadmap

Each known limitation has a clear path to a production-ready solution.

### Decentralized Oracle

The current design trusts a single wallet address to report flight delays honestly. If that key is compromised, or the operator goes offline, payouts fail or can be falsified. In production, this would be replaced with **Chainlink Any API**: the oracle node fetches delay data from a flight-status provider (e.g. AviationStack), signs the response cryptographically, and submits it to an on-chain aggregator. The contract only accepts a result that carries a valid Chainlink signature, meaning no single party — including the contract owner — can fabricate or censor a delay report. The trust model shifts from "trust the operator" to "trust the cryptographic proof."

### Privacy

Every field in the current `Policy` struct — flight ID, travel date, policyholder wallet — is readable by anyone on-chain. This links a person's identity (their wallet) to their travel plans. A production system would use a **commitment scheme**: at purchase time the user submits `keccak256(flightId, salt)` instead of the raw flight ID. The actual flight ID and salt are kept off-chain by the user. At claim time (or when the oracle reports), the user reveals the preimage and the contract verifies it matches the stored hash before processing the payout. No flight data is publicly linkable to a wallet address until the moment of payout, and even then only the confirmed flight is revealed.

### Dynamic Pricing

A fixed 0.001 ETH premium is actuarially naive — a notoriously delay-prone route carries far more risk than a short domestic hop. A production system would calculate premiums using an on-chain actuarial model fed by Chainlink oracle data: historical delay rates per airline, route, season, and time of day would inform a per-policy risk score, and the premium would be set as a multiple of expected loss. This makes the insurance pool self-sustaining without requiring the owner to top it up manually.

### Mainnet Readiness

Before handling real funds, the contract would need a professional security audit from a firm specializing in smart contract security (e.g. Trail of Bits, OpenZeppelin, or Consensys Diligence). The audit should cover reentrancy edge cases, oracle manipulation vectors, integer overflow/underflow, access control completeness, and economic attack surfaces such as griefing or pool-draining. Deployment to mainnet without an audit with real user funds at stake would be irresponsible.
