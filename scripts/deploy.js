const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // The oracle address is whoever will run oracle.js
  // For local testing we use the deployer; for testnet set ORACLE_ADDRESS in .env
  const oracleAddress = process.env.ORACLE_ADDRESS || deployer.address;

  const Factory = await ethers.getContractFactory("FlightInsurance");
  const contract = await Factory.deploy(oracleAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("FlightInsurance deployed to:", address);
  console.log("Oracle address set to:", oracleAddress);

  // Fund the contract with 0.01 ETH so it can pay out
  const fundTx = await contract.fund({ value: ethers.parseEther("0.01") });
  await fundTx.wait();
  console.log("Contract funded with 0.01 ETH");
  console.log("\nAdd this to your .env:");
  console.log(`CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
