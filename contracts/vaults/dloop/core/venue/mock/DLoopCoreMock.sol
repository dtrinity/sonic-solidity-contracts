// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { DLoopCoreBase } from "../../DLoopCoreBase.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { PercentageMath } from "contracts/dlend/core/protocol/libraries/math/PercentageMath.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { DLoopCoreLogic } from "../../DLoopCoreLogic.sol";
import { RescuableVault } from "contracts/vaults/dloop/shared/RescuableVault.sol";

/**
 * @title DLoopCoreMock
 * @dev Simple mock implementation of DLoopCoreBase for testing
 */
contract DLoopCoreMock is DLoopCoreBase, RescuableVault {
    // Errors
    error NotEnoughBalanceToSupply(address user, string tokenSymbol, uint256 balance, uint256 amount);
    error MockPriceNotSet(address asset);

    // Mock state for prices and balances
    mapping(address => uint256) public mockPrices;
    mapping(address => mapping(address => uint256)) private mockCollateral; // user => token => amount
    mapping(address => address[]) private mockCollateralTokens; // user => tokens
    mapping(address => mapping(address => uint256)) private mockDebt; // user => token => amount
    mapping(address => address[]) private mockDebtTokens; // user => tokens
    address public mockPool;

    // Mock state for additional rescue tokens
    address[] private mockAdditionalRescueTokens;

    // This is used to test the supply, borrow, repay, withdraw wrapper validation
    uint256 public transferPortionBps;

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
        uint256 _minDeviationBps,
        uint256 _withdrawalFeeBps,
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
            _maxSubsidyBps,
            _minDeviationBps,
            _withdrawalFeeBps
        )
    {
        mockPool = _mockPool;

        // Require large allowance from mockPool to this contract as this mock contract will
        // transfer tokens to mockPool when supply, repay. It will take the token from mockPool
        // and send back to the contract when withdraw, borrow.
        // Set transfer portion bps to 100% as it is the default value
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;
    }

    // Allow setting transfer portion bps for testing
    function setTransferPortionBps(uint256 _transferPortionBps) external {
        require(
            _transferPortionBps <= BasisPointConstants.ONE_HUNDRED_PERCENT_BPS,
            "Mock: transferPortionBps must be at most 100%"
        );
        transferPortionBps = _transferPortionBps;
    }

    // Allow setting mock prices for assets
    function setMockPrice(address asset, uint256 price) external {
        mockPrices[asset] = price;
    }

    // Allow setting mock collateral and debt for a user
    function setMockCollateral(address user, address token, uint256 amount) external {
        _setMockCollateral(user, token, amount);
    }

    function _setMockCollateral(address user, address token, uint256 amount) internal {
        if (mockCollateral[user][token] == 0 && amount > 0) {
            mockCollateralTokens[user].push(token);
        }
        mockCollateral[user][token] = amount;

        // Remove token from array if amount becomes 0
        if (amount == 0) {
            for (uint256 i = 0; i < mockCollateralTokens[user].length; i++) {
                if (mockCollateralTokens[user][i] == token) {
                    // Replace with last element and pop
                    mockCollateralTokens[user][i] = mockCollateralTokens[user][mockCollateralTokens[user].length - 1];
                    mockCollateralTokens[user].pop();
                    break;
                }
            }
        }
    }

    function setMockDebt(address user, address token, uint256 amount) external {
        _setMockDebt(user, token, amount);
    }

    function _setMockDebt(address user, address token, uint256 amount) internal {
        if (mockDebt[user][token] == 0 && amount > 0) {
            mockDebtTokens[user].push(token);
        }
        mockDebt[user][token] = amount;

        // Remove token from array if amount becomes 0
        if (amount == 0) {
            for (uint256 i = 0; i < mockDebtTokens[user].length; i++) {
                if (mockDebtTokens[user][i] == token) {
                    // Replace with last element and pop
                    mockDebtTokens[user][i] = mockDebtTokens[user][mockDebtTokens[user].length - 1];
                    mockDebtTokens[user].pop();
                    break;
                }
            }
        }
    }

    // Check all required allowances for mockPool to this contract
    // so that the vault can spend tokens from mockPool
    function _checkRequiredAllowance() internal view {
        require(
            ERC20(collateralToken).allowance(mockPool, address(this)) >= type(uint256).max / 2,
            "Mock: mockPool does not have allowance for this contract for collateralToken"
        );
        require(
            ERC20(debtToken).allowance(mockPool, address(this)) >= type(uint256).max / 2,
            "Mock: mockPool does not have allowance for this contract for debtToken"
        );
    }

    // --- Overrides ---

    /**
     * @dev Do not rescue the mock additional rescue tokens
     *      - Implement this method from RescuableVault
     * @param token Address of the token to check
     * @return bool True if the token is a restricted rescue token, false otherwise
     */
    function isRescuableToken(address token) public view override returns (bool) {
        for (uint256 i = 0; i < mockAdditionalRescueTokens.length; i++) {
            if (token == mockAdditionalRescueTokens[i]) {
                return true;
            }
        }
        return false;
    }

    function _getAssetPriceFromOracleImplementation(address asset) internal view override returns (uint256) {
        uint256 price = mockPrices[asset];
        if (price == 0) revert MockPriceNotSet(asset);
        return price;
    }

    function _supplyToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        _checkRequiredAllowance();

        // Calculate the amount to supply based on transfer portion bps
        amount = (amount * transferPortionBps) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Make sure target user has enough balance to supply
        if (ERC20(token).balanceOf(onBehalfOf) < amount) {
            string memory tokenSymbol = ERC20(token).symbol();
            revert NotEnoughBalanceToSupply(onBehalfOf, tokenSymbol, ERC20(token).balanceOf(onBehalfOf), amount);
        }

        if (amount > 0) {
            // Switch between transfer and transferFrom based on the onBehalfOf
            if (onBehalfOf == address(this)) {
                // If the onBehalfOf is the vault itself, use transfer
                require(
                    ERC20(token).transfer(mockPool, amount),
                    "Mock: supply transfer failed (onBehalfOf is the vault itself)"
                );
            } else {
                // Transfer from target user to mockPool
                require(ERC20(token).transferFrom(onBehalfOf, mockPool, amount), "Mock: supply transfer failed");
            }
        }

        // Reset transfer portion bps to 100%
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Increase collateral after successful transfer
        _setMockCollateral(onBehalfOf, token, mockCollateral[onBehalfOf][token] + amount);
    }

    function _borrowFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual override {
        _checkRequiredAllowance();

        // Calculate the amount to borrow based on transfer portion bps
        amount = (amount * transferPortionBps) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Make sure having mockPool having enough balance to borrow
        require(ERC20(token).balanceOf(mockPool) >= amount, "Mock: not enough tokens in pool to borrow");

        if (amount > 0) {
            // Transfer from mockPool to target user
            require(ERC20(token).transferFrom(mockPool, onBehalfOf, amount), "Mock: borrow transfer failed");
        }

        // Reset transfer portion bps to 100%
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Increase debt after successful transfer
        _setMockDebt(onBehalfOf, token, mockDebt[onBehalfOf][token] + amount);
    }

    function _repayDebtToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        _checkRequiredAllowance();

        // Calculate the amount to repay based on transfer portion bps
        amount = (amount * transferPortionBps) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Make sure target user has enough debt to repay
        require(ERC20(token).balanceOf(onBehalfOf) >= amount, "Mock: not enough balance to repay");

        if (amount > 0) {
            // Switch between transfer and transferFrom based on the onBehalfOf
            if (onBehalfOf == address(this)) {
                // If the onBehalfOf is the vault itself, use transfer
                require(
                    ERC20(token).transfer(mockPool, amount),
                    "Mock: repay transfer failed (onBehalfOf is the vault itself)"
                );
            } else {
                // Transfer from target user to mockPool
                require(ERC20(token).transferFrom(onBehalfOf, mockPool, amount), "Mock: repay transfer failed");
            }
        }

        // Reset transfer portion bps to 100%
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Decrease debt after successful transfer
        _setMockDebt(onBehalfOf, token, mockDebt[onBehalfOf][token] - amount);
    }

    function _withdrawFromPoolImplementation(
        address token,
        uint256 amount,
        address onBehalfOf
    ) internal virtual override {
        _checkRequiredAllowance();

        // Calculate the amount to withdraw based on transfer portion bps
        amount = (amount * transferPortionBps) / BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Make sure mockPool has enough balance to withdraw
        require(ERC20(token).balanceOf(mockPool) >= amount, "Mock: not enough tokens in pool to withdraw");

        if (amount > 0) {
            // Transfer from mockPool to target user
            require(ERC20(token).transferFrom(mockPool, onBehalfOf, amount), "Mock: withdraw transfer failed");
        }

        // Reset transfer portion bps to 100%
        transferPortionBps = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Decrease collateral after successful transfer
        _setMockCollateral(onBehalfOf, token, mockCollateral[onBehalfOf][token] - amount);
    }

    /**
     * @dev Get the collateral value in token amount in the underlying pool
     * @param token The address of the token
     * @param user The address of the user
     * @return collateralTokenAmount The collateral token amount
     */
    function getCollateralValueInTokenAmount(
        address token,
        address user
    ) public view override returns (uint256 collateralTokenAmount) {
        collateralTokenAmount = mockCollateral[user][token];
        return collateralTokenAmount;
    }

    /**
     * @dev Get the debt value in token amount in the underlying pool
     * @param token The address of the token
     * @param user The address of the user
     * @return debtTokenAmount The total underlying debt token amount
     */
    function getDebtValueInTokenAmount(
        address token,
        address user
    ) public view override returns (uint256 debtTokenAmount) {
        debtTokenAmount = mockDebt[user][token];
        return debtTokenAmount;
    }

    // --- Test-only public wrappers for internal pool logic ---
    function testSupplyToPool(address token, uint256 amount, address onBehalfOf) external {
        _supplyToPool(token, amount, onBehalfOf);
    }

    function testBorrowFromPool(address token, uint256 amount, address onBehalfOf) external {
        _borrowFromPool(token, amount, onBehalfOf);
    }

    function testRepayDebtToPool(address token, uint256 amount, address onBehalfOf) external {
        _repayDebtToPool(token, amount, onBehalfOf);
    }

    function testWithdrawFromPool(address token, uint256 amount, address onBehalfOf) external {
        _withdrawFromPool(token, amount, onBehalfOf);
    }

    // --- Additional Test Wrappers for Internal Methods ---

    /**
     * @dev Test wrapper for isRescuableToken
     */
    function testisRescuableToken(address token) external view returns (bool) {
        return isRescuableToken(token);
    }

    /**
     * @dev Test wrapper for _supplyToPoolImplementation
     */
    function testSupplyToPoolImplementation(address token, uint256 amount, address onBehalfOf) external {
        _supplyToPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _borrowFromPoolImplementation
     */
    function testBorrowFromPoolImplementation(address token, uint256 amount, address onBehalfOf) external {
        _borrowFromPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _repayDebtToPoolImplementation
     */
    function testRepayDebtToPoolImplementation(address token, uint256 amount, address onBehalfOf) external {
        _repayDebtToPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * @dev Test wrapper for _withdrawFromPoolImplementation
     */
    function testWithdrawFromPoolImplementation(address token, uint256 amount, address onBehalfOf) external {
        _withdrawFromPoolImplementation(token, amount, onBehalfOf);
    }

    /**
     * Just for testing to avoid deploying another contract just for testing this method
     *
     * @dev Test wrapper for DLoopCoreLogic.getBorrowAmountThatKeepCurrentLeverage
     */
    function testGetBorrowAmountThatKeepCurrentLeverage(
        uint256 amount,
        uint256 currentLeverageBpsBeforeSupply
    ) external view returns (uint256) {
        return
            DLoopCoreLogic.getBorrowAmountThatKeepCurrentLeverage(
                amount,
                currentLeverageBpsBeforeSupply,
                targetLeverageBps,
                ERC20(collateralToken).decimals(),
                getAssetPriceFromOracle(address(collateralToken)),
                ERC20(debtToken).decimals(),
                getAssetPriceFromOracle(address(debtToken))
            );
    }

    // --- Mock State Getters for Testing ---

    /**
     * @dev Get mock collateral for a user and token
     */
    function getMockCollateral(address user, address token) external view returns (uint256) {
        return mockCollateral[user][token];
    }

    /**
     * @dev Get mock debt for a user and token
     */
    function getMockDebt(address user, address token) external view returns (uint256) {
        return mockDebt[user][token];
    }

    /**
     * @dev Get all collateral tokens for a user
     */
    function getMockCollateralTokens(address user) external view returns (address[] memory) {
        return mockCollateralTokens[user];
    }

    /**
     * @dev Get all debt tokens for a user
     */
    function getMockDebtTokens(address user) external view returns (address[] memory) {
        return mockDebtTokens[user];
    }

    /**
     * @dev Get mock price for an asset
     */
    function getMockPrice(address asset) external view returns (uint256) {
        uint256 price = mockPrices[asset];
        if (price == 0) revert MockPriceNotSet(asset);
        return price;
    }

    /**
     * @dev Set additional rescue tokens for testing
     * @param tokens Array of token addresses to be treated as additional rescue tokens
     */
    function setMockAdditionalRescueTokens(address[] calldata tokens) external {
        // Clear existing tokens
        delete mockAdditionalRescueTokens;

        // Add new tokens
        for (uint256 i = 0; i < tokens.length; i++) {
            mockAdditionalRescueTokens.push(tokens[i]);
        }
    }

    /**
     * @dev Get the current mock additional rescue tokens
     * @return Array of additional rescue token addresses
     */
    function getMockAdditionalRescueTokens() external view returns (address[] memory) {
        return mockAdditionalRescueTokens;
    }

    // Allow receiving native tokens for testing rescue functionality
    receive() external payable {}
}
