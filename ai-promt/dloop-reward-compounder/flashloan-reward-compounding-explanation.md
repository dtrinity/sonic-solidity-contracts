# Flashloan-based reward compounding for DLoopCoreDLend (flashloan-reward-compounding)

## Problem description (input)

You want to implement a bot that auto-calls `compoundRewards()` on `DLoopCoreDLend.sol`. The reward token is `dUSD`. The bot should use a flashloan/flashmint technique to perform the reward compounding exchange, then repay the flashloan and keep the surplus profit.

We sometime call it reward claiming as it actually a process to help the vault claims the reward, then instead of keeping the reward (the vault has nothing to do it with), the vault allows to exchange the claimed reward with the token/assets it needs, then the vault has a process to compound these exchanged assets to the share's value.

- That's why sometime it called `reward-claiming`, sometime called `reward-compounding`.

High-level idea (threshold-based flow, corrected):

- Read `exchangeThreshold` from the core vault.
- Target `amount = exchangeThreshold` shares for `compoundRewards()` (no auction; FCFS favors minimum valid amount).
- Compute required collateral using `previewMint(exchangeThreshold)`.
- Flash-mint/flashloan dUSD and perform an exact-out swap: dUSD -> collateral for exactly the required collateral (+ small slippage buffer).
- Mint exactly `exchangeThreshold` shares via `CORE.mint(exchangeThreshold, receiver)`; this also transfers borrowed dUSD (`K`) to the bot.
- Approve and call `compoundRewards(exchangeThreshold, [dUSD], receiver)`; receive net reward dUSD.
- Repay flash amount + fee; keep the surplus as profit.

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

## Formalized flow (threshold-based)

Notation:

- X = flashloaned dUSD (amount borrowed up-front from flash lender; should at least cover swap max input + fee)
- fee = flashloan fee in dUSD
- swapCosts = swap fees + slippage (dUSD-equivalent loss when swapping)
- Y = exact collateral acquired via swap (targeted to mint exactly `S`)
- S = shares to mint, set to `exchangeThreshold()`
- K = dUSD amount transferred to depositor by the vault during deposit (borrowed debt from pool)
- Z = dUSD rewards claimed when calling `compoundRewards(S, [dUSD], receiver)` (gross rewards)
- tBps = treasury fee basis points; netZ = Z - treasuryFee(Z) = Z * (1 - tBps/10000)

Profit check (must include all costs):

profit = K + netZ - (X + fee)

Notes:

- Use an exact-out swap (dUSD -> collateral) so swapCosts are implicit in X (you pay whatever dUSD input the aggregator requires up to your max). If you model costs explicitly off-chain, expand the check to include them, i.e., `X = swapInput + otherCosts`.
- Break-even: `K + netZ >= X + fee`.

Note: earlier user inequality (Z + K < X) is inverted and missing fees; the correct form above accounts for flash fee and swap costs and treasury fee on rewards.

---

## Numeric intuition (why threshold works)

At target leverage T (e.g., 3x), a mint of S shares uses collateral with dollar value C and borrows K dUSD such that:

- C collateral value mints S shares and the vault borrows K ≈ C * (T-1)/T (e.g., 2/3 of C when T=3).
- The economic value carried by S shares is C - K = C/T (e.g., 1/3 of C at 3x).
- When calling `compoundRewards(S, ...)`, the vault burns S and pays out rewards in dUSD equal to approximately the shares’ economic value (minus treasury fee): netZ ≈ (C/T) * (1 - feeBps).

Therefore, after minting and compounding S:

- You hold K ≈ C * (T-1)/T from the deposit’s borrow, and
- You receive netZ ≈ C/T after compounding,
- Total ≈ C (subject to treasury fee and rounding), which aligns well with repaying the dUSD used to buy C via exact-out swap. Profit depends on swap/flash fees and treasury fee.

---

## Practical checks, constraints and risks

- `exchangeThreshold`: `compoundRewards` reverts if `amount < exchangeThreshold`. Always set `S = exchangeThreshold()` and mint exactly S shares via `previewMint/mint`.
- `isTooImbalanced()`: `DLoopCoreBase` blocks deposit/mint if leverage is out of bounds. Verify `maxDeposit(address(this)) > 0` before attempting deposit.
- Race conditions / front-running: `compoundRewards` claims all available rewards from the external controller. Another bot can claim rewards before you; this can make your run unprofitable. Consider private mempool or MEV protection.
- Price and decimals: `K` depends on oracles and token decimals. Use `CORE.previewMint(S)` and/or `CORE.previewDeposit(Y)` plus `DLoopCoreLogic` to estimate precisely.
- Swap slippage, aggregator execution failure and approvals must be handled. Use `minExpectedOut` guards for swaps.
- Treasury fee: compute `getTreasuryFee(Z)` on-chain to understand `netZ` rather than guessing.
- Flash lenders may have additional constraints (maxLoan, token allowances, etc.).
- If `deposit` mints shares to `receiver`, some vaults transfer the borrowed dUSD to the `receiver` — ensure you call deposit with `receiver = address(this)` to receive the borrowed `K`.

---

## Implementation outline & pseudocode (threshold-based)

Below is a compact, step-by-step pseudocode blueprint. It is written to be unambiguous and implementable.

```solidity
contract DLendRewardsClaimerBot is IERC3156FlashBorrower {
    // Config (set in constructor or constants)
    IERC20 constant dusd = IERC20(/* dUSD address */);
    IERC20 constant sfrx = IERC20(/* sfrxUSD address */);
    IDLoopCoreDLend constant core = IDLoopCoreDLend(/* core address */);
    IERC3156FlashLender constant flash = IERC3156FlashLender(/* lender address */);
    address constant swapAgg = /* aggregator address */;

    // Entrypoint to run one cycle
    function run(uint256 flashAmount, bytes calldata swapExactOutCallData, uint256 slippageBps) external {
        require(core.maxDeposit(address(this)) > 0, "deposit disabled");
        require(slippageBps <= 10_000, "slippage too high");

        // Determine target shares = exchangeThreshold
        uint256 shares = core.exchangeThreshold();
        require(shares > 0, "zero threshold");

        // Compute required collateral to mint exactly shares
        uint256 requiredCollateral = core.previewMint(shares);
        // Add small buffer for price movement
        uint256 collateralWithBuffer = requiredCollateral * (10_000 + slippageBps) / 10_000;

        // Pass swap plan and required collateral to callback
        flash.flashLoan(
            this,
            address(dusd),
            flashAmount, // must be >= aggregator max input for exact-out + fee
            abi.encode(swapExactOutCallData, collateralWithBuffer, shares)
        );
    }

    // Flash loan callback
    function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata data) external returns (bytes32) {
        require(msg.sender == address(flash), "invalid lender");
        require(token == address(dusd), "invalid token");
        (bytes memory swapExactOutCallData, uint256 collateralWithBuffer, uint256 shares) = abi.decode(data, (bytes, uint256, uint256));

        // 1) Exact-out swap: acquire collateralWithBuffer of sfrxUSD using dUSD up to `amount`
        dusd.approve(swapAgg, amount);
        (bool ok,) = swapAgg.call(swapExactOutCallData); // must encode exact-out buy of collateralWithBuffer
        require(ok, "swap failed");
        uint256 sfrxBalance = sfrx.balanceOf(address(this));
        require(sfrxBalance >= collateralWithBuffer, "insufficient collateral");

        // 2) Mint exactly shares (equals exchangeThreshold); receive borrowed dUSD K
        sfrx.approve(address(core), sfrxBalance);
        uint256 minted = core.mint(shares, address(this));
        require(minted == shares, "mint mismatch");

        // 3) Call compoundRewards with shares to claim dUSD
        IERC20(address(core)).approve(address(core), shares);
        address[] memory rewardTokens = new address[](1);
        rewardTokens[0] = address(dusd);
        core.compoundRewards(shares, rewardTokens, address(this));

        // 4) Repay flash loan: amount + fee
        uint256 totalDebt = amount + fee;
        require(dusd.balanceOf(address(this)) >= totalDebt, "not enough to repay");
        dusd.approve(address(flash), totalDebt);

        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }
}
```

Notes for implementer:

- The `swapExactOutCallData` is crafted off-chain (e.g., 1inch/0x) to buy exactly `collateralWithBuffer` of collateral for dUSD (exact-out). Ensure your flash amount ≥ aggregator max input + flash fee.
- Use `core.previewMint(shares)` to compute required collateral for shares. Optionally cross-check with `core.previewDeposit(Y)`.
- Record dUSD balance delta around mint to estimate `K` precisely if needed.
- Ensure approvals for `core` (shares) and for `flash` to take repayment.
- Query `treasuryFeeBps()` and `exchangeThreshold()` on-chain; always set `shares = exchangeThreshold()`.

---

## Final checklist to make safe profitable runs

- Off-chain: compute estimated Y (sfrx out), `shares = core.previewDeposit(Y)`, estimated K using `DLoopCoreLogic` formulas or preview functions, estimated Z (hard to know; use historical reward rate or call the rewards controller query API), compute netZ after `treasuryFeeBps`.
- Ensure K + netZ >= X + fee + swapCosts before sending the transaction.
- Use small test flash amounts on testnet and monitor front-running and slippage.
- Consider private RPC/mempool or MEV protection to avoid front-runners.

---

If you want, I can now:

- produce an on-chain-ready Solidity skeleton (with correct imports and interfaces) for the bot, or
- write the off-chain helper (scripts) to calculate expected `K`, `S`, `Z` and profit thresholds per run.
