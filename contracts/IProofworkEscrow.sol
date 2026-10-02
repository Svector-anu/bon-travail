// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Interface Proofwork's payment rail calls. Arc Studio implements and deploys it.
interface IProofworkEscrow {
    enum Status { None, Funded, Released, Refunded }

    event TaskFunded(bytes32 indexed taskId, uint256 amount, uint64 deadline);
    event TaskReleased(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed to, uint256 amount);

    /// Pulls `amount` USDC from the operator into escrow for one task.
    function fund(bytes32 taskId, uint256 amount, uint64 deadline) external;

    /// Pays the escrowed reward to the worker whose answer the operator verified.
    function release(bytes32 taskId, address worker) external;

    /// Returns the reward to the operator once the deadline has passed.
    function refund(bytes32 taskId) external;

    function escrows(bytes32 taskId) external view returns (uint256 amount, uint64 deadline, Status status);
    function usdc() external view returns (address);
    function operator() external view returns (address);
    function maxReward() external view returns (uint256);
}
