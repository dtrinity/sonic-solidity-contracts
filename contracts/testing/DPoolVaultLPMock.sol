// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../vaults/dpool/core/DPoolVaultLP.sol";

/**
 * @title DPoolVaultLPMock
 * @notice Minimal concrete implementation of DPoolVaultLP used exclusively for unit testing.
 *         It implements the abstract functions with simple stubs so that the core logic in
 *         DPoolVaultLP can be exercised without external dependencies (e.g., Curve pools).
 */
contract DPoolVaultLPMock is DPoolVaultLP {
    /// @dev Dummy pool address, not used in tests
    address private immutable _pool;

    constructor(
        address lpToken
    ) DPoolVaultLP(lpToken, "Mock DPool Vault", "mDPVL", msg.sender) {
        _pool = address(0);
    }

    // --- Abstract overrides ---

    function pool() external view override returns (address) {
        return _pool;
    }

    function previewLPValue(
        uint256 lpAmount
    ) external view override returns (uint256) {
        // For testing purposes we simply return the same amount.
        return lpAmount;
    }
}
