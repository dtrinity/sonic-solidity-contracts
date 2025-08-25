Goal: Implement the bot run flow: quote → decide → execute periphery call.

Scope
- `src/runner.ts` entrypoint parses `--network` and loads addresses from `config/networks/<network>.ts`.
- Quote: call `RewardQuoteHelperDLend` to get reward estimates (mock in tests).
- Decision: ensure `K + netZ >= X + fee + swapCosts` (see `flashloan-reward-compounding-explanation.md`).
- Execute: call `RewardCompounderDLendOdos.run(...)` with encoded Odos calldata and params.
- Logging: structured logs for quote, thresholds, tx hash, outcome.

Acceptance
- Dry-run capable with mocked providers.
- Types safe; no `any` in public surfaces.
