# Scope
- contracts/common
  - BasisPointConstants.sol ✅
  - Erc20Helper.sol ✅
  - IAaveOracle.sol ✅
  - IMintableERC20.sol ✅
  - RescuableVault.sol ✅
  - SupportsWithdrawalFee.sol ✅
  - SwappableVault.sol ✅
- contracts/dstable
  - AmoManager.sol ✅
  - AmoVault.sol ✅
  - CollateralHolderVault.sol ✅
  - CollateralVault.sol ✅
  - ERC20StablecoinUpgradeable.sol ✅
  - Issuer.sol ✅
  - OracleAware.sol ✅
  - Redeemer.sol ✅
  - RedeemerWithFees.sol ✅
- contracts/odos
  - OdosSwapUtils.sol ✅
  - interface/IOdosRouterV2.sol ✅
- contracts/oracle_aggregator
  - OracleAggregator.sol ✅
  - helper/ChainlinkDecimalConverter.sol ✅
  - interface/IOracleWrapper.sol ✅
  - interface/chainlink/BaseChainlinkWrapper.sol ✅
  - interface/chainlink/IAggregatorV3Interface.sol ✅
  - interface/chainlink/IPriceFeed.sol ✅
  - interface/api3/BaseAPI3Wrapper.sol ✅
  - interface/api3/IProxy.sol ✅
  - wrapper/API3Wrapper.sol ✅
  - wrapper/API3WrapperWithThresholding.sol ✅
  - wrapper/RedstoneChainlinkWrapper.sol ✅
  - wrapper/RedstoneChainlinkWrapperWithThresholding.sol ✅
  - wrapper/RedstoneChainlinkCompositeWrapperWithThresholding.sol ✅
  - wrapper/API3CompositeWrapperWithThresholding.sol ✅
  - wrapper/HardPegOracleWrapper.sol ✅
  - wrapper/ThresholdingUtils.sol ✅
- contracts/vaults
  - dstake
    - DStakeRouterDLend.sol ✅
    - DStakeToken.sol ✅
    - DStakeCollateralVault.sol ✅
    - adapters/WrappedDLendConversionAdapter.sol ✅
    - rewards/DStakeRewardManagerDLend.sol ✅
  - dloop
    - core/DLoopCoreBase.sol ✅
    - periphery/DLoopDepositorBase.sol ✅
    - periphery/DLoopRedeemerBase.sol ✅
    - periphery/DLoopIncreaseLeverageBase.sol ✅
    - periphery/DLoopDecreaseLeverageBase.sol ✅
  - rewards_claimable/RewardClaimable.sol ✅
  - vesting/ERC20VestingNFT.sol ✅

Legend: ✅ No issues found, ❌ Issue found, ⏳ Pending review

## Products & Threat Models

This audit covers several distinct but interconnected products within the ecosystem. The primary threat actors are financially motivated attackers seeking to exploit economic vulnerabilities or bugs in the smart contract logic to steal funds. Other actors could include malicious insiders or governance attackers who attempt to manipulate system parameters for personal gain.

### dStable: Collateralized Stablecoin

- **Overview**: dStable is a decentralized stablecoin ecosystem. The core components include an `Issuer` that mints the stablecoin against accepted collateral, `CollateralVault` contracts to hold the collateral, and a `Redeemer` to allow users to redeem the stablecoin for its underlying collateral. The system appears to support Algorithmic Market Operations (AMOs) via `AmoManager` and `AmoVault` to help maintain the peg.
- **Contract Interactions**:
  - `ERC20StablecoinUpgradeable`: The core stablecoin token contract.
  - `Issuer`: Mints new stablecoins when users deposit collateral.
  - `CollateralVault` / `CollateralHolderVault`: Holds the assets backing the stablecoin.
  - `Redeemer` / `RedeemerWithFees`: Burns stablecoins to redeem underlying collateral.
  - `AmoManager` / `AmoVault`: Manages protocol-controlled liquidity and executes strategies to defend the peg.
- **Threat Model (STRIDE)**:
  - **Spoofing**: Weak input validation could allow an attacker to trick the system into accepting a non-collateral asset or interacting with a malicious contract.
  - **Tampering**: The primary threat is a flaw in the collateral ratio calculation or the redemption logic. A bug could lead to under-collateralized minting or allow users to redeem more collateral than they are entitled to. Reentrancy vulnerabilities in the `Issuer` or `Redeemer` could also be an attack vector.
  - **Repudiation**: N/A for on-chain transactions.
  - **Information Disclosure**: AMO strategies could be sensitive. If they are predictable, they could be front-run by MEV bots.
  - **Denial of Service**: An attack that disables minting or redeeming could cause a de-peg. This could be achieved by exploiting a bug that freezes the `Issuer` or `Redeemer` contracts, such as a state-locking issue or an integer overflow on a critical variable.
  - **Elevation of Privilege**: A flaw in the access control implementation could allow an unauthorized user to execute privileged functions on the `Issuer`, `AmoManager`, or `CollateralVault`, enabling theft of collateral or the minting of unbacked stablecoins.

#### Findings & Observations (Contract-level)

| Contract                                    | Result | Notes                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERC20StablecoinUpgradeable`                | ✅      | • Follows OZ upgradeable patterns; initializers protected.<br/>• `decimals()` fixed at 18 for consistency.<br/>• Role-gated mint/pause; no re-entrancy or unchecked arithmetic.<br/>• `setNameAndSymbol()` could break off-chain symbol caching, but EIP-712 domain override mitigates signature breakage (info). |
| `CollateralVault` & `CollateralHolderVault` | ✅      | • Deposit/withdraw use SafeERC20.<br/>• Oracle price check (non-zero) before allowing new collateral.<br/>• Exchange logic enforces value-parity; rounding favours the vault.<br/>• Separation of `COLLATERAL_MANAGER`, `STRATEGY`, `WITHDRAWER` roles provides good defence-in-depth.                            |
| `Issuer`                                    | ✅      | • Collateral support verified upfront.<br/>• Slippage param prevents oracle / front-run issues.<br/>• Mints after collateral transfer to vault – avoids minting without backing.<br/>• `issueUsingExcessCollateral()` rechecks collateralisation post-mint.<br/>• AMO supply invariant check solid.               |
| `Redeemer`                                  | ✅      | • Restricted to role (intended for protocol integrations).<br/>• Burns before collateral withdrawal; no re-entrancy.<br/>• Min-collateral slippage guard.                                                                                                                                                         |
| `RedeemerWithFees`                          | ✅      | • Public path with fee cap (max 5 %).<br/>• Fee rounding cannot exceed total collateral.<br/>• Uses shared conversion helpers; burns before withdrawal.<br/>• Proper events emitted.                                                                                                                              |

No critical or high-severity issues identified. Minor informational note on token name/symbol mutability as above.

### Oracle Aggregator

- **Overview**: This product provides a resilient and robust price feed service by aggregating data from multiple oracle providers (e.g., Chainlink, API3, Redstone). It is a critical piece of infrastructure for other products like dStable and dLoop that depend on accurate pricing.
- **Contract Interactions**:
  - `OracleAggregator`: The central contract that applications query for prices.
  - `Wrapper` contracts (e.g., `API3Wrapper`, `RedstoneChainlinkWrapper`): Each wrapper normalizes the output from a specific oracle provider. They can include additional safety features like thresholding to detect stale or deviant prices.
- **Threat Model (STRIDE)**:
  - **Spoofing**: N/A, assuming source wrappers are secure.
  - **Tampering**: The primary threat is a bug in the aggregation logic itself. A flaw could cause the contract to incorrectly calculate the median price, fail to discard a stale price, or handle precision differences between sources incorrectly, leading to a skewed price report.
  - **Repudiation**: N/A.
  - **Information Disclosure**: N/A, as price data is public.
  - **Denial of Service**: A bug in the aggregation logic, such as an out-of-bounds error when iterating sources or a revert on a mathematical edge case (e.g., division by zero), could cause the aggregator to fail, causing a DoS on dependent systems.
  - **Elevation of Privilege**: A flaw in access control could allow an unauthorized user to add, remove, or reconfigure oracle wrappers, compromising the integrity of the price feed.

#### Findings & Observations (Contract-level)

| Contract / Module                                              | Result | Notes                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OracleAggregator`                                             | ✅      | • Ensures wrapper `BASE_CURRENCY_UNIT` matches aggregator before acceptance.<br/>• Emits `OracleUpdated` on changes aiding off-chain monitoring.<br/>• Rejects stale prices via per-wrapper `isAlive` flag. |
| `BaseChainlinkWrapper` & derived (`RedstoneChainlinkWrapper*`) | ✅      | • Heartbeat + configurable stale-time check mitigates frozen feeds.<br/>• Converts Chainlink 8-dec prices to aggregator decimals with overflow-safe math.<br/>• Access-controlled feed management.          |
| `BaseAPI3Wrapper` & derived (`API3Wrapper*`)                   | ✅      | • Similar heartbeat logic to Chainlink variant.<br/>• Accepts int224 price, validates > 0.<br/>• `read()` proxy pattern reduces external calls per asset.                                                   |
| `ThresholdingUtils`                                            | ✅      | • Simple, pure helper; cannot underflow, relies on caller's thresholds.<br/>• Only rounds when price exceeds trigger, avoids divide-by-zero.                                                                |
| `ChainlinkDecimalConverter`                                    | ✅      | • Prevents up-scaling (only down-scale allowed).<br/>• Does not store mutable state beyond constructor – gas efficient.                                                                                     |
| `HardPegOracleWrapper`                                         | ✅      | • Constant peg useful for stable assets; minimal attack surface.                                                                                                                                            |

No security-relevant arithmetic or access-control weaknesses found. Main residual risks relate to oracle data availability (DoS) and governance configuration, which are out-of-scope for this code audit.

### dStake: dStable Staking Vault

- **Overview**: dStake is an ERC4626-compliant vault that allows users to deposit a dSTABLE token (e.g., dUSD) to earn yield. The vault converts the dSTABLE into yield-bearing assets via a modular adapter system.
- **Contract Interactions**:
  - `DStakeToken`: The ERC4626 vault token users receive.
  - `DStakeCollateralVault`: Holds the underlying yield-bearing assets.
  - `DStakeRouterDLend`: A router that handles the logic for converting dSTABLE into a chosen yield-bearing asset.
  - `IDStableConversionAdapter`: An interface for adapters that connect the router to different yield sources (e.g., dLend).
  - `DStakeRewardManagerDLend`: A contract for claiming and compounding rewards earned by the vault's assets.
- **Threat Model (STRIDE)**:
  - **Spoofing**: An attacker could attempt to exploit weak input validation in the `DStakeRouterDLend` to interact with an unintended contract.
  - **Tampering**: The vault's share price is derived from the value of its underlying assets. A bug in an adapter's value calculation or conversion logic could lead to incorrect accounting, allowing an attacker to mint shares cheaply or withdraw more assets than they are entitled to. Reentrancy during the deposit/withdraw process is also a key concern.
  - **Repudiation**: N/A.
  - **Information Disclosure**: A predictable rebalancing strategy executed by the `COLLATERAL_EXCHANGER_ROLE` could be front-run.
  - **Denial of Service**: If an adapter's logic contains a bug that causes reverts (e.g., when interacting with its underlying protocol), it could block deposits and withdrawals.
  - **Elevation of Privilege**: A flaw in the role-based access control of `DStakeToken` or `DStakeRouter` could allow an attacker to bypass checks and execute restricted functions, such as changing adapters or setting malicious fees.

#### Findings & Observations (Contract-level)

| Contract                        | Result | Notes                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DStakeToken`                   | ✅      | • Follows OZ upgradeable patterns, initializer protected.<br/>• Withdrawal-fee logic capped at 1 %.<br/>• Calls to external router happen after share burn, limiting the impact of potential re-entrancy.<br/>• Uses per-call `approve()` (not unlimited) when forwarding assets to the router.                                                  |
| `DStakeCollateralVault`         | ✅      | • Only registered router may move assets via `sendAsset()`.<br/>• Adapters validated on addition; removal blocked while non-zero balance.<br/>• `totalValueInDStable()` iterates `supportedAssets` – linear scan but acceptable at current list size.                                                                                            |
| `DStakeRouterDLend`             | ✅      | • Further analysis confirmed that `StaticATokenLM.asset()` equals dSTABLE, so `previewWithdraw(dStableAmount)` returns the exact number of shares needed to redeem the requested amount. The implementation therefore handles share/asset conversion correctly and does **not** suffer from a unit-mismatch. No security issues were identified. |
| `WrappedDLendConversionAdapter` | ✅      | • Validates underlying asset matches dSTABLE on construction.<br/>• Uses SafeERC20 throughout and forwards tokens directly to the collateral vault.<br/>• All preview functions rely on `StaticATokenLM` which is assumed trustworthy.                                                                                                           |
| `DStakeRewardManagerDLend`      | ✅      | • Inherits `RewardClaimable` re-entrancy guard.<br/>• Treasury-fee bounded and checked against reward amount.<br/>• Compounding path validates default adapter and asset.<br/>• External reward controller is upgradable by admin – centralisation accepted design choice.                                                                       |

<!-- Recommendation removed – finding proven false positive. -->

### dLoop: Leveraged Yield Farming

- **Overview**: dLoop is a leveraged yield farming protocol. It allows users to deposit collateral, borrow a stablecoin, and use the proceeds to farm yield with a leveraged position.
- **Contract Interactions**:
  - `DLoopCoreBase`: The central contract managing user positions, debt, and liquidations.
  - `DLoopDepositorBase`: A periphery contract for handling initial deposits and opening positions.
  - `DLoopIncrease/DecreaseLeverageBase`: Periphery contracts for adjusting the leverage of an existing position.
  - `DLoopRedeemerBase`: A periphery contract for closing positions and withdrawing funds.
- **Threat Model (STRIDE)**:
  - **Tampering**: The most critical threat is a flaw in the protocol's internal accounting or liquidation logic. A bug in calculating a user's health factor could lead to premature or failed liquidations. A reentrancy attack during borrowing or deleveraging could potentially allow an attacker to drain funds from the core contract.
  - **Spoofing**: N/A, as interactions are typically with the core protocol contracts.
  - **Repudiation**: N/A.
  - **Information Disclosure**: While positions are public, an attacker can monitor the health factor of large positions to time a liquidation for maximum profit (MEV).
  - **Denial of Service**: A bug in the liquidation mechanism that prevents it from executing correctly during high market volatility could lead to protocol insolvency. A logic error that causes a revert in a core function like `borrow` or `repay` could freeze user funds.
  - **Elevation of Privilege**: A flaw in access control could allow an unauthorized user to change crucial system parameters like LTV ratios or liquidation thresholds, potentially putting user funds at risk.

#### Findings & Observations (Contract-level) — dLoop

| Contract                    | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DLoopCoreBase`             | ✅      | • Uses OZ `ReentrancyGuard` on all state-changing paths.<br/>• Deposit/withdraw functions revert when leverage drifts outside the configured band, preventing unsafe positions.<br/>• Price-conversion helpers sanity-check non-zero oracle price; math uses Solidity 0.8 checked arithmetic.<br/>• Owner-configurable leverage bounds guarded by `InvalidLeverageBounds` (info).                       |
| `DLoopDepositorBase`        | ✅      | • Flash-loan callback validates lender, initiator and debt-token compatibility.<br/>• Swap helper enforces exact-output; leftover dust is swept into the core vault.<br/>• User-facing `deposit()` is `nonReentrant`.<br/>• No explicit slippage cap on the debt→collateral swap (uses `type(uint256).max`) but a post-deposit invariant verifies that debt + fee is fully covered – acceptable (info). |
| `DLoopIncreaseLeverageBase` | ✅      | • Mirrors security properties of `DepositorBase`; subsidy bounded by `maxSubsidyBps`.<br/>• Cannot exceed target leverage due to pre- and post-checks.                                                                                                                                                                                                                                                  |
| `DLoopDecreaseLeverageBase` | ✅      | • Collateral is withdrawn only after debt is repaid, reducing re-entrancy surface.<br/>• User-supplied `minReceivedAmount` guards against sandwich attacks.                                                                                                                                                                                                                                             |
| `DLoopRedeemerBase`         | ✅      | • Permissionless flash-redeem guarded by lender / initiator checks.<br/>• Ensures shares burned match collateral withdrawn, preventing dust siphoning.<br/>• Emits detailed events aiding off-chain accounting.                                                                                                                                                                                         |

No critical vulnerabilities were found in the dLoop suite. Given the complexity of the leverage math, formal verification or exhaustive fuzzing around extreme price/interest scenarios is recommended.

**dLoop Recommendations**
1. Add a circuit-breaker (`Pausable`) to `DLoopCoreBase` so deposits/flash actions can be halted in case of an upstream lending-pool issue (low severity, best practice).
2. Monitor the growth of `existingDebtTokens`; looping over this array is O(n) and could become gas-heavy if many assets are ever supported (info).

### Vesting & Rewards

- **Overview**: This is a collection of utility contracts for managing token vesting schedules and reward distributions.
- **Contract Interactions**:
  - `ERC20VestingNFT`: Allows users to lock an ERC20 token for a fixed period in exchange for an NFT that represents their vesting position.
  - `RewardClaimable`: An abstract contract that provides a standardized framework for claiming rewards from external protocols (e.g., Aave). The `DStakeRewardManagerDLend` is a concrete implementation.
- **Threat Model (STRIDE)**:
  - **Spoofing**: For `RewardClaimable`, a bug in the `_claimRewards` implementation could allow it to be called by an unauthorized address or in a way that directs rewards incorrectly.
  - **Tampering**: A logic bug in `ERC20VestingNFT` could allow a user to bypass the vesting period and withdraw tokens early. An integration risk with the external rewards contract that `RewardClaimable` interacts with could also be exploited.
  - **Repudiation**: N/A.
  - **Information Disclosure**: N/A.
  - **Denial of Service**: A flaw in `ERC20VestingNFT` could permanently lock users' tokens, even after the vesting period has ended, due to an incorrect state transition or a bug in the withdrawal logic.
  - **Elevation of Privilege**: A bug in `ERC20VestingNFT` could allow a user to perform an action they aren't entitled to, such as transferring a soul-bound NFT. A flaw in a `RewardClaimable` implementation could allow an attacker to escalate privileges and change fee parameters.

#### Findings & Observations (Contract-level) — Vesting & Rewards

| Contract          | Result | Notes                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RewardClaimable` | ✅      | • Treasury fee bounded by `maxTreasuryFeeBps` (≤ 100 %).<br/>• `compoundRewards()` is intentionally permissionless; caller must deposit `exchangeAsset`, so harvesting cannot be griefed for free.<br/>• Reentrancy guard prevents double-spend on reward claim.<br/>• Role-gated setters protect treasury parameters.               |
| `ERC20VestingNFT` | ✅      | • `deposit`, `redeemEarly`, and `withdrawMatured` are all `nonReentrant`.<br/>• Matured NFTs become soul-bound via `_update` override; transfer attempts revert.<br/>• Early exit burns NFT and refunds principal; accounting updates correctly.<br/>• Owner-configurable supply/threshold parameters validated for non-zero values. |

No material security issues were identified in these utility contracts. Residual risks relate to governance of configurable parameters (e.g., setting `maxTotalSupply` too low could block deposits), which are acceptable design trade-offs.

## Overall Assessment

No critical or high-severity vulnerabilities were discovered across the audited scope. All observations are informational or address best-practice hardening and gas-efficiency.

### Suggested Next Steps
1. Expand fuzz-testing around dLoop's leverage adjustment paths, especially under volatile oracle prices.
2. Perform mainnet-fork simulation of oracle outages to validate circuit-breaker and liquidation mechanics.

