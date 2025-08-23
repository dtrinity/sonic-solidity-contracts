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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../RewardClaimable.sol";

/**
 * @title MockRewardClaimableVault
 * @dev Mock implementation of RewardClaimable contract for testing purposes
 */
contract MockRewardClaimableVault is RewardClaimable {
    using SafeERC20 for IERC20;

    // Track deposited amounts for testing
    mapping(address => uint256) public deposits;

    // Mock reward tokens for testing
    mapping(address => bool) public rewardTokens;
    mapping(address => uint256) public rewardTokenEmissionAmount;

    // Mock target pool address
    address public targetPool;
    // Mock fake reward pool address
    address public fakeRewardPool;

    error InsufficientAllowanceFromFakeRewardPool(address token, uint256 allowance, uint256 amount);

    /**
     * @dev Constructor for the MockRewardClaimableVault contract
     * @param _exchangeAsset The address of the exchange asset
     * @param _treasury The address of the treasury
     * @param _maxTreasuryFeeBps The maximum treasury fee in basis points
     * @param _initialTreasuryFeeBps The initial treasury fee in basis points
     * @param _initialExchangeThreshold The initial minimum threshold amount
     * @param _targetPool The address of the target pool
     * @param _fakeRewardPool The address of the fake reward pool
     */
    constructor(
        address _exchangeAsset,
        address _treasury,
        uint256 _maxTreasuryFeeBps,
        uint256 _initialTreasuryFeeBps,
        uint256 _initialExchangeThreshold,
        address _targetPool,
        address _fakeRewardPool
    )
        RewardClaimable(
            _exchangeAsset,
            _treasury,
            _maxTreasuryFeeBps,
            _initialTreasuryFeeBps,
            _initialExchangeThreshold
        )
    {
        targetPool = _targetPool;
        fakeRewardPool = _fakeRewardPool;
    }

    /**
     * @dev Adds a reward token to the list of mock reward tokens (for testing purposes)
     * @param _rewardToken The address of the reward token to add
     * @param _emissionAmount The emission amount of the reward token each time the vault claims rewards
     */
    function addRewardToken(address _rewardToken, uint256 _emissionAmount) external {
        rewardTokens[_rewardToken] = true;

        require(_emissionAmount > 0, "Emission amount must be greater than 0");
        rewardTokenEmissionAmount[_rewardToken] = _emissionAmount;
    }

    /**
     * @dev Public function to expose the internal _claimRewards function for testing
     */
    function claimRewards(address[] calldata tokens, address receiver) external {
        _claimRewards(tokens, receiver);
    }

    /**
     * @dev Mocks claiming rewards
     * @param tokens The reward tokens to claim
     * @param receiver The address to receive the claimed rewards
     * @return rewardAmounts The amount of rewards claimed for each token (have the same length as the tokens array)
     */
    function _claimRewards(
        address[] calldata tokens,
        address receiver
    ) internal override returns (uint256[] memory rewardAmounts) {
        rewardAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (!rewardTokens[tokens[i]]) {
                revert("Invalid reward token");
            }

            // Now, we will drain reward tokens from the fake reward pool to mimic the behavior of the real vault
            // claiming the rewards
            uint256 amount = rewardTokenEmissionAmount[tokens[i]];

            // Make sure having enough allowance to transfer from the fake reward pool
            uint256 allowance = IERC20(tokens[i]).allowance(fakeRewardPool, address(this));
            if (allowance < amount) {
                revert InsufficientAllowanceFromFakeRewardPool(tokens[i], allowance, amount);
            }

            // Transfer the tokens to the receiver
            IERC20(tokens[i]).safeTransferFrom(fakeRewardPool, receiver, amount);

            rewardAmounts[i] = amount;
        }

        return rewardAmounts;
    }

    /**
     * @dev Mocks processing the exchange asset deposit from the caller
     * @param amount The amount of exchange asset to deposit
     */
    function _processExchangeAssetDeposit(uint256 amount) internal virtual override {
        deposits[exchangeAsset] += amount;
        // Transfer tokens from contract to the target pool (tokens are already in the contract)
        IERC20(exchangeAsset).safeTransfer(targetPool, amount);
    }
}
