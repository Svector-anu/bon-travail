// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ProofworkEscrow is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Released,
        Refunded
    }

    error NotOperator();
    error NotFunded();
    error AlreadyFunded();
    error DeadlineNotPassed();
    error DeadlineInPast();
    error InvalidWorker();
    error AmountOutOfRange();
    error ZeroAddress();
    error ZeroMaxReward();
    error RenounceDisabled();

    event TaskFunded(bytes32 indexed taskId, uint256 amount, uint64 deadline);
    event TaskReleased(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskRefunded(bytes32 indexed taskId, address indexed to, uint256 amount);
    event OperatorSet(address indexed previousOperator, address indexed newOperator);

    struct EscrowEntry {
        uint256 amount;
        uint64 deadline;
        Status status;
        address funder;
    }

    mapping(bytes32 => EscrowEntry) private _escrows;
    IERC20 private immutable _usdc;
    address private _operator;
    uint256 private immutable _maxReward;

    modifier onlyOperator() {
        _checkOperator();
        _;
    }

    constructor(address usdc_, address operator_, address owner_, uint256 maxReward_) Ownable(owner_) {
        if (usdc_ == address(0) || operator_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (maxReward_ == 0) {
            revert ZeroMaxReward();
        }

        _usdc = IERC20(usdc_);
        _operator = operator_;
        _maxReward = maxReward_;
    }

    function fund(bytes32 taskId, uint256 amount, uint64 deadline) external onlyOperator whenNotPaused nonReentrant {
        if (_escrows[taskId].status != Status.None) {
            revert AlreadyFunded();
        }
        if (amount == 0 || amount > _maxReward) {
            revert AmountOutOfRange();
        }
        if (deadline <= block.timestamp) {
            revert DeadlineInPast();
        }

        _usdc.safeTransferFrom(_operator, address(this), amount);
        _escrows[taskId] = EscrowEntry({amount: amount, deadline: deadline, status: Status.Funded, funder: msg.sender});

        emit TaskFunded(taskId, amount, deadline);
    }

    function release(bytes32 taskId, address worker) external onlyOperator nonReentrant {
        EscrowEntry storage entry = _escrows[taskId];
        if (entry.status != Status.Funded) {
            revert NotFunded();
        }
        if (worker == address(0) || worker == _operator) {
            revert InvalidWorker();
        }

        uint256 amount = entry.amount;
        entry.status = Status.Released;

        _usdc.safeTransfer(worker, amount);

        emit TaskReleased(taskId, worker, amount);
    }

    function refund(bytes32 taskId) external onlyOperator nonReentrant {
        EscrowEntry storage entry = _escrows[taskId];
        if (entry.status != Status.Funded) {
            revert NotFunded();
        }
        if (block.timestamp < entry.deadline) {
            revert DeadlineNotPassed();
        }

        uint256 amount = entry.amount;
        entry.status = Status.Refunded;

        _usdc.safeTransfer(entry.funder, amount);

        emit TaskRefunded(taskId, entry.funder, amount);
    }

    function escrows(bytes32 taskId) external view returns (uint256 amount, uint64 deadline, Status status) {
        EscrowEntry memory entry = _escrows[taskId];
        return (entry.amount, entry.deadline, entry.status);
    }

    function usdc() external view returns (address) {
        return address(_usdc);
    }

    function operator() external view returns (address) {
        return _operator;
    }

    function maxReward() external view returns (uint256) {
        return _maxReward;
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) {
            revert ZeroAddress();
        }
        address previousOperator = _operator;
        _operator = newOperator;

        emit OperatorSet(previousOperator, newOperator);
    }

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _checkOperator() internal view {
        if (msg.sender != _operator) {
            revert NotOperator();
        }
    }
}
