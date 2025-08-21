## Review: flashloan-reward-compounding-explanation.md

Status: APPROVED

Scope

- File: `ai-promt/dloop-reward-compounder/flashloan-reward-compounding-explanation.md`
- Change: Align flow with `exchangeThreshold`-based compounding and exact-out swap; update pseudocode to use `previewMint` + `mint(S)` and call `compoundRewards(S, ...)` with `S = exchangeThreshold()`.

Summary

- The previous flow assumed swapping all flashloaned dUSD into collateral and compounding arbitrary S shares.
- The corrected flow uses `S = exchangeThreshold()` to minimize race impact and align with `compoundRewards` constraints.
- Pseudocode and profit condition reflect exact-out swaps and threshold-based minting.

Checks

- Exchange threshold considered and enforced.
- Mint flow uses `previewMint(S)` and `mint(S, receiver)` as supported by ERC4626 core.
- Compound call approves and uses exactly `S` shares.
- Profit logic includes flash fee and aligns with exact-out swap semantics.

Notes

- Periphery notes that only `deposit()` is supported there; the pseudocode interacts with the core directly, which supports `mint()`.
- Implementers must size the flash amount to cover aggregator max input + fee; this is called out.

Conclusion

- The updated explanation is technically accurate and actionable for implementers. Approved for use.
