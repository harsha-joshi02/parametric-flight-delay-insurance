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
});
