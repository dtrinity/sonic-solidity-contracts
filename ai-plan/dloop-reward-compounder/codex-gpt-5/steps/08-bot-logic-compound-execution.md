Goal: Implement the execution path to call the periphery with crafted swap calldata and repay flash.

Flow
1) Build `swapExactOutCallData` for Odos (or aggregator) to buy `collateralWithBuffer` for dUSD.
2) Compute `flashAmount` >= aggregator max input + flash fee margin.
3) Call periphery method: `run(flashAmount, swapExactOutCallData, slippageBps)`.
4) Wait for receipt; parse emitted events for profit/loss and operational data (K, netZ, fees).

Implementation Details
- `src/execution/compound.ts` handles periphery invocation and event parsing.
- Keep Odos client behind an interface `SwapAggregator` for test mocking.
- Slippage guards configurable per network.

Acceptance
- E2E dry-run in testnet config hits the method (mock in tests).
- Failure paths: revert surfaces meaningful error; logs captured.

