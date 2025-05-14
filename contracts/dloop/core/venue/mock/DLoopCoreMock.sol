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

    function _supplyToPool(address, uint256, address) internal override {
        // No-op for mock
    }
    function _borrowFromPool(address, uint256, address) internal override {
        // No-op for mock
    }
    function _repayDebt(address, uint256, address) internal override {
        // No-op for mock
    }
    function _withdrawFromPool(address, uint256, address) internal override {
        // No-op for mock
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
}
