Goal: Provide mocks and tests for contracts without external dependencies.

Mocks
- `RewardCompounderDLendMock.sol`: swap venue logic mocked (no Odos). Reference `contracts/vaults/dloop/periphery/venue/mock/DLoopDepositorMock.sol`.
- `RewardQuoteHelperMock.sol`: reward venue logic mocked (DLend). Reference `contracts/vaults/dloop/core/venue/dlend/DLoopCoreMock.sol`.
- Use `DLoopCoreMock` for core interactions.

Tests (Hardhat, ts)
- Verify quote helper returns expected values with mocked DLend venue.
- Verify periphery flash flow succeeds and repays loan with mocked swap.
- Revert cases: insufficient reward, insufficient collateral, swap failure, deposit disabled.

Acceptance
- All tests pass via `make test`.
- Lint passes via `make lint`.
