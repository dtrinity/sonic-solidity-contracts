# Audit Scope Tree

## dStable System
- [ ] � contracts/dstable/ERC20StablecoinUpgradeable.sol
- [ ] � contracts/dstable/Issuer.sol
- [ ] � contracts/dstable/Redeemer.sol
- [ ] � contracts/dstable/RedeemerWithFees.sol
- [ ] � contracts/dstable/CollateralVault.sol
- [ ] � contracts/dstable/CollateralVaultFraxtal.sol
- [ ] � contracts/dstable/AmoManager.sol
- [ ] � contracts/dstable/AmoVault.sol

## dStake System
- [ ] L contracts/vaults/dstake/DStakeToken.sol (KNOWN ISSUE: withdrawal bug)
- [ ] � contracts/vaults/dstake/DStakeCollateralVault.sol
- [ ] � contracts/vaults/dstake/DStakeRouterDLend.sol
- [ ] � contracts/vaults/dstake/DStakeRewardManagerDLend.sol
- [ ] � contracts/vaults/dstake/adapters/DStakeAdapterDLend.sol
- [ ] � contracts/vaults/dstake/adapters/DStakeAdapterEarlyExit.sol

## dLoop System
- [ ] � contracts/vaults/dloop/base/*.sol
- [ ] � contracts/vaults/dloop/periphery/*.sol
- [ ] � contracts/vaults/dloop/venues/dlend/*.sol
- [ ] � contracts/vaults/dloop/venues/odos/*.sol

## dPool System
- [ ] � contracts/vaults/dpool/DPoolCurveGauge.sol
- [ ] � contracts/vaults/dpool/DPoolCurvePeriphery.sol
- [ ] � contracts/vaults/dpool/DPoolVaultLP.sol

## Oracle Aggregator
- [ ] � contracts/oracle_aggregator/OracleAggregatorV2.sol
- [ ] � contracts/oracle_aggregator/oracles/*.sol
- [ ] � contracts/oracle_aggregator/wrappers/*.sol

## Common/Utils
- [ ] � contracts/common/*.sol

## External Integrations
- [ ] � contracts/odos/*.sol
- [ ] � contracts/pendle/*.sol

## Out of Scope
- L bot/ (liquidation bots)
- L contracts/dlend/ (Aave V3 fork)
- L contracts/mocks/
- L contracts/test/