// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/DLoopCoreDLend.sol";

contract DLoopCoreDLendHarness is DLoopCoreDLend {
    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _collateralToken,
        ERC20 _debtToken,
        IPoolAddressesProvider _lendingPoolAddressesProvider,
        uint32 _targetLeverageBps,
        uint32 _lowerBoundTargetLeverageBps,
        uint32 _upperBoundTargetLeverageBps,
        uint256 _maxSubsidyBps,
        uint256 _minDeviationBps,
        uint256 _withdrawalFeeBps,
        IRewardsController _rewardsController,
        address _dLendAssetToClaimFor,
        address _targetStaticATokenWrapper,
        address _treasury,
        uint256 _maxTreasuryFeeBps,
        uint256 _initialTreasuryFeeBps,
        uint256 _initialExchangeThreshold
    )
        DLoopCoreDLend(
            DLoopCoreDLend.InitParams({
                name: _name,
                symbol: _symbol,
                collateralToken: _collateralToken,
                debtToken: _debtToken,
                lendingPoolAddressesProvider: _lendingPoolAddressesProvider,
                targetLeverageBps: _targetLeverageBps,
                lowerBoundTargetLeverageBps: _lowerBoundTargetLeverageBps,
                upperBoundTargetLeverageBps: _upperBoundTargetLeverageBps,
                maxSubsidyBps: _maxSubsidyBps,
                minDeviationBps: _minDeviationBps,
                withdrawalFeeBps: _withdrawalFeeBps,
                rewardsController: _rewardsController,
                dLendAssetToClaimFor: _dLendAssetToClaimFor,
                targetStaticATokenWrapper: _targetStaticATokenWrapper,
                treasury: _treasury,
                maxTreasuryFeeBps: _maxTreasuryFeeBps,
                initialTreasuryFeeBps: _initialTreasuryFeeBps,
                initialExchangeThreshold: _initialExchangeThreshold
            })
        )
    {}

    function mintShares(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
