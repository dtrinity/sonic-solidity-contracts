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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BasisPointConstants } from "contracts/common/BasisPointConstants.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title RewardClaimable
 * @dev Abstract contract for vaults with claimable rewards
 * Implements functionality for claiming and compounding rewards
 */
abstract contract RewardClaimable is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant REWARDS_MANAGER_ROLE = keccak256("REWARDS_MANAGER_ROLE");

    // State variables
    address public treasury;
    uint256 public treasuryFeeBps;
    uint256 public exchangeThreshold;
    address public immutable exchangeAsset;
    uint256 public immutable maxTreasuryFeeBps;

    // Events
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event TreasuryFeeBpsUpdated(uint256 oldTreasuryFeeBps, uint256 newTreasuryFeeBps);
    event ExchangeThresholdUpdated(uint256 oldExchangeThreshold, uint256 newExchangeThreshold);
    event RewardCompounded(address exchangeAsset, uint256 amount, address[] rewardTokens);

    // Custom errors
    error ExchangeAmountTooLow(uint256 amount, uint256 threshold);
    error RewardAmountsLengthMismatch(uint256 claimedAmountsLength, uint256 rewardTokensLength);
    error TreasuryFeeExceedsRewardAmount(uint256 treasuryFee, uint256 rewardAmount);
    error ZeroExchangeAssetAddress();
    error ZeroTreasuryAddress();
    error MaxTreasuryFeeTooHigh(uint256 maxTreasuryFeeBps);
    error TreasuryFeeTooHigh(uint256 treasuryFeeBps, uint256 maxTreasuryFeeBps);
    error ZeroExchangeThreshold();
    error ZeroReceiverAddress();
    error ZeroRewardTokens();

    /**
     * @dev Constructor for the RewardClaimable contract
     * @param _exchangeAsset The address of the exchange asset
     * @param _treasury The address of the treasury
     * @param _maxTreasuryFeeBps The maximum treasury fee in basis points (30000 = 3%), where 100 = 1bps (1e2 for decimals)
     * @param _initialTreasuryFeeBps The initial treasury fee in basis points (100 = 1bps, 10000 = 100bps = 1%)
     * @param _initialExchangeThreshold The initial minimum threshold amount (in the same unit as the exchange asset)
     */
    constructor(
        address _exchangeAsset,
        address _treasury,
        uint256 _maxTreasuryFeeBps,
        uint256 _initialTreasuryFeeBps,
        uint256 _initialExchangeThreshold
    ) {
        if (_exchangeAsset == address(0)) {
            revert ZeroExchangeAssetAddress();
        }
        if (_treasury == address(0)) {
            revert ZeroTreasuryAddress();
        }
        // The fee cannot exceed the reward amount (100%)
        if (_maxTreasuryFeeBps > BasisPointConstants.ONE_HUNDRED_PERCENT_BPS) {
            revert MaxTreasuryFeeTooHigh(_maxTreasuryFeeBps);
        }
        // The initial fee cannot exceed the max fee, which means cannot be greater than 100% as well
        if (_initialTreasuryFeeBps > _maxTreasuryFeeBps) {
            revert TreasuryFeeTooHigh(_initialTreasuryFeeBps, _maxTreasuryFeeBps);
        }
        if (_initialExchangeThreshold == 0) {
            revert ZeroExchangeThreshold();
        }

        exchangeAsset = _exchangeAsset;
        treasury = _treasury;
        maxTreasuryFeeBps = _maxTreasuryFeeBps;
        treasuryFeeBps = _initialTreasuryFeeBps;
        exchangeThreshold = _initialExchangeThreshold;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REWARDS_MANAGER_ROLE, msg.sender);
    }

    /**
     * @dev Sets the treasury address
     * @param newTreasury The new treasury address
     */
    function setTreasury(address newTreasury) external onlyRole(REWARDS_MANAGER_ROLE) {
        if (newTreasury == address(0)) {
            revert ZeroTreasuryAddress();
        }
        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    /**
     * @dev Sets the treasury fee in basis points
     * @param newTreasuryFeeBps New treasury fee in basis points (100 = 1bps = 0.01%)
     */
    function setTreasuryFeeBps(uint256 newTreasuryFeeBps) external onlyRole(REWARDS_MANAGER_ROLE) {
        if (newTreasuryFeeBps > maxTreasuryFeeBps) {
            revert TreasuryFeeTooHigh(newTreasuryFeeBps, maxTreasuryFeeBps);
        }

        uint256 oldTreasuryFeeBps = treasuryFeeBps;
        treasuryFeeBps = newTreasuryFeeBps;

        emit TreasuryFeeBpsUpdated(oldTreasuryFeeBps, newTreasuryFeeBps);
    }

    /**
     * @dev Sets the minimum threshold for exchange operations
     * @param newExchangeThreshold New minimum threshold amount
     */
    function setExchangeThreshold(uint256 newExchangeThreshold) external onlyRole(REWARDS_MANAGER_ROLE) {
        if (newExchangeThreshold == 0) {
            revert ZeroExchangeThreshold();
        }
        uint256 oldExchangeThreshold = exchangeThreshold;
        exchangeThreshold = newExchangeThreshold;

        emit ExchangeThresholdUpdated(oldExchangeThreshold, newExchangeThreshold);
    }

    /**
     * @dev Calculates the treasury fee for a given amount
     * @param amount The amount to calculate the treasury fee for
     * @return The treasury fee in the same unit as the amount
     */
    function getTreasuryFee(uint256 amount) public view returns (uint256) {
        return Math.mulDiv(amount, treasuryFeeBps, BasisPointConstants.ONE_HUNDRED_PERCENT_BPS);
    }

    /**
     * @dev Compounds multiple rewards
     * @param amount The amount to compound
     * @param rewardTokens The reward tokens to claim
     * @param receiver The address to receive the compounded rewards
     */
    function compoundRewards(
        uint256 amount,
        address[] calldata rewardTokens,
        address receiver
    ) public virtual nonReentrant {
        if (amount < exchangeThreshold) {
            revert ExchangeAmountTooLow(amount, exchangeThreshold);
        }
        if (receiver == address(0)) {
            revert ZeroReceiverAddress();
        }
        if (rewardTokens.length == 0) {
            revert ZeroRewardTokens();
        }

        // Transfer the exchange asset from the caller to the vault
        IERC20(exchangeAsset).safeTransferFrom(msg.sender, address(this), amount);

        // Emit the event before the internal call to avoid reentrancy
        emit RewardCompounded(exchangeAsset, amount, rewardTokens);

        // Claim the rewards
        uint256[] memory rewardAmounts = _claimRewards(rewardTokens, address(this));

        if (rewardAmounts.length != rewardTokens.length) {
            revert RewardAmountsLengthMismatch(rewardAmounts.length, rewardTokens.length);
        }

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            uint256 rewardAmount = rewardAmounts[i];
            uint256 treasuryFee = getTreasuryFee(rewardAmount);

            // Overflow protection
            if (treasuryFee > rewardAmount) {
                revert TreasuryFeeExceedsRewardAmount(treasuryFee, rewardAmount);
            }

            // Transfer the treasury fee to the treasury
            IERC20(rewardTokens[i]).safeTransfer(treasury, treasuryFee);

            // Transfer the remaining amount to the caller
            IERC20(rewardTokens[i]).safeTransfer(receiver, rewardAmount - treasuryFee);
        }

        // Process the exchange asset deposit
        _processExchangeAssetDeposit(amount);
    }

    /**
     * @dev Claims multiple rewards
     * @param rewardTokens The reward tokens to claim
     * @param receiver The address to receive the claimed rewards
     * @return rewardAmounts The amount of rewards claimed for each token (have the same length as the tokens array)
     */
    function _claimRewards(
        address[] calldata rewardTokens,
        address receiver
    ) internal virtual returns (uint256[] memory rewardAmounts);

    /**
     * @dev Processes the exchange asset deposit from the caller
     * @param amount The amount of exchange asset to deposit
     */
    function _processExchangeAssetDeposit(uint256 amount) internal virtual;
}
