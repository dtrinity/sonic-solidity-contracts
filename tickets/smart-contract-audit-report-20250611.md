# Smart Contract Audit Report (2024-06-11)

Performed by o3.

This report documents the findings from an audit of the dTRINITY Solidity code-base. The scope includes all contracts under `contracts/` **except** `dlend`, `testing`, and any `mocks`.

---

# Detailed Findings

## Common Libraries (`contracts/common`)

These libraries are foundational building blocks used by multiple products.  The main threat model is:

* An attacker interacts with contracts that inherit or link against these libraries and attempts to exploit arithmetic, re-entrancy, or logic errors to drain funds, lock funds, or break invariants.
* Libraries are assumed to run **inside** the context of higher-level vaults/wrappers; therefore, faults here can propagate broadly.

### SwappableVault.sol

#### Finding 1 – Incorrect balance-delta direction may cause perpetual revert (Reliability / Denial-of-Service)

```80:110:contracts/common/SwappableVault.sol
        // Make sure the received output token amount is exactly the amount out
        if (outputTokenBalanceAfter < outputTokenBalanceBefore) {
            uint256 receivedOutputTokenAmount = outputTokenBalanceBefore -
                outputTokenBalanceAfter;
            if (receivedOutputTokenAmount != amountOut) {
                revert ReceivedOutputTokenAmountNotEqualAmountOut(
                    receivedOutputTokenAmount,
                    amountOut
                );
            }
        } else {
            revert OutputTokenBalanceNotIncreasedAfterSwap(
                outputTokenBalanceBefore,
                outputTokenBalanceAfter
            );
        }
```

* The logic expects `outputTokenBalanceAfter < outputTokenBalanceBefore`, which would imply the contract **lost** output tokens.  For a standard *exact-output* swap (or any swap where the contract receives tokens), `outputTokenBalanceAfter` should be **greater** than `outputTokenBalanceBefore`.
* As written, successful swaps will hit the `else` branch and **revert**, making all inheriting contracts unusable.
* STRIDE: Denial of Service (DoS).
* SWC-113 (DoS With Failed Call) is applicable.

**Remediation:**  Reverse the comparison so that the function checks `outputTokenBalanceAfter > outputTokenBalanceBefore`, then compute `receivedOutputTokenAmount = outputTokenBalanceAfter - outputTokenBalanceBefore`.

---

### SwapHelper.sol

#### Finding 2 – Potential 256-bit overflow in price calculation (Integrity)

The function `estimateInputAmountFromExactOutputAmount` multiplies two 256-bit prices and a `10 ** decimals` factor before dividing.  With high-price assets (e.g., staked ETH) and 18-decimals tokens, the intermediate product can exceed `2**256-1`, leading to wrap-around.

* STRIDE: Tampering / Integrity.
* SWC-101 (Integer Overflow and Underflow).

**Remediation:**  Use OpenZeppelin's `SafeCast`/`Math.mulDiv` (solidity 0.8.20 has `Math.mulDiv`) or perform division first where possible to keep the intermediate value bounded.

---

### RescuableVault.sol

No critical issues identified.  Consider adding an event for successful token rescue to improve off-chain monitoring.

---

### SupportsWithdrawalFee.sol, Erc20Helper.sol, BasisPointConstants.sol, IAaveOracle.sol, IMintableERC20.sol

No security-relevant findings in this batch.

---

## dStable Core (`contracts/dstable/*`)

### Threat Model
* Handles issuance and redemption of the protocol's USD-pegged token (`dStable`).  Incorrect logic can lead to under-collateralisation or permanent loss of funds.
* Manages collateral pools, AMO vaults, and fee collection.  Any mis-pricing or unchecked transfer can leak collateral value.

---

### Issuer.sol

#### Finding 3 – `issue()` allows depositing *unsupported* collateral tokens (High / Integrity)
```30:57:contracts/dstable/Issuer.sol
        // Transfer collateral directly to vault
        IERC20Metadata(collateralAsset).safeTransferFrom(
            msg.sender,
            address(collateralVault),
            collateralAmount
        );
```
* The function sends tokens straight to `collateralVault` **without** calling `collateralVault.deposit`, thereby bypassing the `UnsupportedCollateral` check maintained in `CollateralVault`.
* An attacker can supply a token **not** tracked in `_supportedCollaterals`.  The oracle may still return a price (possibly manipulated), allowing the attacker to mint `dStable` while the vault's accounting logic silently ignores the new asset (because `_totalValueOfSupportedCollaterals()` only sums *supported* tokens).
* Result: system becomes under-collateralised and may be drained during redemption.
* STRIDE: Tampering / Integrity; SWC-135 (Code With No Effects) indirectly applies.

**Remediation:** Replace the direct transfer with `collateralVault.deposit(...)` or enforce `isCollateralSupported(collateralAsset)` inside `Issuer.issue`.

---

### CollateralHolderVault.sol

#### Finding 4 – `exchangeCollateral` enables toxic-asset swap attack (High / Economic)
```38:58:contracts/dstable/CollateralHolderVault.sol
        // We must take in a collateral that is supported
        require(
            _supportedCollaterals.contains(toCollateral),
            "Unsupported collateral"
        );
```
* The function **only** checks that `toCollateral` is supported.  `fromCollateral` can be *any* ERC-20 as long as an oracle price exists.
* An attacker can:
  1. Manipulate or flash-loan the oracle price of `fromCollateral` to an inflated value.
  2. Call `exchangeCollateral`, depositing a small amount of overpriced `fromCollateral`.
  3. Receive high-value `toCollateral` (which *is* supported) from the vault.
* Because `fromCollateral` is now stuck in the vault and **not** counted by `_totalValueOfSupportedCollaterals`, the system loses real collateral permanently.
* STRIDE: Elevation of Privilege / Economic; SWC-103 (Floating Pragma is less relevant) – more akin to SWC-133 (Signature Malleability) but economic.

**Remediation:** Require that **both** collateral tokens are supported and/or cap oracle slippage.  Consider a price sanity window or TWAP.

---

### AmoManager.sol

#### Finding 5 – Return value of ERC-20 transfers is unchecked (Low / Reliability)
```60:78:contracts/dstable/AmoManager.sol
        dstable.transfer(amoVault, dstableAmount);
        // ...
        dstable.transferFrom(amoVault, address(this), dstableAmount);
```
* `IMintableERC20` (an OZ-based token) *does* revert on failure, but checking the boolean return is best-practice and protects against non-standard implementations.
* Silent failure would break supply invariants.

**Remediation:** Use `SafeERC20`'s `safeTransfer` / `safeTransferFrom`.

---

### Basis Point Representation (multiple files)

#### Finding 6 – Non-standard "basis point" scaling may cause configuration mistakes (Medium)
* `BasisPointConstants.ONE_BPS = 100`, i.e. 1 bp = 100 units, so 100 bp = 1 %.  Most DeFi code uses **1 bp = 1**.  External integrators or governors could unintentionally set a fee 100× smaller/larger.
* Affects fee setters in `RedeemerWithFees`, withdrawal-fee libraries, etc.

**Remediation:** Document clearly in docs/UI, or migrate to conventional 1e4 = 100 % scaling.

---

### Miscellaneous Notes / Informational
* `ERC20StablecoinUpgradeable.setNameAndSymbol` breaks EIP-2612 domain separation; outstanding permits become invalid.  Consider revoking or black-listing permits on name change. *(Informational)*
* `CollateralHolderVault.exchangeCollateral` lacks re-entrancy guard; although only strategy role can call, adding `nonReentrant` is cheap defense-in-depth.
* Gas-exhaustion risk: `_supportedCollaterals`/`_amoVaults` unbounded iteration inside state-changing functions (e.g., `availableProfitInBase`).  Monitor size or add pagination.

---

## Oracle Aggregator & Odos Swap (`contracts/oracle_aggregator/**`, `contracts/odos/**`)

### Threat Model
* Oracle wrappers supply the single source-of-truth for USD-denominated prices across the protocol.  Failing or malicious feeds can lead to mis-minting or bad debt.
* The Odos swap helpers temporarily custody user/strategy funds; incorrect allowance or arbitrary call data could leak tokens.

---

### OracleAggregator.sol

#### Finding 7 – No guard against setting oracle for the **zero address** (Low)
* `setOracle(asset, oracle)` lets a manager register an oracle for `asset = address(0)`.  Down-stream logic may accidentally request the **USD** price (commonly represented by address(0)).  A malicious oracle could therefore skew *all* USD-denominated math.
* STRIDE: Spoofing / Tampering.

**Remediation:**  Require `asset != address(0)` and/or reserve `address(0)` exclusively for `BASE_CURRENCY`.

---

### BaseChainlinkWrapper.sol

#### Finding 8 – `heartbeatStaleTimeLimit` can be set to extremely large values (Medium)
* Anyone with `ORACLE_MANAGER_ROLE` may call `setHeartbeatStaleTimeLimit`.  Setting an unreasonably high limit (> weeks) would treat **very stale** Chainlink feeds as "alive," silently corrupting price inputs used for redemptions and AMO accounting.
* While role-gated, this widens the blast-radius of a compromised/erroneous governance transaction.

**Remediation:**  Cap the time-limit to a sane maximum (e.g., 1h) or emit an event + timelock.

---

### ChainlinkDecimalConverter.sol

#### Finding 9 – Answer rounding **truncates** rather than rounds (Informational)
* Integer division `answer / scalingFactor` always floors the result, introducing a small downward bias in prices—especially for low-priced assets when down-scaling from 18→8 decimals.
* Bias is < 1 "least significant digit" and thus negligible; document for clarity.

---

### OdosSwapUtils.sol

#### Finding 10 – Residual unlimited allowance to router (Medium)
```15:35:contracts/odos/OdosSwapUtils.sol
        ERC20(inputToken).approve(address(router), maxIn);
        (bool success, bytes memory result) = address(router).call(swapData);
```
* The library approves **`maxIn`** *once*, but **never resets** or reduces the allowance after the swap.  If `maxIn` is the full balance or a very large number, the router could pull additional tokens in later calls (e.g., router upgrade bug or governance hack).
* STRIDE: Tampering / Elevation of Privilege; SWC-124 (Arbitrary from/to Addresses).

**Remediation:**  Use the pattern `approve(..., 0)` → `approve(..., maxIn)` → perform swap → `approve(..., 0)`.

#### Finding 11 – Hidden re-entrancy surface via user-supplied calldata (Low)
* The contract blindly forwards `swapData` into a low-level `.call`.  If Odos launches a new function that re-enters the calling contract (e.g., via callback hooks), the outer contract must handle it.  Current `OdosSwapper` has **no** re-entrancy guard.

**Remediation:**  Add `nonReentrant` modifier (from OZ) to `executeSwapOperation` or rely on upstream vault protections.

---

### Miscellaneous Notes
* Spelling: `excuteSwapOperation` (missing 'e') may confuse auditors & static-analysis tools—rename to `executeSwapOperation` and deprecate old.
* Oracle wrappers rely on unsigned math; `price * BASE_CURRENCY_UNIT` can overflow if `price ≫ 1e20`.  Consider `SafeCast` or `mulDiv` as raised in Batch-1.

---

## Vault Suite (`contracts/vaults/**`)

Sub-systems reviewed in this batch:
* **Static aToken Wrapper** – non-rebasing ERC-4626 wrapper for Aave V3 interest-bearing assets
* **dLoop** leverage vault (core + periphery)
* **dPool / dStake / Rewards / Vesting** ancillary vaults

---

### StaticATokenLM.sol

#### Finding 12 – ECDSA signature malleability in meta-tx (High)
```130:165:contracts/vaults/atoken_wrapper/StaticATokenLM.sol
            require(
                depositor ==
                    ecrecover(digest, sigParams.v, sigParams.r, sigParams.s),
                StaticATokenErrors.INVALID_SIGNATURE
            );
```
* The `ecrecover` result is accepted **without** enforcing `s <= secp256k1n/2` and `v ∈ {27,28}`.  A valid signature can thus be replayed with `(s' = n ‑ s, v' = 27 ^ 1)`.
* Attackers could front-run `metaDeposit` / `metaWithdraw` calls with an alternate `(r,s',v')`, causing unexpected side-effects or denial-of-service against the original signature.
* STRIDE: Spoofing. SWC-117.

**Remediation:**  Use `ECDSA.recover` from OpenZeppelin (already vendored in repo) or manually enforce `s` & `v` parity checks.

#### Finding 13 – Silent `permit()` failure bypasses allowance checks (Low)
```145:158:contracts/vaults/atoken_wrapper/StaticATokenLM.sol
            try IERC20WithPermit(...).permit(...) {}
            catch {}
```
* Swallows **all** errors.  If permit reverts (wrong sig / expired), the later `_deposit` will revert with a generic ERC-20 allowance error, masking root cause and hindering UX/debugging.
* **Remediation:**  Bubble the revert reason or at least emit an event when `permit` fails.

---

### DLoop Core / Periphery

#### Finding 14 – Flash-loan leverage increase can burn user collateral if `convert*` price oracle is stale (Medium)
* `_increaseLeverageWithFlashLoan` converts collateral ↔ debt via `convertFromTokenAmountToBaseCurrency` (oracle priced) **without freshness check**.  If oracle is paused or manipulated (momentary glitch), the conversion may under-estimate required flash-loan amount, causing the flash-loan callback to revert and **lock collateral** the user already transferred.
* STRIDE: Tampering / DoS.

**Remediation:**  Add staleness window (`updatedAt + grace < block.timestamp`) or slippage bounds when computing `requiredFlashLoanAmount`.

#### Finding 15 – Debt-token `forceApprove` opens grief vector (Informational)
* Contract uses Solmate's `forceApprove` which first sets allowance to 0 then to new value.  Some ERC-20s (USDT-like) revert on changing non-zero → non-zero; this is fine.  But if token **forces non-zero to zero** revert (OLD USDT bug), flash-loan might brick.

---

### ERC20VestingNFT.sol

#### Finding 16 – Soul-bound logic bypass via re-minting (Low)
* After `withdrawMatured`, NFT becomes "matured" but **remains in circulation** (transfer is blocked).  An attacker can call `redeemEarly` **before** `vestingPeriod` ends, burning the NFT and freeing the tokenId; later deposits can **re-mint** the same id, resetting maturity.
* While ids are incremental (`_tokenIdTracker.increment()`), burning shrinks supply; nothing prevents recycling ids through classic `ERC721Enumerable` gaps.
* Impact limited; treat as Low.

---

### Miscellaneous
* **RayMathExplicitRounding** uses inline assembly shifts; unit-tests show no overflow but future compiler upgrades may optimise differently—consider `unchecked {}` blocks.
* **atoken_wrapper/ERC20.sol** duplicates OZ's ERC-20; to avoid divergence, import OZ unless gas-size critical.

---

## System-Level Invariants & Final Observations

This batch focuses on how previously-audited modules interact and whether global financial invariants hold under edge-cases.

### Invariant A – Collateral ≥ (Circulating + AMO) dStable Supply

* _Contracts involved:_ `Issuer`, `CollateralVault`, `AmoManager`, AMO vaults.
* **Path to Violation:**
  1. `Issuer.issue()` mints dStable strictly against newly-deposited collateral – OK.
  2. `AmoManager.allocateAmo()` _moves_ dStable to AMOs **without** burning, but does **not** require extra collateral.  The accounting relies on each AMO vault selling the dStable for collateral, thereby self-backing.
  3. If an AMO vault becomes insolvent (e.g., strategy loss) the system has no emergency circuit to claw back or slash the AMO allocation.
* **Finding 17 – AMO insolvency can leave system under-collateralised (Medium)**
  * `availableProfitInBase()` can go negative yet nothing blocks further issuance or redemptions.

_Remediation:_ introduce global health check `require(totalCollateralValue() ≥ circulatingDstable())` at issuance/redemption time **or** pause redemptions if any AMO's profit is negative beyond threshold.

---

### Invariant B – Consistent Base-Currency Units Across Oracles

* Several modules assume `BASE_CURRENCY_UNIT` is identical (passed in constructors).  If an oracle wrapper is mis-configured with different decimals:
  * `OracleAggregator.setOracle()` validates equality ✅ (good).
  * **But** wrapper contracts themselves expose `BASE_CURRENCY_UNIT` that is set in constructor.  A mis-deployed wrapper could slip through governance review.
* **Finding 18 – Deployment-time mis-configuration risk (Low)**
  * No on-chain cross-check after deployment; a wrong value silently skews prices.

_Remediation:_ Add `sanityCheckOracle(address asset, uint expectedPrice)` governance util or emit event comparing league values.

---

### Invariant C – Fee Math Uses Shared `BasisPointConstants`

* _Observation:_ All fee logic references same constants; previous Batch-2 finding about non-standard scaling already noted.  No new cross-product issues.

---

### Invariant D – Re-entrancy Surfaces Across Vault & Swapper Calls

* Non-reentrant modifiers are **mostly** present (`DLoopCoreBase`, `DStake`, `VestingNFT`).
* The only uncovered low-level call is the Odos swap (Finding 11).  No further cross-impact identified.

---

# Consolidated Audit Summary

_This section aggregates every finding, shows what was and was not flagged, and lists open gaps/future work._

## Summary of Findings

| #   | Module / File             | Severity | Complexity | Short Description                                     |
| --- | ------------------------- | -------- | ---------- | ----------------------------------------------------- |
| 1   | SwappableVault            | **High** | Low        | Post-swap balance check is inverted → vault unusable  |
| 2   | SwapHelper                | Medium   | Medium     | Price-quote overflow risk                             |
| 3   | Issuer                    | **High** | Low        | Allows minting against unsupported collateral         |
| 4   | CollateralHolderVault     | **High** | Medium     | Toxic-asset swap (only destination token validated)   |
| 5   | AmoManager                | Low      | Low        | ERC-20 transfer returns unchecked                     |
| 6   | BasisPointConstants       | Medium   | Low        | Non-standard basis-point scaling (×100)               |
| 7   | OracleAggregator          | Low      | Low        | Oracle can be mapped to `address(0)` asset            |
| 8   | BaseChainlinkWrapper      | Medium   | Low        | Unlimited stale-price window setting                  |
| 9   | ChainlinkDecimalConverter | Info     | n/a        | Down-rounding price bias                              |
| 10  | OdosSwapUtils             | Medium   | Low        | Unlimited router allowance persists after swap        |
| 11  | OdosSwapper               | Low      | Low        | No re-entrancy guard on user-supplied call-data       |
| 12  | StaticATokenLM            | **High** | Low        | Signature malleability in meta-tx verification        |
| 13  | StaticATokenLM            | Low      | Low        | Silent `permit` failure masks root cause              |
| 14  | DLoop Leverage            | Medium   | Medium     | Oracle staleness risk in flash-loan sizing            |
| 15  | DLoop Leverage            | Info     | n/a        | `forceApprove` grief vector with non-standard ERC-20s |
| 16  | ERC20VestingNFT           | Low      | Low        | Soul-bound bypass via burn / re-mint                  |
| 17  | Systemic (AMO)            | Medium   | Medium     | Insolvent AMO can break backing invariant             |
| 18  | Oracle Deployment         | Low      | Low        | Mis-configured `BASE_CURRENCY_UNIT` risk              |

---

## Audit Coverage

```text
contracts
├── common                      ✓ ⚠
├── dstable                     ✓ ⚠  (Issuer, CollateralVault, Redeemer, AmoManager …)
├── oracle_aggregator           ✓ ⚠
├── odos                        ✓ ⚠
├── vaults
│   ├── atoken_wrapper          ✓ ⚠
│   ├── dloop (core, periphery) ✓ ⚠
│   ├── dpool                   ✓ ✓
│   ├── dstake                  ✓ ✓
│   ├── vesting                 ✓ ⚠
│   └── rewards_claimable       ✓ ✓
├── dlend                       –  (out of scope)
├── testing                     –  (out of scope)
└── mocks                       –  (out of scope)
```
Legend  ✓ = reviewed   ⚠ = findings   – = deliberately out-of-scope

---

## Potential Gaps & Follow-Ups

1. **AMO Strategy Loss Events** – need property-based tests simulating large negative PnL to ensure redemptions pause before under-collateralisation (Finding 17).
2. **Upgrade Path Review** – proxy admin controls & storage-layout checks for `ERC20StablecoinUpgradeable` were not audited.
3. **Cross-Chain Scenarios** – bridging logic (if any) remains unaudited; oracle discrepancies across chains could magnify risks.
4. **Extreme Governance Inputs** – fuzz governance-set parameters (fees = max, stale windows = 0, etc.).
5. **Event Coverage** – add missing events (`RescuableVault.rescueToken`, `permit` failure paths) for off-chain monitoring.
6. **Unit Tests / Scripts** – create `tickets/test-vectors.md` reproducing every High/Medium issue for CI regression.

---

## Additional Possible Issues

* **Rounding Loss in ERC-4626 Conversions** – small share/asset conversions (`previewRedeem`, etc.) may round in favour of vault, causing dust accumulation. Suggested: use OZ's `mulDiv` for exact arithmetic or add minimum-dust burn.
* **Withdrawal Fee Underflow** – `SupportsWithdrawalFee._getNetAmountAfterFee` subtracts `fee` unchecked; with assets `< fee`, user could revert. A sanity check would improve UX.
* **Permit Replay Across Chains** – identical domain separator in a forked chain could allow cross-chain signature replay. Use chain-id in `DOMAIN_SEPARATOR` (already implicit in EIP-712 but verify implementations).
* **Lack of Pause Guards on Issuance** – while `Issuer` checks collateral, there is no global "circuit-breaker" role to pause issuance in emergencies unrelated to collateral (e.g., oracle outage). Consider `Pausable`.
* **EnumerableSet Iteration Gas Risk** – functions iterating over `_supportedCollaterals` or `_amoVaults` run `O(N)`. If governance adds many assets/vaults, gas cost may exceed block-gas limit; add pagination or hard-cap.