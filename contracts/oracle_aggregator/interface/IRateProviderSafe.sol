// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRateProviderSafe
 * @notice Optional extension for rate providers that exposes a safe view which reverts when the provider is paused
 */
interface IRateProviderSafe {
    function getRateSafe() external view returns (uint256);
}


