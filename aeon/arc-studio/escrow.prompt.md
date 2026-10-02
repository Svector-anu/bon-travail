Write, test and deploy a Solidity contract named ProofworkEscrow on Arc testnet (max preset: full tests and audit).

Purpose: escrow for Proofwork, where an autonomous agent (the operator) posts small tasks, a human answers, the agent verifies the answer off-chain, then pays the reward or refunds it. Every reward must move on-chain through this contract.

Token: Arc testnet USDC via its ERC-20 interface at 0x3600000000000000000000000000000000000000 (6 decimals). Use SafeERC20.

Constructor: (address usdc_, address operator_, address owner_, uint256 maxReward_)
- operator_ and owner_ are both OPERATOR_ADDRESS (given below). Do not use the deployer address for either.
- maxReward_ = 1000000 (1.00 USDC).

Interface (implement exactly, same names, events and signatures):

    enum Status { None, Funded, Released, Refunded }
    event TaskFunded(bytes32 indexed taskId, uint256 amount, uint64 deadline);
    event TaskReleased(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed to, uint256 amount);
    function fund(bytes32 taskId, uint256 amount, uint64 deadline) external;
    function release(bytes32 taskId, address worker) external;
    function refund(bytes32 taskId) external;
    function escrows(bytes32 taskId) external view returns (uint256 amount, uint64 deadline, Status status);
    function usdc() external view returns (address);
    function operator() external view returns (address);
    function maxReward() external view returns (uint256);

Rules:
- fund: only operator; status must be None; 0 < amount <= maxReward; deadline > block.timestamp; transferFrom(operator, this, amount); status = Funded.
- release: only operator; status must be Funded; worker != address(0) and worker != operator; set status = Released before transferring (checks-effects-interactions); transfer amount to worker. Allowed before or after the deadline (answers submitted in time may be verified late).
- refund: only operator; status must be Funded; block.timestamp >= deadline; status = Refunded; transfer amount back to operator.
- A task can never be both released and refunded; every call after settlement reverts.
- Owner (Ownable2Step) can pause/unpause fund and setOperator. Pausing must never block release or refund of already funded tasks.
- ReentrancyGuard on all state-changing functions. Custom errors, no revert strings.

Tests (Foundry): happy path fund then release; refund after deadline; refund before deadline reverts; double release reverts; release after refund reverts; non-operator calls revert; amount above maxReward reverts; pause blocks fund but not release or refund.

Deploy to Arc testnet with OPERATOR_ADDRESS = __OPERATOR_ADDRESS__ and report the deployed address, transaction hash and explorer link.
