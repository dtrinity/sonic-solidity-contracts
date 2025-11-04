// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IPriceOracleGetter } from "./interface/IPriceOracleGetter.sol";
import { IPool as ILendingPool, DataTypes } from "./interface/IPool.sol";
import { IPoolAddressesProvider } from "./interface/IPoolAddressesProvider.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { DLoopCoreBase } from "../../DLoopCoreBase.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { RewardClaimable } from "contracts/vaults/rewards_claimable/RewardClaimable.sol";
import { IRewardsController } from "./interface/IRewardsController.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { RescuableVault } from "contracts/vaults/dloop/shared/RescuableVault.sol";

/**
 * @title DLoopCoreDLend
 * @dev Read the documentation of DLoopCoreBase for more details
 *      - This contract implement dLEND-specific lending operations for DLoopCoreBase
 */
contract DLoopCoreDLend is DLoopCoreBase, RewardClaimable, RescuableVault {
    using SafeERC20 for ERC20;

    /* Constants */

    uint8 public constant AAVE_PRICE_ORACLE_DECIMALS = 8;

    // Note that there is a vulnerability in stable interest rate mode, so we will never use it
    // See contracts/lending/core/protocol/libraries/types/DataTypes.sol
    uint256 public constant VARIABLE_LENDING_INTERST_RATE_MODE = 2; // 0 = NONE, 1 = STABLE, 2 = VARIABLE

    /* State */

    struct CoreState {
        IPoolAddressesProvider lendingPoolAddressesProvider;
        address dLendAssetToClaimFor;
        address targetStaticATokenWrapper;
        IRewardsController dLendRewardsController;
    }
    CoreState public coreState;

    /* Errors */

    error ZeroAddress();
    error InvalidRewardsController();
    error FeeTooHigh(uint256 feeBps, uint256 maxFeeBps);

    /* Events */
    event DLendRewardsControllerUpdated(address indexed oldController, address indexed newController);
    event FeeBpsSet(uint256 oldFeeBps, uint256 newFeeBps);

    /**
     * @dev Aggregated constructor params to reduce stack usage
     */
    struct InitParams {
        string name;
        string symbol;
        ERC20 collateralToken;
        ERC20 debtToken;
        IPoolAddressesProvider lendingPoolAddressesProvider;
        uint32 targetLeverageBps;
        uint32 lowerBoundTargetLeverageBps;
        uint32 upperBoundTargetLeverageBps;
        uint256 maxSubsidyBps;
        uint256 minDeviationBps;
        uint256 withdrawalFeeBps;
        IRewardsController rewardsController;
        address dLendAssetToClaimFor;
        address targetStaticATokenWrapper;
        address treasury;
        uint256 maxTreasuryFeeBps;
        uint256 initialTreasuryFeeBps;
        uint256 initialExchangeThreshold;
    }

    /**
     * @dev Constructor for the DLoopCoreDLend contract using struct to avoid stack-too-deep
     */
    constructor(
        InitParams memory p
    )
        DLoopCoreBase(
            p.name,
            p.symbol,
            p.collateralToken,
            p.debtToken,
            p.targetLeverageBps,
            p.lowerBoundTargetLeverageBps,
            p.upperBoundTargetLeverageBps,
            p.maxSubsidyBps,
            p.minDeviationBps,
            p.withdrawalFeeBps
        )
        RewardClaimable(
            address(this), // Use the vault shares as the exchange asset
            p.treasury,
            p.maxTreasuryFeeBps,
            p.initialTreasuryFeeBps,
            p.initialExchangeThreshold
        )
    {
        // Always use the vault shares as the exchange asset in reward claim logic
        coreState.lendingPoolAddressesProvider = p.lendingPoolAddressesProvider;
        coreState.dLendAssetToClaimFor = p.dLendAssetToClaimFor;
        coreState.targetStaticATokenWrapper = p.targetStaticATokenWrapper;
        coreState.dLendRewardsController = p.rewardsController;

        if (getLendingOracle().BASE_CURRENCY() != address(0)) {
            revert("Invalid price oracle base currency");
        }
        if (getLendingOracle().BASE_CURRENCY_UNIT() != 10 ** AAVE_PRICE_ORACLE_DECIMALS) {
            revert("Invalid price oracle unit");
        }
    }

    /**
     * @notice Sets the address of the dLEND RewardsController contract.
     * @dev Only callable by accounts with the dLoop admin role.
     * @param _newDLendRewardsController The address of the new rewards controller.
     */
    function setDLendRewardsController(address _newDLendRewardsController) external onlyRole(DLOOP_ADMIN_ROLE) {
        if (_newDLendRewardsController == address(0)) {
            revert ZeroAddress();
        }
        // Make sure the new rewards controller is a valid contract
        if (_newDLendRewardsController.code.length == 0) {
            revert InvalidRewardsController();
        }
        address oldController = address(coreState.dLendRewardsController);
        coreState.dLendRewardsController = IRewardsController(_newDLendRewardsController);
        emit DLendRewardsControllerUpdated(oldController, _newDLendRewardsController);
    }

    /**
     * @dev Do not rescue the aToken, variable debt token and stable debt token of the collateral token
     *      - Implement this method from RescuableVault
     * @param token Address of the token to check
     * @return bool True if the token is a restricted rescue token, false otherwise
     */
    function isRescuableToken(address token) public view override returns (bool) {
        DataTypes.ReserveData memory reserveData = _getReserveData(address(collateralToken));
        return
            token == reserveData.aTokenAddress ||
            token == reserveData.variableDebtTokenAddress ||
            token == reserveData.stableDebtTokenAddress;
    }

    /**
     * @dev Gets the asset price from the oracle
     * @param asset Address of the asset
     * @return uint256 Price of the asset
     */
    function _getAssetPriceFromOracleImplementation(address asset) internal view override returns (uint256) {
        return getLendingOracle().getAssetPrice(asset);
    }

    /**
     * @dev Supply tokens to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to supply
     * @param onBehalfOf Address to supply on behalf of
     */
    function _supplyToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        ILendingPool lendingPool = getLendingPool();

        // Approve the lending pool to spend the token
        ERC20(token).forceApprove(address(lendingPool), amount);

        // Supply the token to the lending pool
        lendingPool.supply(token, amount, onBehalfOf, 0);
    }

    /**
     * @dev Borrow tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to borrow
     * @param onBehalfOf Address to borrow on behalf of
     */
    function _borrowFromPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        getLendingPool().borrow(token, amount, VARIABLE_LENDING_INTERST_RATE_MODE, 0, onBehalfOf);
    }

    /**
     * @dev Repay debt to the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to repay
     * @param onBehalfOf Address to repay on behalf of
     */
    function _repayDebtToPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        ILendingPool lendingPool = getLendingPool();

        // Approve the lending pool to spend the token
        ERC20(token).forceApprove(address(lendingPool), amount);

        // Repay the debt
        lendingPool.repay(token, amount, VARIABLE_LENDING_INTERST_RATE_MODE, onBehalfOf);
    }

    /**
     * @dev Withdraw tokens from the lending pool
     * @param token Address of the token
     * @param amount Amount of tokens to withdraw
     * @param onBehalfOf Address to withdraw on behalf of
     */
    function _withdrawFromPoolImplementation(address token, uint256 amount, address onBehalfOf) internal override {
        getLendingPool().withdraw(token, amount, onBehalfOf);
    }

    /* Helper functions */

    /**
     * @dev Gets the lending oracle
     * @return IPriceOracleGetter The lending oracle interface
     */
    function getLendingOracle() public view returns (IPriceOracleGetter) {
        return IPriceOracleGetter(coreState.lendingPoolAddressesProvider.getPriceOracle());
    }

    /**
     * @dev Gets the lending pool
     * @return ILendingPool The lending pool interface
     */
    function getLendingPool() public view returns (ILendingPool) {
        return ILendingPool(coreState.lendingPoolAddressesProvider.getPool());
    }

    /**
     * @dev Gets the lending pool address
     * @return address The lending pool address
     */
    function getLendingPoolAddress() public view returns (address) {
        return address(getLendingPool());
    }

    /**
     * @dev Gets the oracle address
     * @return address The oracle address
     */
    function getOracleAddress() public view returns (address) {
        return address(getLendingOracle());
    }

    /**
     * @dev Gets the reserve data for a token
     * @param tokenAddress The address of the token
     * @return DataTypes.ReserveData The reserve data
     */
    function _getReserveData(address tokenAddress) internal view returns (DataTypes.ReserveData memory) {
        return getLendingPool().getReserveData(tokenAddress);
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
        collateralTokenAmount = ERC20(_getReserveData(token).aTokenAddress).balanceOf(user);
        return collateralTokenAmount;
    }

    /**
     * @dev Get the debt value in token amount in the underlying pool
     * @param token The address of the token
     * @param user The address of the user
     * @return debtTokenAmount The debt token amount
     */
    function getDebtValueInTokenAmount(
        address token,
        address user
    ) public view override returns (uint256 debtTokenAmount) {
        DataTypes.ReserveData memory reserveDebt = _getReserveData(token);
        uint256 variableDebt = ERC20(reserveDebt.variableDebtTokenAddress).balanceOf(user);
        uint256 stableDebt = ERC20(reserveDebt.stableDebtTokenAddress).balanceOf(user);
        debtTokenAmount = variableDebt + stableDebt;
        return debtTokenAmount;
    }

    /* RewardClaimable functions */

    /**
     * @dev Claims multiple rewards
     * @param rewardTokens The reward tokens to claim
     * @param receiver The address to receive the claimed rewards
     * @return rewardAmounts The amount of rewards claimed for each token (have the same length as the tokens array)
     */
    function _claimRewards(
        address[] calldata rewardTokens,
        address receiver
    ) internal override returns (uint256[] memory rewardAmounts) {
        if (rewardTokens.length == 0) {
            revert ZeroRewardTokens();
        }
        if (receiver == address(0)) {
            revert ZeroReceiverAddress();
        }

        rewardAmounts = new uint256[](rewardTokens.length);
        address[] memory assetsToClaimForPayload = new address[](1);
        assetsToClaimForPayload[0] = coreState.dLendAssetToClaimFor;

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address rewardToken = rewardTokens[i];
            if (rewardToken == address(0)) {
                revert ZeroAddress(); // Cannot claim zero address token
            }

            uint256 balanceBefore = ERC20(rewardToken).balanceOf(receiver);

            // Claim all available amount of the specific reward token
            coreState.dLendRewardsController.claimRewardsOnBehalf(
                assetsToClaimForPayload, // Asset held by the wrapper in dLEND
                type(uint256).max, // Claim all
                coreState.targetStaticATokenWrapper, // User earning rewards is the wrapper
                receiver,
                rewardToken // The reward token to claim
            );

            uint256 balanceAfter = ERC20(rewardToken).balanceOf(receiver);
            rewardAmounts[i] = balanceAfter - balanceBefore;
        }
        return rewardAmounts;
    }

    /**
     * @dev Processes the exchange asset deposit from the caller
     * @param amount The amount of exchange asset to deposit
     */
    function _processExchangeAssetDeposit(uint256 amount) internal override {
        // As the exchange asset is the vault shares, we need to burn it
        // to increase the share's value
        _burn(address(this), amount);
    }
}
