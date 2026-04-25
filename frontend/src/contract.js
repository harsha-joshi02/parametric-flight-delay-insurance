// Paste your deployed contract address here after running: node scripts/deploy.js
export const CONTRACT_ADDRESS = "0x37002c178e6B35dc4CfEc9dC6147EB6915033838";

export const ABI = [
  "function PREMIUM() view returns (uint256)",
  "function PAYOUT() view returns (uint256)",
  "function DELAY_THRESHOLD_MINUTES() view returns (uint256)",
  "function nextPolicyId() view returns (uint256)",
  "function buyPolicy(string flightId, uint256 travelDate) payable",
  "function getPolicy(uint256 policyId) view returns (address policyholder, string flightId, uint256 travelDate, uint8 status)",
  "function contractBalance() view returns (uint256)",
  "event PolicyCreated(uint256 indexed policyId, address indexed holder, string flightId)",
  "event PolicyPaid(uint256 indexed policyId, address indexed holder, uint256 amount)",
];
