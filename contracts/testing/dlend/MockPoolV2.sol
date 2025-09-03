// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/interface/types/DataTypes.sol";

/**
 * @title MockPoolV2
 * @notice Enhanced mock pool for V2 adapter testing
 * @dev Extends the original MockPool with additional methods needed by V2 adapters
 */
contract MockPoolV2 {
    mapping(address => DataTypes.ReserveData) private _reserves;
    address[] private _reservesList;

    /**
     * @notice Set reserve data for an asset
     * @param asset The asset address
     * @param aToken The aToken address
     * @param stableDebtToken The stable debt token address
     * @param variableDebtToken The variable debt token address
     */
    function setReserveData(
        address asset,
        address aToken,
        address stableDebtToken,
        address variableDebtToken
    ) external {
        DataTypes.ReserveData memory d;
        d.aTokenAddress = aToken;
        d.stableDebtTokenAddress = stableDebtToken;
        d.variableDebtTokenAddress = variableDebtToken;
        _reserves[asset] = d;

        // Add to reserves list if not already present
        bool exists = false;
        for (uint256 i = 0; i < _reservesList.length; i++) {
            if (_reservesList[i] == asset) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            _reservesList.push(asset);
        }
    }

    /**
     * @notice Get reserve data for an asset
     * @param asset The asset address
     * @return The reserve data
     */
    function getReserveData(address asset) external view returns (DataTypes.ReserveData memory) {
        return _reserves[asset];
    }

    /**
     * @notice Get the list of all reserves
     * @dev This method is required by V2 adapter constructors for initial approvals
     * @return Array of reserve asset addresses
     */
    function getReservesList() external view returns (address[] memory) {
        return _reservesList;
    }

    /**
     * @notice Add a reserve to the list (for testing setup)
     * @param asset The asset to add
     */
    function addReserve(address asset) external {
        _reservesList.push(asset);
    }

    /**
     * @notice Clear all reserves (for test cleanup)
     */
    function clearReserves() external {
        delete _reservesList;
    }

    /**
     * @notice Mock supply function for adapter testing
     * @param asset The asset to supply
     * @param amount The amount to supply
     * @param onBehalfOf The address to supply on behalf of
     * @param referralCode The referral code
     */
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external pure {
        // Mock implementation - just emit an event or do nothing
        // In real pool, this would handle the supply logic
        // Silence unused parameter warnings
        asset;
        amount;
        onBehalfOf;
        referralCode;
    }

    /**
     * @notice Mock withdraw function for adapter testing
     * @param asset The asset to withdraw
     * @param amount The amount to withdraw
     * @param to The address to send withdrawn tokens to
     * @return The amount withdrawn
     */
    function withdraw(address asset, uint256 amount, address to) external pure returns (uint256) {
        // Mock implementation - silence unused parameter warnings
        asset;
        to;
        return amount;
    }

    /**
     * @notice Mock repay function for adapter testing
     * @param asset The asset to repay
     * @param amount The amount to repay
     * @param rateMode The rate mode (1 = stable, 2 = variable)
     * @param onBehalfOf The address to repay for
     * @return The amount repaid
     */
    function repay(
        address asset,
        uint256 amount,
        uint256 rateMode,
        address onBehalfOf
    ) external pure returns (uint256) {
        // Mock implementation - silence unused parameter warnings
        asset;
        rateMode;
        onBehalfOf;
        return amount;
    }

    /**
     * @notice Mock borrow function for adapter testing
     * @param asset The asset to borrow
     * @param amount The amount to borrow
     * @param rateMode The rate mode (1 = stable, 2 = variable)
     * @param referralCode The referral code
     * @param onBehalfOf The address to borrow for
     */
    function borrow(
        address asset,
        uint256 amount,
        uint256 rateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external pure {
        // Mock implementation - silence unused parameter warnings
        asset;
        amount;
        rateMode;
        referralCode;
        onBehalfOf;
    }

    /**
     * @notice Mock flash loan function for adapter testing
     * @param receiverAddress The flash loan receiver contract
     * @param assets Array of assets to flash loan
     * @param amounts Array of amounts to flash loan
     * @param interestRateModes Array of interest rate modes
     * @param onBehalfOf The address to take flash loan on behalf of
     * @param params Additional parameters
     * @param referralCode The referral code
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external pure {
        // Mock implementation - for pure logic testing, we don't execute actual flash loans
        // Silence unused parameter warnings
        receiverAddress;
        assets;
        amounts;
        interestRateModes;
        onBehalfOf;
        params;
        referralCode;
    }
}
