// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../dlend/periphery/adapters/odos/BaseOdosBuyAdapterV2.sol";
import "../../dlend/periphery/adapters/odos/BaseOdosSellAdapterV2.sol";
import "../../dlend/core/protocol/libraries/types/DataTypes.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BaseOdosAdapterV2Harness
 * @notice Test harness to expose BaseOdosAdapterV2 internal functions for testing
 * @dev Uses only the buy adapter to avoid multiple inheritance conflicts
 */
contract BaseOdosAdapterV2Harness is BaseOdosBuyAdapterV2 {
    constructor(
        IPoolAddressesProvider addressesProvider,
        address pool,
        IOdosRouterV2 _odosRouter,
        address _pendleRouter
    ) BaseOdosBuyAdapterV2(addressesProvider, pool, _odosRouter, _pendleRouter) {}

    /// @notice Expose oracle price validation function (exact output)
    function validateOraclePriceExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        uint256 exactAmountOut
    ) external view {
        _validateOraclePriceExactOutput(tokenIn, tokenOut, maxAmountIn, exactAmountOut);
    }

    // Note: validateOraclePrice is from sell adapter, not available in this harness

    /// @notice Expose executeAdaptiveBuy function
    function executeAdaptiveBuy(
        IERC20Detailed assetToSwapFrom,
        IERC20Detailed assetToSwapTo,
        uint256 maxAmountToSwap,
        uint256 amountToReceive,
        bytes memory swapData
    ) external returns (uint256) {
        return _executeAdaptiveBuy(assetToSwapFrom, assetToSwapTo, maxAmountToSwap, amountToReceive, swapData);
    }

    // Note: executeAdaptiveSwap is from sell adapter, not available in this harness

    /// @notice Expose executeDirectOdosExactOutput function
    function executeDirectOdosExactOutput(
        address inputToken,
        address outputToken,
        uint256 maxInputAmount,
        uint256 exactOutputAmount,
        bytes memory swapData
    ) external returns (uint256) {
        return _executeDirectOdosExactOutput(inputToken, outputToken, maxInputAmount, exactOutputAmount, swapData);
    }

    // Note: executeDirectOdosExactInput is from sell adapter, not available in this harness

    /// @notice Implementation of _getReserveData for testing
    function _getReserveData(address asset) internal pure override returns (address, address, address) {
        // For testing, we'll use mock data - in real scenarios this would query the pool
        return (
            address(uint160(uint256(keccak256(abi.encodePacked(asset, "vToken"))))), // mock vToken
            address(uint160(uint256(keccak256(abi.encodePacked(asset, "sToken"))))), // mock sToken
            address(uint160(uint256(keccak256(abi.encodePacked(asset, "aToken"))))) // mock aToken
        );
    }

    /// @notice Implementation of _supply for testing
    function _supply(address asset, uint256 amount, address to, uint16 referralCode) internal override {
        // Mock implementation - for testing we just emit an event
        emit MockSupplyCalled(asset, amount, to, referralCode);
    }

    /// @notice Event for testing _supply calls
    event MockSupplyCalled(address asset, uint256 amount, address to, uint16 referralCode);

    /// @notice Helper function to get token balance
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Helper function to mint tokens to this contract (for testing)
    function mintTokens(address token, uint256 amount) external {
        // Only works with TestMintableERC20 contracts
        (bool success, ) = token.call(abi.encodeWithSignature("mint(address,uint256)", address(this), amount));
        require(success, "Mint failed");
    }
}
