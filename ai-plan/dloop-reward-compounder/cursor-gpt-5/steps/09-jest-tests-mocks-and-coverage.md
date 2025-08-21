Goal: Implement Jest unit tests for the TypeScript bot with mocks.

Tests
- Quote flow: helper returns values; decision rejects/accepts properly around thresholds.
- Execute flow: periphery call mocked; success path vs revert path.
- Notification flow: Slack mock receives expected payloads.

Setup
- Use `ts-jest` and `jest.mock` for ethers contracts and Slack client.
- Coverage target: ≥ 80% lines.

Acceptance
- `make test` passes; coverage threshold enforced.
