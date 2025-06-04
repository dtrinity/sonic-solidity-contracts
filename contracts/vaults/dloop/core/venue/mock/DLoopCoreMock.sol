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
    mapping(address => uint256) private mockPoolBalances; // token => amount (tracked separately from real balances)
    address public mockPool;

    uint8 public constant PRICE_DECIMALS = 8;
    uint256 public constant PERCENTAGE_FACTOR = 1e4;
    uint256 public constant LIQUIDATION_THRESHOLD = 8500; // 85% in basis points

    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _collateralToken,
        ERC20 _debtToken,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        address _mockPool
    )
        DLoopCoreBase(
            _name,
            _symbol,
            _collateralToken,
            _debtToken,
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

    // Allow setting mock pool balances
    function setMockPoolBalance(address token, uint256 amount) external {
        mockPoolBalances[token] = amount;
    }

    function getMockPoolBalance(address token) external view returns (uint256) {
        return mockPoolBalances[token];
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
        if (mockCollateral[user][token] == 0 && amount > 0) {
            mockCollateralTokens[user].push(token);
        }
        mockCollateral[user][token] = amount;

        // Remove token from array if amount becomes 0
        if (amount == 0) {
            for (uint256 i = 0; i < mockCollateralTokens[user].length; i++) {
                if (mockCollateralTokens[user][i] == token) {
                    // Replace with last element and pop
                    mockCollateralTokens[user][i] = mockCollateralTokens[user][
                        mockCollateralTokens[user].length - 1
                    ];
                    mockCollateralTokens[user].pop();
                    break;
                }
            }
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
        if (mockDebt[user][token] == 0 && amount > 0) {
            mockDebtTokens[user].push(token);
        }
        mockDebt[user][token] = amount;

        // Remove token from array if amount becomes 0
        if (amount == 0) {
            for (uint256 i = 0; i < mockDebtTokens[user].length; i++) {
                if (mockDebtTokens[user][i] == token) {
                    // Replace with last element and pop
                    mockDebtTokens[user][i] = mockDebtTokens[user][
                        mockDebtTokens[user].length - 1
                    ];
                    mockDebtTokens[user].pop();
                    break;
                }
            }
        }
    }

    // --- Overrides ---

    /**
     * @inheritdoc DLoopCoreBase
     * @return address[] Additional rescue tokens
     */
    function _getAdditionalRescueTokensImplementation()
        internal
        pure
        override
        returns (address[] memory)
    {
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

        if (token == address(debtToken)) {
            revert("Mock: debtToken is not supported as collateral");
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
        // Check mock pool balance (separate from real token balance)
        require(
            mockPoolBalances[token] >= amount,
            "Mock: not enough tokens in pool to borrow"
        );

        // Transfer from vault to user (simulating pool lending)
        require(
            ERC20(token).transfer(onBehalfOf, amount),
            "Mock: borrow transfer failed"
        );

        // Decrease mock pool balance to simulate pool lending
        mockPoolBalances[token] -= amount;

        // Set debt after successful transfer
        _setMockDebt(onBehalfOf, token, mockDebt[onBehalfOf][token] + amount);
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

        if (token == address(debtToken)) {
            revert("Mock: debtToken is not supported as collateral");
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
        // Transfer from vault (this contract) to onBehalfOf, simulating pool behavior
        require(
            ERC20(token).transfer(onBehalfOf, amount),
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
            require(price > 0, "Mock price not set");
            uint256 amount = mockCollateral[user][token];
            uint256 assetTokenUnit = 10 ** ERC20(token).decimals();
            uint256 amountInBase = (amount * price) / assetTokenUnit;

            totalCollateralBase += amountInBase;
        }
        for (uint256 i = 0; i < mockDebtTokens[user].length; i++) {
            address token = mockDebtTokens[user][i];

            // Convert debt to base unit
            uint256 price = mockPrices[token];
            require(price > 0, "Mock price not set");
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

    // --- Additional Test Wrappers for Internal Methods ---

    /**
     * @dev Test wrapper for _getAdditionalRescueTokensImplementation
     */
    function testGetAdditionalRescueTokens()
        external
        pure
        returns (address[] memory)
    {
        return _getAdditionalRescueTokensImplementation();
    }

    /**
     * @dev Test wrapper for _getAssetPriceFromOracleImplementation
     */
    function testGetAssetPriceFromOracle(
        address asset
    ) external view returns (uint256) {
        return _getAssetPriceFromOracleImplementation(asset);
    }

    /**
     * @dev Test wrapper for _supplyToPoolImplementation
     */
    function testSupplyToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _supplyToPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _borrowFromPoolImplementation
     */
    function testBorrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _borrowFromPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _repayDebtToPoolImplementation
     */
    function testRepayDebtToPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _repayDebtToPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _withdrawFromPoolImplementation
     */
    function testWithdrawFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) external {
        _withdrawFromPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for convertFromBaseCurrencyToToken
     */
    function testConvertFromBaseCurrencyToToken(
        uint256 amountInBase,
        address token
    ) external view returns (uint256) {
        return convertFromBaseCurrencyToToken(amountInBase, token);
    }

    /**
     * @dev Test wrapper for convertFromTokenAmountToBaseCurrency
     */
    function testConvertFromTokenAmountToBaseCurrency(
        uint256 amountInToken,
        address token
    ) external view returns (uint256) {
        return convertFromTokenAmountToBaseCurrency(amountInToken, token);
    }

    /**
     * @dev Test wrapper for getBorrowAmountThatKeepCurrentLeverage
     */
    function testGetBorrowAmountThatKeepCurrentLeverage(
        address collateralAsset,
        address debtAsset,
        uint256 suppliedCollateralAmount,
        uint256 leverageBpsBeforeSupply
    ) external view returns (uint256) {
        return
            getBorrowAmountThatKeepCurrentLeverage(
                collateralAsset,
                debtAsset,
                suppliedCollateralAmount,
                leverageBpsBeforeSupply
            );
    }

    /**
     * @dev Test wrapper for getRepayAmountThatKeepCurrentLeverage
     */
    function testGetRepayAmountThatKeepCurrentLeverage(
        address collateralAsset,
        address debtAsset,
        uint256 targetWithdrawAmount,
        uint256 leverageBpsBeforeRepayDebt
    ) external view returns (uint256) {
        return
            getRepayAmountThatKeepCurrentLeverage(
                collateralAsset,
                debtAsset,
                targetWithdrawAmount,
                leverageBpsBeforeRepayDebt
            );
    }

    /**
     * @dev Test wrapper for getAmountToReachTargetLeverage
     */
    function testGetAmountToReachTargetLeverage(
        bool useVaultTokenBalance
    ) external view returns (uint256 tokenAmount, int8 direction) {
        return getAmountToReachTargetLeverage(useVaultTokenBalance);
    }

    /**
     * @dev Test wrapper for isTooImbalanced
     */
    function testIsTooImbalanced() external view returns (bool) {
        return isTooImbalanced();
    }

    /**
     * @dev Test wrapper for getLeveragedAssets
     */
    function testGetLeveragedAssets(
        uint256 assets
    ) external view returns (uint256) {
        return getLeveragedAssets(assets);
    }

    /**
     * @dev Test wrapper for getRestrictedRescueTokens
     */
    function testGetRestrictedRescueTokens()
        external
        view
        returns (address[] memory)
    {
        return getRestrictedRescueTokens();
    }

    // --- Mock State Getters for Testing ---

    /**
     * @dev Get mock collateral for a user and token
     */
    function getMockCollateral(
        address user,
        address token
    ) external view returns (uint256) {
        return mockCollateral[user][token];
    }

    /**
     * @dev Get mock debt for a user and token
     */
    function getMockDebt(
        address user,
        address token
    ) external view returns (uint256) {
        return mockDebt[user][token];
    }

    /**
     * @dev Get all collateral tokens for a user
     */
    function getMockCollateralTokens(
        address user
    ) external view returns (address[] memory) {
        return mockCollateralTokens[user];
    }

    /**
     * @dev Get all debt tokens for a user
     */
    function getMockDebtTokens(
        address user
    ) external view returns (address[] memory) {
        return mockDebtTokens[user];
    }

    /**
     * @dev Get mock price for an asset
     */
    function getMockPrice(address asset) external view returns (uint256) {
        return mockPrices[asset];
    }
}
