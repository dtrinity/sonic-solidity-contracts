// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {DLoopCoreBase} from "../../DLoopCoreBase.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BasisPointConstants} from "contracts/common/BasisPointConstants.sol";
import {PercentageMath} from "contracts/dlend/core/protocol/libraries/math/PercentageMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
/**
 * @title DLoopCoreMock
 * @dev Simple mock implementation of DLoopCoreBase for testing
 */
contract DLoopCoreMock is DLoopCoreBase {
    // Mock state for prices and balances
    mapping(address => uint256) public mockPrices;
    mapping(address => mapping(address => uint256)) private mockCollateral; // user => token => amount
    mapping(address => address[]) private mockCollateralTokens; // user => tokens
    mapping(address => mapping(address => uint256)) private mockDebt; // user => token => amount
    mapping(address => address[]) private mockDebtTokens; // user => tokens
    address public mockPool;

    uint8 public constant PRICE_DECIMALS = 8;
    uint256 public constant PERCENTAGE_FACTOR = 1e4;
    uint256 public constant LIQUIDATION_THRESHOLD = 8500; // 85% in basis points

    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _underlyingAsset,
        ERC20 _dStable,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        address _mockPool
    )
        DLoopCoreBase(
            _name,
            _symbol,
            _underlyingAsset,
            _dStable,
            _targetLeverageBps,
            _lowerBoundTargetLeverageBps,
            _upperBoundTargetLeverageBps,
            _maxSubsidyBps
        )
    {
        mockPool = _mockPool;
    }

    // Allow setting mock prices for assets
    function setMockPrice(address asset, uint256 price) external {
        mockPrices[asset] = price;
    }

    // Allow setting mock collateral and debt for a user
    function setMockCollateral(
        address user,
        address token,
        uint256 amount
    ) external {
        _setMockCollateral(user, token, amount);
    }
    function _setMockCollateral(
        address user,
        address token,
        uint256 amount
    ) internal {
        if (mockCollateral[user][token] == 0) {
            mockCollateralTokens[user].push(token);
        }
        mockCollateral[user][token] = amount;

        // If new collateral is less than debt, revert
        (
            uint256 totalCollateralInBase,
            uint256 totalDebtInBase
        ) = getTotalCollateralAndDebtOfUserInBase(user);
        if (totalCollateralInBase < totalDebtInBase) {
            revert("Mock: collateral is less than debt");
        }
    }

    function setMockDebt(address user, address token, uint256 amount) external {
        _setMockDebt(user, token, amount);
    }
    function _setMockDebt(
        address user,
        address token,
        uint256 amount
    ) internal {
        if (mockDebt[user][token] == 0) {
            mockDebtTokens[user].push(token);
        }
        mockDebt[user][token] = amount;

        // If new debt is greater than collateral, revert
        (
            uint256 totalCollateralInBase,
            uint256 totalDebtInBase
        ) = getTotalCollateralAndDebtOfUserInBase(user);
        if (totalCollateralInBase < totalDebtInBase) {
            revert("Mock: collateral is less than debt");
        }
    }

    // --- Overrides ---

    function getRestrictedRescueTokens() public pure override returns (address[] memory) {
        return new address[](0);
    }

    function _getAssetPriceFromOracleImplementation(
        address asset
    ) internal view override returns (uint256) {
        uint256 price = mockPrices[asset];
        require(price > 0, "Mock price not set");
        return price;
    }

    function _supplyToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal override {
        // Mimic: increase collateral for onBehalfOf, transfer token to pool

        if (token == address(dStable)) {
            revert("Mock: dStable is not supported as collateral");
        }

        _setMockCollateral(
            onBehalfOf,
            token,
            mockCollateral[onBehalfOf][token] + amount
        );
        require(
            ERC20(token).transfer(mockPool, amount),
            "Mock: transfer to pool failed"
        );
    }

    function _borrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal override {
        // Mimic: increase debt for onBehalfOf, transfer token from pool to onBehalfOf
        _setMockDebt(onBehalfOf, token, mockDebt[onBehalfOf][token] + amount);
        require(
            ERC20(token).balanceOf(mockPool) >= amount,
            "Mock: not enough tokens in pool to borrow"
        );
        require(
            ERC20(token).transferFrom(mockPool, onBehalfOf, amount),
            "Mock: borrow transfer failed"
        );
    }

    function _repayDebtToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal override {
        // Mimic: decrease debt for onBehalfOf, transfer token from onBehalfOf to pool
        if (mockDebt[onBehalfOf][token] < amount) {
            revert("Mock: repay exceeds debt");
        }

        _setMockDebt(onBehalfOf, token, mockDebt[onBehalfOf][token] - amount);
        require(
            ERC20(token).transferFrom(onBehalfOf, mockPool, amount),
            "Mock: repay transfer failed"
        );
    }

    function _withdrawFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal override {
        // Mimic: decrease collateral for onBehalfOf, transfer token from pool to onBehalfOf

        if (token == address(dStable)) {
            revert("Mock: dStable is not supported as collateral");
        }
        if (mockCollateral[onBehalfOf][token] < amount) {
            revert("Mock: not enough collateral to withdraw");
        }

        _setMockCollateral(
            onBehalfOf,
            token,
            mockCollateral[onBehalfOf][token] - amount
        );
        require(
            ERC20(token).balanceOf(mockPool) >= amount,
            "Mock: not enough tokens in pool to withdraw"
        );
        require(
            ERC20(token).transferFrom(mockPool, onBehalfOf, amount),
            "Mock: withdraw transfer failed"
        );
    }

    function getTotalCollateralAndDebtOfUserInBase(
        address user
    )
        public
        view
        override
        returns (uint256 totalCollateralBase, uint256 totalDebtBase)
    {
        totalCollateralBase = 0;
        totalDebtBase = 0;

        // Calculate total collateral in base unit (from mockCollateral)
        // Get all users' tokens from mockCollateral[user]
        for (uint256 i = 0; i < mockCollateralTokens[user].length; i++) {
            address token = mockCollateralTokens[user][i];

            // Convert collateral to base unit
            uint256 price = mockPrices[token];
            uint256 amount = mockCollateral[user][token];
            uint256 assetTokenUnit = 10 ** ERC20(token).decimals();
            uint256 amountInBase = (amount * price) / assetTokenUnit;

            totalCollateralBase += amountInBase;
        }
        for (uint256 i = 0; i < mockDebtTokens[user].length; i++) {
            address token = mockDebtTokens[user][i];

            // Convert debt to base unit
            uint256 price = mockPrices[token];
            uint256 amount = mockDebt[user][token];
            uint256 assetTokenUnit = 10 ** ERC20(token).decimals();
            uint256 amountInBase = (amount * price) / assetTokenUnit;

            totalDebtBase += amountInBase;
        }
        return (totalCollateralBase, totalDebtBase);
    }

    // --- Test-only public wrappers for internal pool logic ---
    function testSupplyToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        require(
            ERC20(token).transferFrom(onBehalfOf, address(this), amount),
            "Mock: transferFrom failed"
        );
        _supplyToPool(token, amount, onBehalfOf);
    }
    function testBorrowFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _borrowFromPool(token, amount, onBehalfOf);
    }
    function testRepayDebtToPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _repayDebtToPool(token, amount, onBehalfOf);
    }
    function testWithdrawFromPool(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _withdrawFromPool(token, amount, onBehalfOf);
    }
}
