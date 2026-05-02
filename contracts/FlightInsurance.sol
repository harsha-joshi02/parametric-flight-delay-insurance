// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title FlightInsurance
/// @notice Parametric flight delay insurance — pays out ETH automatically when a flight is delayed.
/// @dev Owner funds the contract pool; a trusted oracle reports delays and triggers payouts.
///      Inherits ReentrancyGuard to protect ETH transfers and Ownable for access-controlled admin ops.
contract FlightInsurance is ReentrancyGuard, Ownable {

    /// @notice Address authorized to report flight delays on-chain.
    address public oracle;

    /// @notice Premium a policyholder must pay when buying a policy.
    uint256 public constant PREMIUM = 0.001 ether;

    /// @notice Payout amount automatically sent to a policyholder on a qualifying delay.
    uint256 public constant PAYOUT_AMOUNT = 0.003 ether;

    /// @notice Minimum delay in minutes required to trigger a payout.
    uint256 public constant DELAY_THRESHOLD = 60;

    /// @notice Time after the travel date beyond which an unclaimed policy may be expired.
    uint256 public constant EXPIRY_WINDOW = 2 days;

    enum Status { Active, Triggered, Paid, Expired }

    struct Policy {
        address policyholder;
        string  flightId;
        uint256 travelDate;   // unix timestamp (start of travel day)
        Status  status;
    }

    uint256 public nextPolicyId;
    mapping(uint256 => Policy) public policies;

    // Events
    event PolicyCreated(uint256 indexed policyId, address indexed holder, string flightId);
    event PolicyTriggered(uint256 indexed policyId, uint256 delayMinutes);
    event PolicyPaid(uint256 indexed policyId, address indexed holder, uint256 amount);
    event PolicyExpired(uint256 indexed policyId);

    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }

    /// @notice Deploys the contract, sets the deployer as owner, and registers the oracle address.
    /// @param _oracle The address that will be authorized to call reportDelay.
    constructor(address _oracle) Ownable(msg.sender) {
        oracle = _oracle;
    }

    /// @notice Allows the owner to deposit ETH into the contract to fund future payouts.
    function fund() external payable onlyOwner {}

    /// @notice Purchase a flight delay policy by sending exactly PREMIUM (0.001 ETH).
    /// @param flightId The flight identifier string, e.g. "AA123".
    /// @param travelDate Unix timestamp of the scheduled departure; must be in the future.
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

    /// @notice Called by the oracle to report a flight delay in minutes.
    ///         If the delay meets or exceeds DELAY_THRESHOLD, the payout is sent automatically.
    /// @param policyId The ID of the policy being evaluated.
    /// @param delayMinutes The reported delay of the flight in minutes.
    /// @dev nonReentrant prevents a malicious policyholder contract from re-entering during the ETH transfer.
    function reportDelay(uint256 policyId, uint256 delayMinutes) external onlyOracle nonReentrant {
        Policy storage p = policies[policyId];
        require(p.status == Status.Active, "Policy not active");

        if (delayMinutes >= DELAY_THRESHOLD) {
            p.status = Status.Triggered;
            emit PolicyTriggered(policyId, delayMinutes);

            require(address(this).balance >= PAYOUT_AMOUNT, "Insufficient contract balance");
            p.status = Status.Paid;
            payable(p.policyholder).transfer(PAYOUT_AMOUNT);
            emit PolicyPaid(policyId, p.policyholder, PAYOUT_AMOUNT);
        }
        // If delay < DELAY_THRESHOLD, policy remains Active until expiry
    }

    /// @notice Marks an active policy as Expired once the travel date plus EXPIRY_WINDOW has passed.
    ///         Can be called by anyone — useful for automated cleanup.
    /// @param policyId The ID of the policy to expire.
    function expirePolicy(uint256 policyId) external {
        Policy storage p = policies[policyId];
        require(p.status == Status.Active, "Policy not active");
        require(block.timestamp > p.travelDate + EXPIRY_WINDOW, "Too early to expire");
        p.status = Status.Expired;
        emit PolicyExpired(policyId);
    }

    /// @notice Allows the owner to withdraw ETH from the contract pool.
    /// @param amount The amount of ETH (in wei) to withdraw to the owner's wallet.
    function withdrawFunds(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient contract balance");
        payable(owner()).transfer(amount);
    }

    /// @notice Returns all stored details for a given policy.
    /// @param policyId The ID of the policy to look up.
    /// @return policyholder The wallet address that purchased the policy.
    /// @return flightId The flight identifier string.
    /// @return travelDate The scheduled departure timestamp (unix).
    /// @return status The current lifecycle status of the policy.
    function getPolicy(uint256 policyId) external view returns (
        address policyholder,
        string memory flightId,
        uint256 travelDate,
        Status status
    ) {
        Policy storage p = policies[policyId];
        return (p.policyholder, p.flightId, p.travelDate, p.status);
    }

    /// @notice Returns the current ETH balance held by the contract.
    /// @return The balance in wei.
    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
