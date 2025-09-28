### Report: Odos Liquidity Swap Adapter Vulnerability (Sonic)

**Preconditions**

* Victim wallet `0xc51fefb9ef83f2d300448b22db6fac032f96df3f` has an active borrow on Sonic and holds `aWSTKSCUSD` (token `0x72f1b09dea4bef67d223c21ab4a2bfcaa60f0d51`) representing ~26k units of `wstkscUSD` collateral.
* Victim previously granted an unlimited approval on `aWSTKSCUSD` to the Sonic `OdosLiquiditySwapAdapter` at `0x9ee939DdC8eaAAc72d3cAE793b12a09D92624E4a`.

**Atomic Attack Flow (Single Transaction)**

**High-Level Timeline**
1. Borrow 27,000 dUSD via flash-mint; the dUSD proxy mints straight from the zero address into the attacker executor.
2. Use the adapter to pull the victim’s `aWSTKSCUSD`, route the underlying collateral into attacker-controlled conversions, and recycle a 1-micro wstkscUSD dust credit back to the adapter.
3. Repay the flash-mint with the same 27,000 dUSD that was minted in step 1 (no external liquidity required).

**Why dUSD matters:** The flash-minted dUSD never touches the victim’s debt. Instead it gives the malicious Odos route temporary working capital to step through the staging contracts (staging vault → recycler → splitter → micro distributors) and mint the staking wrappers that ultimately rewrap the stolen `wstkscUSD`. Without that float the helper contracts would revert and the adapter would fail to receive even the 1 µ `wstkscUSD` dust needed to satisfy `minOut`.

1. **Flash-mint staging:** The attacker contract (`0xDe8558c9111FD58C8Db74c6c01D29Bb9e5836565`) calls `dUSD.flashLoan` for 27,000 `dUSD` (18 decimals). Tenderly shows the paired `Transfer(0x0 -> attacker, 27,000 dUSD)` and later repayment, matching the on-chain flash-mint helper used on Sonic. This is the sole source of dUSD in the transaction; the balance sits on the attacker executor until the final repayment. The minted dUSD acts as working capital for the malicious Odos route—without it the subsequent wrapper hops (ds/sts/ws) would not have the funds to mint the 1-micro wstkscUSD returned to the adapter, and the swap would revert for insufficient output. The analyzer report (`reports/tenderly/sonic-attack-summary.json`) confirms how that float circulates: the staging vault ends the tx at **+28,577.600000888760596 dUSD**, the recycler at **−28,627.600000888760596 dUSD**, and the splitter/distributors hold the residual 0.5 dUSD needed to manufacture dust without leaking capital back to the pool.
2. **Adapter invocation:** Using the staged funds, the attacker invokes `OdosLiquiditySwapAdapter.swapLiquidity` with `withFlashLoan = true`, `user = victim`, `collateralAsset = newCollateralAsset = wstkscUSD (0x9fb76f7ce5fceaa2c42887ff441d46095e494206)`, `collateralAmountToSwap = 26,243.751965 wstkscUSD`, `newCollateralAmount = 0`, and attacker-crafted `swapData` that injects their executor as the Odos route leg.
3. **Pool flash-loan:** The adapter’s flash-loan callback (`executeOperation`) borrows the victim’s collateral asset from the pool, expecting to sell it for fresh collateral before pulling the victim’s aTokens to repay. No victim debt is repaid here—the adapter assumes the borrower provided the required output token and therefore focuses solely on collateral accounting.
4. **Malicious Odos path:** The attacker-supplied Odos route forwards the flash-loaned wstkscUSD into the attacker executor, which:
   * Triggers the pool to burn the victim’s `aWSTKSCUSD`, visible as `Transfer(victim -> 0x0)` plus a matching burn from the reserve manager contract `0xf0ab950cE2dbc6aF4bFf3D9bDcB82E634AaFD6e0`. These burns free the underlying wstkscUSD into the attacker-controlled burn helper at `0x10451579fD6375c8beE09f1e2c5831aFDe9003ed`; the analyzer surfaces the paired amounts (`21,440.463367667587451078` from the victim and `7,132.235951210549287459` from the reserve manager) that correspond to the 28,572.699318 aTokens destroyed.
   * Pipes the released wstkscUSD through `frxUSD -> sUSD (scUSD) -> USDC -> staking wrappers (sts/ws)` using helper vaults (`0xba1333333333A1BA1108e8412F11850a5C319BA9`, `0xba12222222228d8Ba445958a75a0704d566BF2C8`, etc.), ultimately crediting the attacker EOA `0x0a69C298ece97fb50a00ace91c79182184423933` after rewrapping. Multiple bursts are visible in the trace—most notably `26,230.630089` and `8,877.536706` wstkscUSD legs—which sum to the ~35k wstkscUSD outflow recorded in the analyzer’s net balances.
   * Recycles part of the flash-minted dUSD through the staging helpers (`0x8805f9d444de3994aa69f8bbdfbc08fe3a277aee`, `0xdb81ee19ea2e5e1aca04f55d9c6c4188c36a81fe`, `0xb1c1a961a6619289f035a5ea413f8dcc53433061`, plus micro distributors `0x2493b7809f8ed73224a6867a8b82b7329fa598a7` and `0x6bfaaa1f342df3f6afba6be7e0a555f34bb91793`) to mint the staking receipts needed for the 1-micro wstkscUSD dust returned to the adapter. These detours explain why the attacker flash-mints 27k dUSD even though the adapter only receives a single micro (1e-6) unit of the collateral asset.
5. **Dust collateral returned:** To satisfy the adapter’s `minOut`, the executor recycles a single micro unit (`1` with 6 decimals) of `wstkscUSD` back to the adapter, which the adapter dutifully deposits for the victim.
6. **Victim allowance exploited:** The flash-loan branch finalises by burning the victim’s aTokens (`21,440.463367` from the victim wallet and `7,132.235951` from the reserve manager) so the pool’s accounting shows the flash borrow repaid. Crucially, the pool never receives fresh collateral or a debt repayment—the adapter simply consumes the victim’s approval and leaves every redeemed `wstkscUSD` sitting on attacker-controlled legs (`atoken_burn_helper: −35,108.166794`, `odos_pool_leg: +35,108.166795`).
7. **Flash-mint repayment:** With the stolen collateral now parked in attacker-controlled wrappers, the executor returns the exact 27,000 dUSD it minted in step 1 back to the dUSD proxy (`Transfer(attacker -> 0x0, 27,000 dUSD)`). No additional dUSD is sourced—the repayment uses the same flash-minted funds that originated from the zero address, leaving the attacker with the collateral while the flash-mint closes flat.

**Result:** The victim’s wstkscUSD collateral is replaced with a negligible 1-micro wstkscUSD deposit. The attacker path accumulates roughly **35,108.1668 wstkscUSD** (per the analyzer) before it is walked through the ds/sts/ws wrappers and delivered to the attacker EOA, while their dUSD flash-mint closes to zero. The borrower’s debt position is unchanged—the adapter plunders collateral purely by abusing approvals and spoofed swap output.

---

### Concrete Indicators / IOCs

* **Transaction Hash (Sonic):** `0xa6aef05387f5b86b1fd563256fc9223f3c22f74292d66ac796d3f08fd311d940`
* **Attacker EOA:** `0x0a69C298ece97fb50a00ace91c79182184423933`
* **Attacker Executor / Router:** `0xDe8558c9111FD58C8Db74c6c01D29Bb9e5836565`
* **Adapter:** `0x9ee939DdC8eaAAc72d3cAE793b12a09D92624E4a`
* **Victim:** `0xc51fefb9ef83f2d300448b22db6fac032f96df3f`
* **Collateral Drained:** `collateralAmountToSwap = 26,243.751965 wstkscUSD` (6 decimals). The tenderly trace shows the paired burn of `21,440.463367 aWSTKSCUSD` and downstream conversions into `frxUSD`, `scUSD`, `USDC`, and staking wrappers (`sts`, `ws`).
* **Flash-Mint Evidence:** `dUSD` transfers `0x0 -> attacker` and `attacker -> 0x0` of 27,000 dUSD bracket the exploit, proving reliance on the Sonic dUSD flash-loan facility.

---

### Reference Address Book (Sonic tx `0xa6ae...1940`)

Collateral and Adapter
* Victim wallet: `0xc51fefb9ef83f2d300448b22db6fac032f96df3f`
* Adapter (OdosLiquiditySwapAdapter): `0x9ee939DdC8eaAAc72d3cAE793b12a09D92624E4a`
* Attacker executor/router: `0xDe8558c9111FD58C8Db74c6c01D29Bb9e5836565`
* Attacker EOA (final recipient): `0x0a69C298ece97fb50a00ace91c79182184423933`
* aToken drained (`aWSTKSCUSD`): `0x72f1b09dea4bef67d223c21ab4a2bfcaa60f0d51`
* Underlying collateral (`wstkscUSD`): `0x9fb76f7ce5fceaa2c42887ff441d46095e494206` (6 decimals)

Flash-mint / Routing Helpers
* dUSD proxy (flash-loan target): `0x53a6abb52b2f968fa80df6a894e4f1b1020da975`
* wstkscUSD routing helper (receives freed collateral): `0x10451579fD6375c8beE09f1e2c5831aFDe9003ed`
* Reserve manager burning residual aTokens: `0xf0ab950cE2dbc6aF4bFf3D9bDcB82E634AaFD6e0`
* dUSD staging vault receiving flash-minted funds: `0x8805f9D444dE3994aA69F8BBdFbC08fE3A277Aee`
* dUSD recycler returning funds to attacker: `0xdb81ee19ea2e5e1aca04f55d9c6c4188c36a81fe`
* dUSD splitter paying out ds wrappers: `0xb1c1a961a6619289f035a5ea413f8dcc53433061`
* Micro-distributors invoked during dust creation: `0x2493b7809f8ed73224a6867a8b82b7329fa598a7`, `0x6bfaaa1f342df3f6afba6be7e0a555f34bb91793`
* Odos pool leg distributing collateral: `0xba1333333333A1BA1108e8412F11850a5C319BA9`
* Balancer vault hop: `0xba12222222228d8Ba445958a75a0704d566BF2C8`
* scUSD helper: `0x2c13383855377faf5A562f1aef47E4be7A0f12aC`
* frxUSD vault: `0xf1232a1aB5661aBdD6E02c6D8Ac9940a23Bb0b84`
* ws wrapper: `0x039e2fb66102314ce7B64Ce5Ce3E5183bc94aD38`
* sts wrapper: `0xe5da20f15420ad15de0fa650600afc998bbe3955`
* ds staking token: `0x614914b028a7d1fd4fab1e5a53a3e2df000bcb0e`
* asonUSDC mint/burn helper: `0x578ee1cA3A8E1b54554Da1Bf7c583506C4Cd11C6`
* Zero-amount helper contract: `0xf177ef27512fa74604aabc748f4d0720b00d0bd1` (converts change into dust)

Useful Token Metadata
* `dUSD` decimals: 18
* `wstkscUSD`, `USDC`, `scUSD`: 6 decimals
* `frxUSD`, `sts`, `ws`, `ds`: 18 decimals

Tenderly Trace Checkpoints
1. `flashLoan` call on `dUSD` (delegatecall into proxy) with `_amount = 27000 * 1e18`
2. Adapter `swapLiquidity` call with `withFlashLoan = true` and `liquiditySwapParams.collateralAmountToSwap = 26243751965`
3. `Transfer` of `aWSTKSCUSD` from victim/reserve manager to the zero address (burn) followed by `Transfer` of `wstkscUSD` from helper to attacker executor
4. Dust return `Transfer` of `1` wstkscUSD from attacker executor back to adapter
5. Flash-loan repayment `Transfer(attacker -> 0x0, 27000 dUSD)`

Cached artefacts live under `reports/tenderly/` (`attack-vs-repro-transfers.json`, `raw-tenderly-trace-sonic-a6aef053.json`); rerun `npx hardhat run scripts/tenderly/compare-odos-attack-events.ts` with `TENDERLY_FORCE_REFRESH=true` if trace data needs a refresh.

---

### Root Causes (Concise)

1. **Untrusted `user` parameter:** The adapter lets arbitrary callers set `user`, then performs `transferFrom(user, adapter, amount)` against pre-existing approvals. No runtime authentication or permit check protects the victim.
2. **No value sanity checks:** The adapter trusts caller-supplied `swapData`/`minOut`, so a malicious Odos path can siphon the withdrawn collateral while returning dust.
3. **Flash-liquidity amplification:** Sonic’s dUSD flash-loan + the adapter’s `withFlashLoan` branch give the attacker enough intra-tx liquidity to mask the drain and repay obligations without capital.

---

### Confidence Notes (Confirmed vs. Speculative)

* **Confirmed:** Tenderly trace shows `swapLiquidity` called with `user = victim`, the adapter burns victim aTokens, and Odos forwards collateral to attacker-controlled legs while only 1 micro wstkscUSD returns.
* **Confirmed:** dUSD flash-loan `Transfer` pair exists exactly once in the transaction, and the loan value tallies with the executor’s intermediate conversions.
* **Speculative (low risk):** Exact routing through `sts/ws` wrappers may vary between replays, but every hop observed in the Sonic tx is attacker-controlled and unnecessary for a legitimate swap.
