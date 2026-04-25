// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FlightInsurance {
    address public owner;
    address public oracle;

    uint256 public constant PREMIUM = 0.001 ether;
    uint256 public constant PAYOUT  = 0.003 ether;
    uint256 public constant DELAY_THRESHOLD_MINUTES = 60;

    enum Status { Active, Triggered, Paid, Expired }

    struct Policy {
        address policyholder;
        string  flightId;
        uint256 travelDate;   // unix timestamp (start of day)
        Status  status;
    }

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // Events
    event PolicyCreated(uint256 indexed policyId, address indexed holder, string flightId);
    event PolicyTriggered(uint256 indexed policyId, uint256 delayMinutes);
    event PolicyPaid(uint256 indexed policyId, address indexed holder, uint256 amount);
    event PolicyExpired(uint256 indexed policyId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    constructor(address _oracle) {
        owner  = msg.sender;
        oracle = _oracle;
    }

    // Owner funds the contract so it can pay out
    function fund() external payable onlyOwner {}

    // User buys a policy by sending exactly PREMIUM
    function buyPolicy(string calldata flightId, uint256 travelDate) external payable {
        require(msg.value == PREMIUM, "Send exactly 0.001 ETH");
        require(travelDate > block.timestamp, "Travel date must be in the future");

        uint256 policyId = nextPolicyId++;
        policies[policyId] = Policy({
            policyholder: msg.sender,
            flightId:     flightId,
            travelDate:   travelDate,
            status:       Status.Active
        });

        emit PolicyCreated(policyId, msg.sender, flightId);
    }

    // Oracle reports flight delay in minutes
    // If delay >= threshold, payout is sent automatically
    function reportDelay(uint256 policyId, uint256 delayMinutes) external onlyOracle {
        Policy storage p = policies[policyId];
        require(p.status == Status.Active, "Policy not active");

        if (delayMinutes >= DELAY_THRESHOLD_MINUTES) {
            p.status = Status.Triggered;
            emit PolicyTriggered(policyId, delayMinutes);

            require(address(this).balance >= PAYOUT, "Contract underfunded");
            p.status = Status.Paid;
            payable(p.policyholder).transfer(PAYOUT);
            emit PolicyPaid(policyId, p.policyholder, PAYOUT);
        }
        // If delay < threshold, nothing happens (policy stays Active until expiry)
    }

    // Anyone can expire a policy after travel date + 2 days have passed
    function expirePolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.status == Status.Active, "Policy not active");
        require(block.timestamp > p.travelDate + 2 days, "Too early to expire");
        p.status = Status.Expired;
        emit PolicyExpired(policyId);
    }

    // Read helpers
    function getPolicy(uint256 policyId) external view returns (
        address policyholder,
        string memory flightId,
        uint256 travelDate,
        Status status
    ) {
        Policy storage p = policies[policyId];
        return (p.policyholder, p.flightId, p.travelDate, p.status);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
