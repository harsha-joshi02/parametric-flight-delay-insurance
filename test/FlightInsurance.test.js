const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("FlightInsurance", function () {
  let contract, owner, oracle, user1, user2;
  const PREMIUM = ethers.parseEther("0.001");
  const PAYOUT  = ethers.parseEther("0.003");
  const futureDate = Math.floor(Date.now() / 1000) + 86400; // tomorrow

  beforeEach(async function () {
    [owner, oracle, user1, user2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FlightInsurance");
    contract = await Factory.deploy(oracle.address);

    // Fund contract so it can pay out
    await contract.connect(owner).fund({ value: ethers.parseEther("1") });
  });

  it("lets a user buy a policy with correct premium", async function () {
    await expect(
      contract.connect(user1).buyPolicy("AA123", futureDate, { value: PREMIUM })
    ).to.emit(contract, "PolicyCreated").withArgs(0, user1.address, "AA123");

    const p = await contract.getPolicy(0);
    expect(p.policyholder).to.equal(user1.address);
    expect(p.flightId).to.equal("AA123");
    expect(p.status).to.equal(0n); // Active
  });

  it("rejects wrong premium amount", async function () {
    await expect(
      contract.connect(user1).buyPolicy("AA123", futureDate, { value: ethers.parseEther("0.002") })
    ).to.be.revertedWith("Send exactly 0.001 ETH");
  });

  it("pays out when delay >= 60 minutes", async function () {
    await contract.connect(user1).buyPolicy("AA123", futureDate, { value: PREMIUM });

    const before = await ethers.provider.getBalance(user1.address);
    await contract.connect(oracle).reportDelay(0, 90); // 90 min delay
    const after = await ethers.provider.getBalance(user1.address);

    expect(after - before).to.equal(PAYOUT);

    const p = await contract.getPolicy(0);
    expect(p.status).to.equal(2n); // Paid
  });

  it("does NOT pay out when delay < 60 minutes", async function () {
    await contract.connect(user1).buyPolicy("AA123", futureDate, { value: PREMIUM });

    const before = await ethers.provider.getBalance(user1.address);
    await contract.connect(oracle).reportDelay(0, 30); // only 30 min
    const after = await ethers.provider.getBalance(user1.address);

    expect(after).to.equal(before); // no change
    const p = await contract.getPolicy(0);
    expect(p.status).to.equal(0n); // still Active
  });

  it("rejects oracle call from a non-oracle address", async function () {
    await contract.connect(user1).buyPolicy("AA123", futureDate, { value: PREMIUM });
    await expect(
      contract.connect(user2).reportDelay(0, 90)
    ).to.be.revertedWith("Not oracle");
  });

  it("expires policy after 2 days past travel date", async function () {
    await contract.connect(user1).buyPolicy("AA123", futureDate, { value: PREMIUM });

    // Fast-forward time past travelDate + 2 days
    await ethers.provider.send("evm_increaseTime", [86400 * 3]);
    await ethers.provider.send("evm_mine");

    await expect(
      contract.expirePolicy(0)
    ).to.emit(contract, "PolicyExpired").withArgs(0);

    const p = await contract.getPolicy(0);
    expect(p.status).to.equal(3n); // Expired
  });

  // --- New test cases ---

  // Test A: reportDelay reverts when contract doesn't have enough ETH to cover PAYOUT_AMOUNT
  it("reverts reportDelay when contract balance is insufficient for payout", async function () {
    const Factory = await ethers.getContractFactory("FlightInsurance");
    const unfunded = await Factory.deploy(oracle.address);
    // Deliberately do NOT fund — balance is 0

    // Derive a fresh future date from block.timestamp to be immune to evm_increaseTime side-effects
    const block = await ethers.provider.getBlock("latest");
    const testFutureDate = block.timestamp + 86400 * 7;

    await unfunded.connect(user1).buyPolicy("BA456", testFutureDate, { value: PREMIUM });

    await expect(
      unfunded.connect(oracle).reportDelay(0, 90)
    ).to.be.revertedWith("Insufficient contract balance");
  });

  // Test B: reportDelay can only be called by the designated oracle address
  it("confirms that only the oracle can call reportDelay", async function () {
    const block = await ethers.provider.getBlock("latest");
    const testFutureDate = block.timestamp + 86400 * 7;

    await contract.connect(user1).buyPolicy("DL789", testFutureDate, { value: PREMIUM });

    // policyholder attempting to call reportDelay should revert
    await expect(
      contract.connect(user1).reportDelay(0, 90)
    ).to.be.revertedWith("Not oracle");

    // owner attempting to call reportDelay should also revert
    await expect(
      contract.connect(owner).reportDelay(0, 90)
    ).to.be.revertedWith("Not oracle");
  });

  // Test C: buyPolicy reverts when travelDate is in the past
  it("reverts buyPolicy when travel date is in the past", async function () {
    const pastDate = Math.floor(Date.now() / 1000) - 86400; // yesterday

    await expect(
      contract.connect(user1).buyPolicy("UA999", pastDate, { value: PREMIUM })
    ).to.be.revertedWith("Travel date must be in the future");
  });
});
