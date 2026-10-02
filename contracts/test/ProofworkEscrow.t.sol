// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProofworkEscrow} from "../ProofworkEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @title ProofworkEscrowTest
/// @notice Comprehensive unit tests for ProofworkEscrow.
contract ProofworkEscrowTest is Test {
    // ─── actors ───────────────────────────────────────────────────────────────
    address internal owner    = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal worker   = makeAddr("worker");
    address internal stranger = makeAddr("stranger");

    // ─── contracts ────────────────────────────────────────────────────────────
    MockERC20        internal usdc;
    ProofworkEscrow  internal escrow;

    // ─── constants ────────────────────────────────────────────────────────────
    uint256 internal constant MAX_REWARD = 1_000_000; // 1 USDC (6 decimals)
    uint256 internal constant AMOUNT     = 500_000;   // 0.5 USDC
    uint64  internal constant DURATION   = 7 days;

    // Convenience task ids
    bytes32 internal constant TASK_A = keccak256("task-a");
    bytes32 internal constant TASK_B = keccak256("task-b");

    // ─── setUp ────────────────────────────────────────────────────────────────
    function setUp() public {
        // 1. Deploy a fresh mock USDC (6 decimals).
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);

        // 2. Deploy escrow.  owner == owner, operator == operator, usdc == mock.
        escrow = new ProofworkEscrow(address(usdc), operator, owner, MAX_REWARD);

        // 3. Fund the operator with USDC and pre-approve the escrow.
        usdc.mint(operator, 100 * MAX_REWARD);
        vm.prank(operator);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. Deployment & initialisation
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsFields() public view {
        assertEq(escrow.usdc(),      address(usdc),  "usdc mismatch");
        assertEq(escrow.operator(),  operator,        "operator mismatch");
        assertEq(escrow.maxReward(), MAX_REWARD,      "maxReward mismatch");
        assertEq(escrow.owner(),     owner,           "owner mismatch");
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(ProofworkEscrow.ZeroAddress.selector);
        new ProofworkEscrow(address(0), operator, owner, MAX_REWARD);
    }

    function test_Constructor_RevertsZeroOperator() public {
        vm.expectRevert(ProofworkEscrow.ZeroAddress.selector);
        new ProofworkEscrow(address(usdc), address(0), owner, MAX_REWARD);
    }

    function test_Constructor_RevertsZeroOwner() public {
        // OpenZeppelin Ownable's base constructor fires OwnableInvalidOwner
        // before the contract's own ZeroAddress check when owner_ == address(0).
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ProofworkEscrow(address(usdc), operator, address(0), MAX_REWARD);
    }

    function test_Constructor_RevertsZeroMaxReward() public {
        vm.expectRevert(ProofworkEscrow.ZeroMaxReward.selector);
        new ProofworkEscrow(address(usdc), operator, owner, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. fund() — happy path                                        (Test case 1)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_HappyPath() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        // Expect TaskFunded event
        vm.expectEmit(true, false, false, true, address(escrow));
        emit ProofworkEscrow.TaskFunded(TASK_A, AMOUNT, deadline);

        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        // Status should be Funded
        (uint256 amt, uint64 dl, ProofworkEscrow.Status status) = escrow.escrows(TASK_A);
        assertEq(amt,               AMOUNT,                        "amount");
        assertEq(dl,                deadline,                      "deadline");
        assertEq(uint8(status),     uint8(ProofworkEscrow.Status.Funded), "status");

        // Escrow holds the USDC
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow balance");
        // Operator was debited
        assertEq(usdc.balanceOf(operator), 100 * MAX_REWARD - AMOUNT, "operator balance");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. fund() → release() — happy path                            (Test case 1)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Release_HappyPath() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        // Expect TaskReleased event
        vm.expectEmit(true, true, false, true, address(escrow));
        emit ProofworkEscrow.TaskReleased(TASK_A, worker, AMOUNT);

        vm.prank(operator);
        escrow.release(TASK_A, worker);

        // Worker received USDC
        assertEq(usdc.balanceOf(worker), AMOUNT, "worker balance");
        // Escrow drained
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
        // Status = Released
        (,, ProofworkEscrow.Status status) = escrow.escrows(TASK_A);
        assertEq(uint8(status), uint8(ProofworkEscrow.Status.Released), "status Released");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. refund() after deadline — happy path                       (Test case 2)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Refund_AfterDeadline() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        uint256 operatorBalBefore = usdc.balanceOf(operator);

        // Warp past deadline
        vm.warp(block.timestamp + DURATION + 1);

        // Expect TaskRefunded event (refund goes to entry.funder == operator)
        vm.expectEmit(true, true, false, true, address(escrow));
        emit ProofworkEscrow.TaskRefunded(TASK_A, operator, AMOUNT);

        vm.prank(operator);
        escrow.refund(TASK_A);

        // Operator received refund
        assertEq(usdc.balanceOf(operator), operatorBalBefore + AMOUNT, "operator refunded");
        // Escrow drained
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
        // Status = Refunded
        (,, ProofworkEscrow.Status status) = escrow.escrows(TASK_A);
        assertEq(uint8(status), uint8(ProofworkEscrow.Status.Refunded), "status Refunded");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. refund() before deadline reverts                           (Test case 3)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Refund_BeforeDeadline_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        // One second before deadline
        vm.warp(block.timestamp + DURATION - 1);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.DeadlineNotPassed.selector);
        escrow.refund(TASK_A);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. Double release reverts with NotFunded                      (Test case 4)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_DoubleRelease_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.prank(operator);
        escrow.release(TASK_A, worker);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.NotFunded.selector);
        escrow.release(TASK_A, worker);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. Release after refund reverts with NotFunded                (Test case 5)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_ReleaseAfterRefund_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(operator);
        escrow.refund(TASK_A);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.NotFunded.selector);
        escrow.release(TASK_A, worker);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Non-operator fund reverts with NotOperator                 (Test case 6)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_NonOperator_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        vm.prank(stranger);
        vm.expectRevert(ProofworkEscrow.NotOperator.selector);
        escrow.fund(TASK_A, AMOUNT, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. Non-operator release reverts with NotOperator              (Test case 7)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Release_NonOperator_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.prank(stranger);
        vm.expectRevert(ProofworkEscrow.NotOperator.selector);
        escrow.release(TASK_A, worker);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. Non-operator refund reverts with NotOperator              (Test case 8)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Refund_NonOperator_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(stranger);
        vm.expectRevert(ProofworkEscrow.NotOperator.selector);
        escrow.refund(TASK_A);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 11. Amount > maxReward reverts with AmountOutOfRange          (Test case 9)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_AmountAboveMaxReward_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.AmountOutOfRange.selector);
        escrow.fund(TASK_A, MAX_REWARD + 1, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 12. Amount = 0 reverts with AmountOutOfRange                 (Test case 10)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_AmountZero_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.AmountOutOfRange.selector);
        escrow.fund(TASK_A, 0, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 13. Pause blocks fund BUT NOT release / refund               (Test case 11)
    //     - fund succeeds → pause → release still works
    //     - fund succeeds → pause → warp past deadline → refund still works
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Pause_BlocksFundNotRelease() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        // Fund while unpaused
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        // Owner pauses
        vm.prank(owner);
        escrow.pause();

        // Release should still succeed while paused
        vm.prank(operator);
        escrow.release(TASK_A, worker);

        assertEq(usdc.balanceOf(worker), AMOUNT, "worker received USDC after pause");
    }

    function test_Pause_BlocksFundNotRefund() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;

        // Fund while unpaused
        vm.prank(operator);
        escrow.fund(TASK_B, AMOUNT, deadline);

        // Owner pauses
        vm.prank(owner);
        escrow.pause();

        // Warp past deadline
        vm.warp(block.timestamp + DURATION + 1);

        // Refund should still succeed while paused
        uint256 operatorBalBefore = usdc.balanceOf(operator);
        vm.prank(operator);
        escrow.refund(TASK_B);

        assertEq(usdc.balanceOf(operator), operatorBalBefore + AMOUNT, "operator refunded while paused");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 14. Pause blocks fund() — reverts with EnforcedPause         (Test case 12)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_WhenPaused_Reverts() public {
        vm.prank(owner);
        escrow.pause();

        uint64 deadline = uint64(block.timestamp) + DURATION;

        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        escrow.fund(TASK_A, AMOUNT, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 15. renounceOwnership reverts with RenounceDisabled          (Test case 13)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_RenounceOwnership_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ProofworkEscrow.RenounceDisabled.selector);
        escrow.renounceOwnership();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 16. fund() with deadline == block.timestamp reverts DeadlineInPast (case 14)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Fund_DeadlineEqualTimestamp_Reverts() public {
        uint64 deadline = uint64(block.timestamp); // not strictly in the future

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.DeadlineInPast.selector);
        escrow.fund(TASK_A, AMOUNT, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 17. Double fund same taskId reverts with AlreadyFunded       (Test case 15)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_DoubleFund_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.AlreadyFunded.selector);
        escrow.fund(TASK_A, AMOUNT, deadline);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 18. release() with worker == address(0) reverts InvalidWorker
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Release_ZeroWorker_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.InvalidWorker.selector);
        escrow.release(TASK_A, address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 19. release() with worker == operator reverts InvalidWorker
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Release_WorkerIsOperator_Reverts() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        vm.prank(operator);
        vm.expectRevert(ProofworkEscrow.InvalidWorker.selector);
        escrow.release(TASK_A, operator);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 20. setOperator() — owner can update; event emitted
    // ═══════════════════════════════════════════════════════════════════════════

    function test_SetOperator_HappyPath() public {
        address newOp = makeAddr("newOperator");

        vm.expectEmit(true, true, false, false, address(escrow));
        emit ProofworkEscrow.OperatorSet(operator, newOp);

        vm.prank(owner);
        escrow.setOperator(newOp);

        assertEq(escrow.operator(), newOp, "operator updated");
    }

    function test_SetOperator_NonOwner_Reverts() public {
        address newOp = makeAddr("newOperator");
        vm.prank(stranger);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        escrow.setOperator(newOp);
    }

    function test_SetOperator_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(ProofworkEscrow.ZeroAddress.selector);
        escrow.setOperator(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 21. pause() / unpause() access control
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Pause_NonOwner_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        escrow.pause();
    }

    function test_Unpause_NonOwner_Reverts() public {
        vm.prank(owner);
        escrow.pause();

        vm.prank(stranger);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        escrow.unpause();
    }

    function test_Unpause_RestoresFund() public {
        vm.prank(owner);
        escrow.pause();

        vm.prank(owner);
        escrow.unpause();

        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline); // should succeed
        (uint256 amt,,) = escrow.escrows(TASK_A);
        assertEq(amt, AMOUNT, "funded after unpause");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 22. refund() on exact deadline boundary (deadline == block.timestamp)
    //     must SUCCEED (deadline <= block.timestamp is the passing condition)
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Refund_ExactDeadline_Succeeds() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        vm.prank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);

        // Warp to EXACTLY the deadline
        vm.warp(deadline);

        vm.prank(operator);
        escrow.refund(TASK_A); // should not revert

        (,, ProofworkEscrow.Status status) = escrow.escrows(TASK_A);
        assertEq(uint8(status), uint8(ProofworkEscrow.Status.Refunded), "status Refunded at exact deadline");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 23. Multiple independent tasks can be funded and released
    // ═══════════════════════════════════════════════════════════════════════════

    function test_MultipleTasks_IndependentState() public {
        uint64 deadline = uint64(block.timestamp) + DURATION;
        address workerB = makeAddr("workerB");

        vm.startPrank(operator);
        escrow.fund(TASK_A, AMOUNT, deadline);
        escrow.fund(TASK_B, MAX_REWARD, deadline);
        vm.stopPrank();

        // Release A only
        vm.prank(operator);
        escrow.release(TASK_A, worker);

        (,, ProofworkEscrow.Status statusA) = escrow.escrows(TASK_A);
        (,, ProofworkEscrow.Status statusB) = escrow.escrows(TASK_B);

        assertEq(uint8(statusA), uint8(ProofworkEscrow.Status.Released), "A released");
        assertEq(uint8(statusB), uint8(ProofworkEscrow.Status.Funded),   "B still funded");

        // Release B
        vm.prank(operator);
        escrow.release(TASK_B, workerB);
        assertEq(usdc.balanceOf(workerB), MAX_REWARD, "workerB got MAX_REWARD");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 24. Fuzz: any valid (amount, deadline-offset) produces consistent state
    // ═══════════════════════════════════════════════════════════════════════════

    function testFuzz_Fund_ValidParams(uint256 amount, uint64 offset) public {
        // Bound to valid domain
        amount = bound(amount, 1, MAX_REWARD);
        offset = uint64(bound(offset, 1, 365 days));

        uint64 deadline = uint64(block.timestamp) + offset;

        // Make sure operator has enough
        usdc.mint(operator, amount);

        vm.prank(operator);
        escrow.fund(TASK_A, amount, deadline);

        (uint256 storedAmt, uint64 storedDl, ProofworkEscrow.Status status) = escrow.escrows(TASK_A);
        assertEq(storedAmt, amount,   "fuzz: amount stored");
        assertEq(storedDl,  deadline, "fuzz: deadline stored");
        assertEq(uint8(status), uint8(ProofworkEscrow.Status.Funded), "fuzz: status Funded");
        assertEq(usdc.balanceOf(address(escrow)), amount, "fuzz: escrow holds amount");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 25. Invariant: escrow USDC balance == sum of all Funded entries
    //     (Tested via a handler-driven invariant suite)
    // ═══════════════════════════════════════════════════════════════════════════
    //  See ProofworkEscrowInvariant below.
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handler for invariant testing
// ═══════════════════════════════════════════════════════════════════════════════

contract EscrowHandler is Test {
    ProofworkEscrow public escrow;
    MockERC20       public usdc;
    address         public operator;
    address         public worker;

    uint256 public ghostFundedTotal;   // sum of amounts currently in Funded state
    uint256 public taskCounter;

    bytes32[] public taskIds;

    constructor(ProofworkEscrow _escrow, MockERC20 _usdc, address _operator, address _worker) {
        escrow   = _escrow;
        usdc     = _usdc;
        operator = _operator;
        worker   = _worker;
    }

    function fund(uint256 amount, uint64 offset) external {
        amount = bound(amount, 1, escrow.maxReward());
        offset = uint64(bound(offset, 1, 30 days));

        bytes32 taskId = keccak256(abi.encodePacked("task", taskCounter++));
        taskIds.push(taskId);

        // Ensure operator has USDC
        usdc.mint(operator, amount);

        vm.prank(operator);
        escrow.fund(taskId, amount, uint64(block.timestamp) + offset);

        ghostFundedTotal += amount;
    }

    function release(uint256 seed) external {
        if (taskIds.length == 0) return;
        bytes32 taskId = taskIds[seed % taskIds.length];

        (uint256 amt,, ProofworkEscrow.Status status) = escrow.escrows(taskId);
        if (status != ProofworkEscrow.Status.Funded) return;

        vm.prank(operator);
        escrow.release(taskId, worker);

        ghostFundedTotal -= amt;
    }

    function refund(uint256 seed) external {
        if (taskIds.length == 0) return;
        bytes32 taskId = taskIds[seed % taskIds.length];

        (, uint64 dl, ProofworkEscrow.Status status) = escrow.escrows(taskId);
        if (status != ProofworkEscrow.Status.Funded) return;
        if (block.timestamp < dl) return;

        (uint256 amt,,) = escrow.escrows(taskId);

        vm.prank(operator);
        escrow.refund(taskId);

        ghostFundedTotal -= amt;
    }
}

contract ProofworkEscrowInvariantTest is Test {
    MockERC20        internal usdc;
    ProofworkEscrow  internal escrow;
    EscrowHandler    internal handler;

    address internal owner    = makeAddr("inv-owner");
    address internal operator = makeAddr("inv-operator");
    address internal worker   = makeAddr("inv-worker");

    function setUp() public {
        usdc     = new MockERC20("Mock USDC", "mUSDC", 6);
        escrow   = new ProofworkEscrow(address(usdc), operator, owner, 1_000_000);
        handler  = new EscrowHandler(escrow, usdc, operator, worker);

        // Pre-approve (handler mints fresh each call, but approval must be unlimited)
        vm.prank(operator);
        usdc.approve(address(escrow), type(uint256).max);

        targetContract(address(handler));
    }

    /// @notice The escrow's USDC balance must always equal the sum of all Funded amounts.
    function invariant_EscrowBalanceEqualsFundedTotal() public view {
        assertEq(
            usdc.balanceOf(address(escrow)),
            handler.ghostFundedTotal(),
            "invariant: escrow USDC balance != funded total"
        );
    }
}
