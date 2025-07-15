# Audit Scope Tree

## dStable System
- [ ] ó contracts/dstable/ERC20StablecoinUpgradeable.sol
- [ ] ó contracts/dstable/Issuer.sol
- [ ] ó contracts/dstable/Redeemer.sol
- [ ] ó contracts/dstable/RedeemerWithFees.sol
- [ ] ó contracts/dstable/CollateralVault.sol
- [ ] ó contracts/dstable/CollateralVaultFraxtal.sol
- [ ] ó contracts/dstable/AmoManager.sol
- [ ] ó contracts/dstable/AmoVault.sol

## dStake System
- [ ] L contracts/vaults/dstake/DStakeToken.sol (KNOWN ISSUE: withdrawal bug)
- [ ] ó contracts/vaults/dstake/DStakeCollateralVault.sol
- [ ] ó contracts/vaults/dstake/DStakeRouterDLend.sol
- [ ] ó contracts/vaults/dstake/DStakeRewardManagerDLend.sol
- [ ] ó contracts/vaults/dstake/adapters/DStakeAdapterDLend.sol
- [ ] ó contracts/vaults/dstake/adapters/DStakeAdapterEarlyExit.sol

## dLoop System
- [ ] ó contracts/vaults/dloop/base/*.sol
- [ ] ó contracts/vaults/dloop/periphery/*.sol
- [ ] ó contracts/vaults/dloop/venues/dlend/*.sol
- [ ] ó contracts/vaults/dloop/venues/odos/*.sol

## dPool System
- [ ] ó contracts/vaults/dpool/DPoolCurveGauge.sol
- [ ] ó contracts/vaults/dpool/DPoolCurvePeriphery.sol
- [ ] ó contracts/vaults/dpool/DPoolVaultLP.sol

## Oracle Aggregator
- [ ] ó contracts/oracle_aggregator/OracleAggregatorV2.sol
- [ ] ó contracts/oracle_aggregator/oracles/*.sol
- [ ] ó contracts/oracle_aggregator/wrappers/*.sol

## Common/Utils
- [ ] ó contracts/common/*.sol

## External Integrations
- [ ] ó contracts/odos/*.sol
- [ ] ó contracts/pendle/*.sol

## Out of Scope
- L bot/ (liquidation bots)
- L contracts/dlend/ (Aave V3 fork)
- L contracts/mocks/
- L contracts/test/