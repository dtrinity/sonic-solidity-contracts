The `hardhat-deploy` verify function found in the Makefile does not always verify all contracts correctly.
```
make explorer.verify.sonic_mainnet
```

In these cases we must manually verify the contracts one by one using the default `hardhat verify` command with the following syntax:
```
npx hardhat verify --network mainnet DEPLOYED_CONTRACT_ADDRESS "Constructor argument 1"
```

Here are the unverified contracts for Sonic mainnet:

Contract: `contracts/dlend/core/protocol/libraries/aave-upgradeability/InitializableImmutableAdminUpgradeabilityProxy.sol`
```
npx hardhat verify --network sonic_mainnet 0xA6C0af87418Ff6294cFFD76F81f9adAff81dA464 "0x1f8d8a3575d049aA0C195AA947483738811bAdcb"
```

Contract: `contracts/dlend/core/protocol/pool/L2Pool.sol`
```
npx hardhat verify --network sonic_mainnet 0x179867C392add1Bf4f7A3D4c70bF8F2F476BB8Cc "0x1f8d8a3575d049aA0C195AA947483738811bAdcb"
```
