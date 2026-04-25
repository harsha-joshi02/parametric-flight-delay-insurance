/**
 * Oracle Script — simulates a Chainlink-style oracle:
 *   1. Reads flight delay data from AviationStack API (free tier)
 *   2. Calls reportDelay() on the smart contract
 *
 * Usage:
 *   node scripts/oracle.js <policyId> <flightIATA> [date YYYY-MM-DD]
 *
 * Simulation (no API key):
 *   node scripts/oracle.js 0 DELAYED    => 120 min delay -> payout
 *   node scripts/oracle.js 0 ONTIME     => 10 min delay  -> no payout
 */

const { ethers } = require("ethers");
const axios      = require("axios");
require("dotenv").config();

const ABI = [
  "function reportDelay(uint256 policyId, uint256 delayMinutes) external"
];

async function getDelayMinutes(flightNumber, date) {
  // Simulation mode (no API key needed for demos)
  if (flightNumber === "DELAYED") return 120;
  if (flightNumber === "ONTIME")  return 10;

  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) {
    console.log("No AVIATIONSTACK_KEY found — simulating 0-minute delay.");
    return 0;
  }

  const url = `http://api.aviationstack.com/v1/flights?access_key=${key}&flight_iata=${flightNumber}&flight_date=${date}`;
  const { data } = await axios.get(url);

  if (!data.data || data.data.length === 0) {
    throw new Error(`No flight data found for ${flightNumber} on ${date}`);
  }

  const flight    = data.data[0];
  const scheduled = flight.departure?.scheduled;
  const actual    = flight.departure?.actual || flight.departure?.estimated;

  if (!scheduled || !actual) return 0;

  const delayMs = new Date(actual) - new Date(scheduled);
  return Math.max(0, Math.round(delayMs / 60000));
}

async function main() {
  const [, , policyIdArg, flightNumber, date] = process.argv;

  if (!policyIdArg || !flightNumber) {
    console.error("Usage: node scripts/oracle.js <policyId> <flightNumber> [date YYYY-MM-DD]");
    process.exit(1);
  }

  const policyId   = parseInt(policyIdArg);
  const flightDate = date || new Date().toISOString().split("T")[0];

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

  console.log(`Checking flight ${flightNumber} on ${flightDate}...`);
  const delayMinutes = await getDelayMinutes(flightNumber, flightDate);
  console.log(`Delay: ${delayMinutes} minutes`);

  console.log(`Reporting delay for policy #${policyId}...`);
  const tx = await contract.reportDelay(policyId, delayMinutes);
  await tx.wait();
  console.log(`Done! Tx: ${tx.hash}`);

  if (delayMinutes >= 60) {
    console.log("Flight delayed >= 60 min — payout sent automatically!");
  } else {
    console.log("On time (or delay < 60 min) — no payout.");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
