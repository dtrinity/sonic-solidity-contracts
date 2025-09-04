// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockPTToken
 * @notice Mock PT (Principal Token) for testing Pendle integrations
 * @dev This contract mimics the PT token interface expected by Pendle logic
 */
contract MockPTToken is ERC20 {
    /// @notice The SY (Standardized Yield) token address associated with this PT token
    address public syToken;

    /// @notice Flag to control whether SY() calls should revert
    bool public shouldRevertSYCall;

    /// @notice Constructor
    /// @param name Token name
    /// @param symbol Token symbol
    /// @param _sy The SY token address
    constructor(string memory name, string memory symbol, address _sy) ERC20(name, symbol) {
        syToken = _sy;
    }

    /**
     * @notice Mint tokens to an address (for testing)
     * @param to Address to mint to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from an address (for testing)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    /**
     * @notice Set the SY address (for testing different scenarios)
     * @param _sy New SY address
     */
    function setSY(address _sy) external {
        syToken = _sy;
    }

    /**
     * @notice Configure whether SY() calls should revert (for negative testing)
     * @param _shouldRevert Whether to revert SY() calls
     */
    function setShouldRevertSYCall(bool _shouldRevert) external {
        shouldRevertSYCall = _shouldRevert;
    }

    /**
     * @notice Return the SY token address (PT token interface requirement)
     * @dev This is the method that PendleSwapLogic uses to detect PT tokens
     * @return The SY token address
     */
    function SY() external view returns (address) {
        require(!shouldRevertSYCall, "MockPTToken: SY call reverted");
        return syToken;
    }
}
