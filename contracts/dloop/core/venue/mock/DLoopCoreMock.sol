// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "../../DLoopCoreBase.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";

/**
 * @title DLoopCoreMock
 * @dev Simple mock implementation of DLoopCoreBase for testing
 */
contract DLoopCoreMock is DLoopCoreBase {
    // Mock state for prices and balances
    mapping(address => uint256) public mockPrices;
    mapping(address => uint256) public mockCollateral;
    mapping(address => uint256) public mockDebt;
    address public baseAsset;
    string public baseSymbol;

    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _underlyingAsset,
        ERC20 _dStable,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps
    ) DLoopCoreBase(
        _name,
        _symbol,
        _underlyingAsset,
        _dStable,
        _targetLeverageBps,
        _lowerBoundTargetLeverageBps,
        _upperBoundTargetLeverageBps,
        _maxSubsidyBps
    ) {
        baseAsset = address(0);
        baseSymbol = "USD";
    }

    // Allow setting mock prices for assets
    function setMockPrice(address asset, uint256 price) external {
        mockPrices[asset] = price;
    }

    // Allow setting mock collateral and debt for a user
    function setMockCollateral(address user, uint256 amount) external {
        mockCollateral[user] = amount;
    }
    function setMockDebt(address user, uint256 amount) external {
        mockDebt[user] = amount;
    }

    // --- Overrides ---
    function getAssetPriceFromOracle(address asset) public view override returns (uint256) {
        uint256 price = mockPrices[asset];
        require(price > 0, "Mock price not set");
        return price;
    }

    function _supplyToPool(address token, uint256 amount, address onBehalfOf) internal override {
        // Mimic: increase collateral for onBehalfOf, transfer token from contract (already in contract)
        mockCollateral[onBehalfOf] += amount;
        // In real, tokens are already in contract, so no transfer needed here
    }
    function _borrowFromPool(address token, uint256 amount, address onBehalfOf) internal override {
        // Mimic: increase debt for onBehalfOf, transfer token to onBehalfOf
        mockDebt[onBehalfOf] += amount;
        require(ERC20(token).balanceOf(address(this)) >= amount, "Mock: not enough tokens to borrow");
        ERC20(token).transfer(onBehalfOf, amount);
    }
    function _repayDebt(address token, uint256 amount, address onBehalfOf) internal override {
        // Mimic: decrease debt for onBehalfOf, transfer token from onBehalfOf to contract
        uint256 repayAmount = amount > mockDebt[onBehalfOf] ? mockDebt[onBehalfOf] : amount;
        mockDebt[onBehalfOf] -= repayAmount;
        require(ERC20(token).transferFrom(onBehalfOf, address(this), repayAmount), "Mock: repay transfer failed");
    }
    function _withdrawFromPool(address token, uint256 amount, address onBehalfOf) internal override {
        // Mimic: decrease collateral for onBehalfOf, transfer token to onBehalfOf
        uint256 withdrawAmount = amount > mockCollateral[onBehalfOf] ? mockCollateral[onBehalfOf] : amount;
        mockCollateral[onBehalfOf] -= withdrawAmount;
        require(ERC20(token).balanceOf(address(this)) >= withdrawAmount, "Mock: not enough tokens to withdraw");
        ERC20(token).transfer(onBehalfOf, withdrawAmount);
    }
    function _getBaseAssetAddressAndSymbol() internal view override returns (address, string memory) {
        return (baseAsset, baseSymbol);
    }
    function _getTotalCollateralAndDebtOfUserInBase(address user)
        internal
        view
        override
        returns (uint256 totalCollateralBase, uint256 totalDebtBase)
    {
        return (mockCollateral[user], mockDebt[user]);
    }

    // --- Test-only public wrappers for internal pool logic ---
    function testSupplyToPool(address token, uint256 amount, address onBehalfOf) external {
        _supplyToPool(token, amount, onBehalfOf);
    }
    function testBorrowFromPool(address token, uint256 amount, address onBehalfOf) external {
        _borrowFromPool(token, amount, onBehalfOf);
    }
    function testRepayDebt(address token, uint256 amount, address onBehalfOf) external {
        _repayDebt(token, amount, onBehalfOf);
    }
    function testWithdrawFromPool(address token, uint256 amount, address onBehalfOf) external {
        _withdrawFromPool(token, amount, onBehalfOf);
    }
}
