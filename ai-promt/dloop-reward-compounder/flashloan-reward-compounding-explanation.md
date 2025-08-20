# Flashloan-based reward compounding for DLoopCoreDLend (flashloan-reward-compounding)

## Problem description (input)

You want to implement a bot that auto-calls `compoundRewards()` on `DLoopCoreDLend.sol`. The reward token is `dUSD`. The bot should use a flashloan/flashmint technique to perform the reward compounding exchange, then repay the flashloan and keep the surplus profit.

We sometime call it reward claiming as it actually a process to help the vault claims the reward, then instead of keeping the reward (the vault has nothing to do it with), the vault allows to exchange the claimed reward with the token/assets it needs, then the vault has a process to compound these exchanged assets to the share's value.

- That's why sometime it called `reward-claiming`, sometime called `reward-compounding`.

High-level idea (user-provided):

- Flashloan X dUSD
- Swap X dUSD -> Y sfrxUSD
- Mint S shares by depositing sfrxUSD to DLoopCore (not via periphery), receive S shares and K dUSD (borrowed debt)
- Use S shares to claim the reward (dUSD rebase), get Z dUSD reward amount
- If (Z + K) < X (+ flash fees + swap costs) revert
- Otherwise, repay flashloan and keep (Z + K - X - fees) as profit

This document formalizes and analyzes that approach, gives a numeric example and an actionable pseudocode that another model can implement.

---

## Summary of contract behavior relevant to the flow

- `RewardClaimable.compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver)`
  - `amount` is the amount of `exchangeAsset` transferred from caller to vault. For `DLoopCoreDLend` the `exchangeAsset` is the vault shares (the ERC4626 token representing shares).
  - The vault calls `_claimRewards(rewardTokens, address(this))`, which in `DLoopCoreDLend` calls the external rewards controller and transfers claimed reward tokens to the vault. After fees, the vault transfers net rewards to `receiver`.
  - After claiming, `_processExchangeAssetDeposit(amount)` is called; for `DLoopCoreDLend` this burns the shares on the vault (`_burn(address(this), amount)`).

- `DLoopCoreBase._deposit(caller, receiver, assets, shares)` mints vault shares and internally supplies collateral and borrows the debt token; it transfers the borrowed debt token to `receiver`. In `DLoopCoreBase._supplyAndBorrowFromPoolImplementation` the borrowed debt amount (call it `K`) is computed so that the vault maintains its target leverage given the supplied assets.

Implications:

- To call `compoundRewards` you must transfer vault shares (the `exchangeAsset`) into the vault. The vault expects shares, not dUSD.
- Depositing collateral into the vault mints shares and also causes the vault to borrow `K` dUSD and send it to the depositor/receiver.

---

## Formalized flow (corrected profit condition)

Notation:

- X = flashloaned dUSD (amount borrowed up-front from flash lender)
- fee = flashloan fee in dUSD
- swapCosts = swap fees + slippage (dUSD-equivalent loss when swapping)
- Y = amount of sfrxUSD received after swapping X dUSD (post-swap costs)
- S = shares minted when depositing Y sfrxUSD to `DLoopCore` (representing vault shares)
- K = dUSD amount transferred to depositor by the vault during deposit (borrowed debt from pool)
- Z = dUSD rewards claimed when calling `compoundRewards(S, [dUSD], receiver)` (gross rewards)
- tBps = treasury fee basis points; netZ = Z - treasuryFee(Z) = Z * (1 - tBps/10000)

Profit check (must include all costs):

profit = K + netZ - (X + fee + swapCosts)

Break-even condition: K + netZ >= X + fee + swapCosts

Note: earlier user inequality (Z + K < X) is inverted and missing fees; the correct form above accounts for flash fee and swap costs and treasury fee on rewards.

---

## Numeric example (intuitive table)

Assumptions (example numbers):

- X = 100,000 dUSD (flashloan)
- flash fee = 0.08% => fee = 80 dUSD
- swap slippage+fee = 0.10% => Y = 99,900 sfrxUSD (we assume 1:1 price for simplicity)
- Target leverage T = 3x => K ≈ Y *(T-1)/T = Y* 2/3 = 66,600 dUSD (approx)
- Gross rewards Z that will be claimed by burning S shares = 40,000 dUSD
- Treasury fee tBps = 100 (1 bps = 0.01%?) Note: contract uses BasisPointConstants where 100 = 1 bps, 10_000 = 1%? (read on-chain). For this example assume treasury = 1% => netZ = 40,000 * 0.99 = 39,600 dUSD

Step-by-step table:

| Step | Description | dUSD change (this contract) | Explanation |
|---|---:|---:|---|
| 0 | Start | 0 | Start balance 0
| 1 | Flashloan X | +100,000 | flashloan borrowed; fee owed later = 80
| 2 | Swap X -> sfrxUSD | -100,000 dUSD, +99,900 sfrxUSD | 0.10% swap cost
| 3 | Deposit sfrxUSD -> mint shares | -99,900 sfrxUSD, +S shares, +66,600 dUSD (K) | Vault supplies collateral and borrows K to this contract
| 4 | Call compoundRewards(S, [dUSD], this) | +40,000 gross dUSD -> vault takes treasury; contract receives netZ=39,600 | Vault burns S shares; fee applied
| 5 | Repay flashloan | -100,080 (100,000 + 80 fee) | Pay flash + fee
| 6 | End | +6,120 | Profit = 66,600 + 39,600 - 100,080 = 6,120 dUSD

Interpretation: with these numbers profit is positive. If Z is smaller or slippage higher or target leverage lower, profit may be negative. Always include all fees and slippage in estimates.

---

## Practical checks, constraints and risks

- `exchangeThreshold`: `compoundRewards` reverts if `amount < exchangeThreshold`. Ensure `S >= exchangeThreshold()` or use `previewDeposit` to calculate expected shares and supply enough.
- `isTooImbalanced()`: `DLoopCoreBase` blocks deposit/mint if leverage is out of bounds. Verify `maxDeposit(address(this)) > 0` before attempting deposit.
- Race conditions / front-running: `compoundRewards` claims all available rewards from the external controller. Another bot can claim rewards before you; this can make your run unprofitable. Consider private mempool or MEV protection.
- Price and decimals: `K` depends on oracles and token decimals. Use `CORE.previewDeposit(Y)` and `CORE.previewMint` or `DLoopCoreLogic` helper math to estimate `K` precisely before executing.
- Swap slippage, aggregator execution failure and approvals must be handled. Use `minExpectedOut` guards for swaps.
- Treasury fee: compute `getTreasuryFee(Z)` on-chain to understand `netZ` rather than guessing.
- Flash lenders may have additional constraints (maxLoan, token allowances, etc.).
- If `deposit` mints shares to `receiver`, some vaults transfer the borrowed dUSD to the `receiver` — ensure you call deposit with `receiver = address(this)` to receive the borrowed `K`.

---

## Implementation outline & pseudocode (Markdown) for another AI to implement

Below is a compact, step-by-step pseudocode blueprint. It is written to be unambiguous and implementable.

```solidity
contract DLendRewardsClaimerBot is IERC3156FlashBorrower {
    // Config (set in constructor or constants)
    IERC20 constant DUSD = IERC20(/* dUSD address */);
    IERC20 constant SFRX = IERC20(/* sfrxUSD address */);
    IDLoopCoreDLend constant CORE = IDLoopCoreDLend(/* core address */);
    IERC3156FlashLender constant FLASH = IERC3156FlashLender(/* lender address */);
    address constant SWAP_AGG = /* aggregator address */;

    // Entrypoint to run one cycle
    function run(uint256 flashAmount, bytes calldata swapCallData, uint256 minSfrxOut) external {
        // optional prechecks
        require(CORE.maxDeposit(address(this)) > 0, "deposit disabled");
        // encode swapCallData + minSfrxOut as flash callback data
        FLASH.flashLoan(this, address(DUSD), flashAmount, abi.encode(swapCallData, minSfrxOut));
    }

    // Flash loan callback
    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata data) external returns (bytes32) {
        require(msg.sender == address(FLASH), "invalid lender");
        require(token == address(DUSD), "invalid token");

        (bytes memory swapCallData, uint256 minSfrxOut) = abi.decode(data, (bytes, uint256));

        // 1) Swap DUSD -> sfrxUSD via aggregator; enforce minOut
        DUSD.approve(SWAP_AGG, amount);
        // call swap aggregator with swapCallData (must be crafted off-chain)
        (bool ok,) = SWAP_AGG.call(swapCallData);
        require(ok, "swap failed");
        uint256 sfrxBalance = SFRX.balanceOf(address(this));
        require(sfrxBalance >= minSfrxOut, "slippage");

        // 2) Deposit sfrxUSD to CORE to mint shares and receive borrowed dUSD K
        SFRX.approve(address(CORE), sfrxBalance);
        // Use ERC4626 `deposit(uint256 assets, address receiver)` or `mint` depending on core API
        uint256 shares = CORE.deposit(sfrxBalance, address(this));

        // 3) Call compoundRewards with the minted shares to claim dUSD
        IERC20(address(CORE)).approve(address(CORE), shares);
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(DUSD);
        CORE.compoundRewards(shares, rewardTokens, address(this));

        // 4) Repay flash loan: amount + fee
        uint256 totalDebt = amount + fee;
        require(DUSD.balanceOf(address(this)) >= totalDebt, "not enough to repay");
        DUSD.approve(address(FLASH), totalDebt);

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}
```

Notes for implementer:

- The `swapCallData` is crafted off-chain (e.g., 1inch calldata) to swap exactly `amount` of dUSD to sfrxUSD and must include a `minSfrxOut` to guard slippage.
- Use `CORE.previewDeposit(sfrxBalance)` or `CORE.previewMint` to predict `shares` and estimate `K` (the contract's dUSD balance change after deposit).
- After deposit, measure the delta of dUSD to calculate K: (dUSD balance after deposit) - (dUSD balance before deposit minus borrowed amount if any). Simpler: record dUSD balance before flash and after deposit to isolate K.
- Ensure approvals for `CORE` (shares) and for `FLASH` to take repayment.
- Do on-chain queries for `treasuryFeeBps()` and `exchangeThreshold()` to compute netZ and guarantee `shares >= exchangeThreshold`.

---

## Final checklist to make safe profitable runs

- Off-chain: compute estimated Y (sfrx out), `shares = CORE.previewDeposit(Y)`, estimated K using `DLoopCoreLogic` formulas or preview functions, estimated Z (hard to know; use historical reward rate or call the rewards controller query API), compute netZ after `treasuryFeeBps`.
- Ensure K + netZ >= X + fee + swapCosts before sending the transaction.
- Use small test flash amounts on testnet and monitor front-running and slippage.
- Consider private RPC/mempool or MEV protection to avoid front-runners.

---

If you want, I can now:

- produce an on-chain-ready Solidity skeleton (with correct imports and interfaces) for the bot, or
- write the off-chain helper (scripts) to calculate expected `K`, `S`, `Z` and profit thresholds per run.
