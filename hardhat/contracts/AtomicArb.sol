// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AtomicArb
 * @notice Minimal helper contract for atomic two-leg arbitrage execution.
 *
 * Executes two sequential external calls (e.g., swap on DEX A then DEX B)
 * and reverts if the final balance of `profitToken` does not exceed the
 * initial balance plus `minProfit`.
 *
 * SECURITY:
 *   - Only the owner (deployer) can call `executeArb`.
 *   - No flash loans — relies on the caller having pre-approved tokens.
 *   - Reverts atomically if profit is not achieved.
 *
 * USAGE:
 *   1. Deploy this contract.
 *   2. Approve token spending from this contract's address.
 *   3. Call executeArb with the two swap calldatas.
 *
 * NOTE:
 *   This is a minimal reference implementation.
 *   For production, add reentrancy protection, access control,
 *   and consider using flash swaps instead of pre-approved tokens.
 */
contract AtomicArb is Ownable {
    event ArbExecuted(address indexed profitToken, uint256 profit);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event WithdrawnNative(uint256 amount, address indexed to);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Execute two swaps atomically.
     * @param target1   Address of DEX router / vault for first swap.
     * @param data1     Calldata for first swap.
     * @param target2   Address of DEX router / vault for second swap.
     * @param data2     Calldata for second swap.
     * @param profitToken  ERC20 token to measure profit in.
     * @param minProfit Minimum required net gain (in profitToken raw units).
     *                  Set to 0 to skip profit check (not recommended).
     */
    function executeArb(
        address target1,
        bytes calldata data1,
        address target2,
        bytes calldata data2,
        address profitToken,
        uint256 minProfit
    ) external onlyOwner {
        uint256 balanceBefore = IERC20(profitToken).balanceOf(address(this));

        // Execute first swap
        (bool ok1, bytes memory err1) = target1.call(data1);
        require(ok1, string(abi.encodePacked("Swap1 failed: ", err1)));

        // Execute second swap
        (bool ok2, bytes memory err2) = target2.call(data2);
        require(ok2, string(abi.encodePacked("Swap2 failed: ", err2)));

        uint256 balanceAfter = IERC20(profitToken).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + minProfit,
            "AtomicArb: insufficient profit"
        );
        emit ArbExecuted(profitToken, balanceAfter - balanceBefore);
    }

    /**
     * @notice Withdraw tokens from the contract (owner only).
     * @dev Used to recover profits accumulated in the contract.
     */
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).transfer(to, amount);
        emit Withdrawn(token, amount, to);
    }

    /**
     * @notice Withdraw native token (owner only).
     */
    function withdrawNative(address payable to) external onlyOwner {
        uint256 amount = address(this).balance;
        to.transfer(amount);
        emit WithdrawnNative(amount, to);
    }

    receive() external payable {}
}
