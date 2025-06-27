// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "contracts/vaults/dloop/core/DLoopCoreBase.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IMintableERC20} from "contracts/common/IMintableERC20.sol";

/**
 * @title DLoopCoreBorrowLessMock
 * @dev A minimal concrete implementation of DLoopCoreBase purposely engineered so that
 *      its `borrow` implementation gives the vault exactly 1 wei less than requested.
 *      This allows unit-testing the DoS condition described in HATS issue #233.
 */
contract DLoopCoreBorrowLessMock is DLoopCoreBase {
    // Simple in-memory price feed (8 decimals) for testing purposes
    mapping(address => uint256) internal _mockPrices;

    constructor(
        string memory name_,
        string memory symbol_,
        ERC20 collateralToken_,
        ERC20 debtToken_,
        uint32 targetLeverageBps_,
        uint32 lowerBoundTargetLeverageBps_,
        uint32 upperBoundTargetLeverageBps_,
        uint256 maxSubsidyBps_
    )
        DLoopCoreBase(
            name_,
            symbol_,
            collateralToken_,
            debtToken_,
            targetLeverageBps_,
            lowerBoundTargetLeverageBps_,
            upperBoundTargetLeverageBps_,
            maxSubsidyBps_
        )
    {
        // default every asset price to 1e8 (i.e. $1 with 8 decimals) so math works out of the box
        _mockPrices[address(collateralToken_)] = 1e8;
        _mockPrices[address(debtToken_)] = 1e8;
    }

    /* --------------------------------------------------------------------- */
    /*                              Test helpers                             */
    /* --------------------------------------------------------------------- */

    function setMockPrice(address asset, uint256 price) external {
        _mockPrices[asset] = price;
    }

    /* --------------------------------------------------------------------- */
    /*                     DLoopCoreBase virtual overrides                    */
    /* --------------------------------------------------------------------- */

    // No extra rescue tokens
    function _getAdditionalRescueTokensImplementation()
        internal
        pure
        override
        returns (address[] memory)
    {
        return new address[](0);
    }

    // Simple price oracle (returns set price or reverts if not set)
    function _getAssetPriceFromOracleImplementation(
        address asset
    ) internal view override returns (uint256) {
        uint256 price = _mockPrices[asset];
        require(price > 0, "Mock price not set");
        return price;
    }

    // Simulate supplying to a pool by burning/moving tokens out of the vault
    function _supplyToPoolImplementation(
        address token,
        uint256 amount,
        address /* onBehalfOf */
    ) internal override {
        // Transfer the exact amount out of the vault so the wrapper logic observes the
        // expected balance decrease.
        ERC20(token).transfer(address(0xdead), amount);
    }

    // Borrow _amount - 1 wei to trigger the rounding-tolerance path
    function _borrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal override {
        require(amount > 1, "Test requires amount > 1 wei");
        uint256 shortfallAmount = amount - 1;
        IMintableERC20(token).mint(onBehalfOf, shortfallAmount);
    }

    // Not needed for this specific test, keep empty implementations
    function _repayDebtToPoolImplementation(
        address /* token */,
        uint256 /* amount */,
        address /* onBehalfOf */
    ) internal override {}

    function _withdrawFromPoolImplementation(
        address /* token */,
        uint256 /* amount */,
        address /* onBehalfOf */
    ) internal override {}

    // Very simple collateral/debt tracking – zeroed for the test scenario
    function getTotalCollateralAndDebtOfUserInBase(
        address /* user */
    )
        public
        view
        override
        returns (uint256 totalCollateralBase, uint256 totalDebtBase)
    {
        return (0, 0);
    }
}
