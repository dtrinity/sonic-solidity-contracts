Goal: Add Jest test suites with mocks for external services and deterministic decisioning.

Test Areas
- Decision engine unit tests (mathematical conditions around `K + netZ >= X + fee`).
- Quote helper client integration (ethers Contract calls mocked).
- Swap aggregator client: returns encoded calldata and maxInput estimate.
- Notification manager: mocked Slack webhook.
- Runner integration: scenario tests (profitable, unprofitable, disabled deposit, aggregator fail).

Structure
- `test/decision/decision.spec.ts`
- `test/clients/quote-helper.spec.ts`
- `test/clients/swap-aggregator.spec.ts`
- `test/infra/notification-manager.spec.ts`
- `test/runner/runner.profitable.spec.ts`, etc.

Acceptance
- `make test` green; no live network calls.
- If a large test flaps, split into smaller files per hint guidance.

