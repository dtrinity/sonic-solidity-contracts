# AmoManagerV2 + AMO Debt System (Single $1 Debt Token)

Status: Proposed
Owner: Protocol Engineering
Type: Feature (contracts + tests + deploy)
Priority: High

## Summary

Unify AMO operations under AmoManagerV2, covering both: (1) stable AMO dUSD mint/burn and (2) collateral AMO borrow/repay. Use a single, hard‑pegged $1 debt token for unified accounting. Debt is minted to a CollateralVault for both operations. Collateral AMO flows enforce value conservation atomically; stable AMO flows mint/burn dUSD in lockstep with debt mint/burn. The debt token must be priceable by the oracle so that CollateralVault can value it.

Key properties
- Debt token: 18 decimals, name “dTRINITY AMO Receipt, symbol “amo-dUSD”.
- Transfer‑restricted via an allowlist; only allowlisted holders (vaults, manager if needed) can hold/transfer; regular users cannot receive or redeem it.
- Oracle support: price fixed to 1 base unit to make the token measurable by CollateralVault.
- AmoManagerV2: atomic borrow/repay with invariant checks (revert on violation), and atomic stable AMO mint/burn paired with debt mint/burn. Configurable `AMO_MULTISIG` by admin; supports arbitrary allowlisted endpoints (wallets/contracts).

Non-goals
- No migration of existing vault contracts.
- No special LP pricing or external reward claiming.
- No frontend change (frontends can compute/visualize components independently). Overstating backing due to debt being valued inside the vault is acceptable and out of scope to correct here.

## Context

Relevant contracts in repo
- Collateral vault base: `contracts/dstable/CollateralVault.sol`
- Custody vault implementation: `contracts/dstable/CollateralHolderVault.sol`
- Existing AMO manager (supply-based): `contracts/dstable/AmoManager.sol`
- IssuerV2: `contracts/dstable/IssuerV2.sol` (not required for AmoManagerV2 mint path)
- Oracle base: `contracts/dstable/OracleAware.sol`

Constraints and decisions
- For collateral AMO flows, CollateralVault value must be unchanged pre/post when including the debt token at $1 (value conservation). Therefore, the accounting vault must include the debt token as supported collateral and have an oracle price.
- Borrow and repay must be single, atomic transactions (revert on any invariant failure).
- Collateral flows must respect `vault.isCollateralSupported(asset)` and flow only between the CollateralVault and allowlisted endpoints (including the AMO multisig).
- Debt tokens only live on CollateralVaults (and optionally the manager for burns); non‑allowlisted addresses cannot hold/receive them.
- Overstating backing in CollateralVault due to the debt token being valued at $1 is acceptable in scope; frontend will handle display adjustments later.

## Requirements

Functional
- Debt token
  - ERC20 with 18 decimals, name “dTRINITY AMO Debt”, symbol “amo-debt”.
  - Transfer‑restricted via allowlist. Only allowlisted addresses can receive/hold/transmit the token.
  - Only the manager can mint/burn. Minting must target an allowlisted CollateralVault; burning must burn from an allowlisted CollateralVault.
  - Approvals/transferFrom must be subject to the same allowlist rules (no transfers by or to non‑allowlisted addresses).

- Oracle
  - The oracle must return the base currency unit (1.0) for the debt token address.
  - Deployment must configure the oracle (or wrapper) to include the debt token price mapping.

 - AmoManagerV2 (unified)
  - Roles: `DEFAULT_ADMIN_ROLE`, `AMO_MANAGER_ROLE`.
  - State: `address amoMultisig` (configurable only by `DEFAULT_ADMIN_ROLE`), `address debtToken`, allowlist of CollateralVault(s) and endpoints (EnumerableSet), `uint256 tolerance` for rounding.
  - Stable AMO (atomic):
    - `increaseAmoSupply(amount)`: mint debt tokens of equal value into the accounting vault; mint `amount` dUSD directly from the dUSD token (AmoManagerV2 holds MINTER_ROLE) to itself or a whitelisted AMO endpoint. Invariant: minted dUSD equals minted debt.
    - `decreaseAmoSupply(amount)`: burn dUSD held by the manager and burn equal debt from the accounting vault. Invariant: burned dUSD equals burned debt.
  - Collateral AMO (atomic):
    - Borrow: require endpoint/vault allowlisted and `vault.isCollateralSupported(asset)`; pre = `vault.totalValue()`; mint debt equal to `assetValueFromAmount`; `vault.withdrawTo(endpoint, amount, asset)`; post = `vault.totalValue()`; enforce `|pre - post| <= tolerance`.
    - Repay: require endpoint/vault allowlisted and `vault.isCollateralSupported(asset)`; pre = `vault.totalValue()`; `transferFrom(endpoint -> vault, amount)`; burn debt equal to `assetValueFromAmount`; post = `vault.totalValue()`; enforce `|pre - post| <= tolerance`.
    - Provide optional `repayWithPermit` overload for EIP‑2612 tokens; otherwise Safe batch (approve + repay) achieves single user‑level tx.
  - Views:
    - Optional telemetry only (e.g., expose total debt in base or per-endpoint counters). Core correctness relies solely on debt token supply and collateral/vault invariants.
  - Manager must never withdraw the debt token itself.
  - No event for invariant checks; rely on revert if violated. Emit `Borrowed`/`Repaid` for traceability.

Security/invariants
- Debt token transfer restrictions prevent third‑parties from depositing/withdrawing debt tokens to manipulate vault value.
- Manager enforces `vault.isCollateralSupported(asset)` on borrow and repay.
- Collateral flows only: `vault <-> allowlisted endpoint` (borrow withdraw to endpoint; repay transferFrom endpoint into vault).

Admin/Config
- `amoMultisig` must be configurable by `DEFAULT_ADMIN_ROLE` only.
- Allowlist: admin can add/remove vaults in the manager and holders in the debt token.
- Tolerance: admin settable in manager (default 0 or 1 base unit depending on test outcomes).

## Implementation Plan

1) Contracts — new

- `contracts/dstable/AmoDebtToken.sol`
  - Inherit: OpenZeppelin `ERC20`, `AccessControl`.
  - Roles: `DEFAULT_ADMIN_ROLE`, `AMO_MINTER_ROLE`, `AMO_BORROWER_ROLE`.
  - Allowlist: `EnumerableSet.AddressSet` for holders; only allowlisted can be sender or receiver in `_update` (applies to `transfer` and `transferFrom` regardless of allowances).
  - API:
    - `setAllowlisted(address, bool)` only admin.
    - `mintToVault(address vault, uint256 amount)` only `AMO_MINTER_ROLE` and allowlisted `vault`.
    - `burnFromVault(address vault, uint256 amount)` only `AMO_BORROWER_ROLE` and allowlisted `vault`.
  - Errors: `NotAllowlisted(address)`, `OnlyMinter()`, `OnlyBorrower()`, `InvalidVault(address)`.
  - Notes: Do not implement EIP‑2612 unless needed; keep minimal.

- `contracts/dstable/AmoManagerV2.sol`
  - Inherit: `OracleAware`, `AccessControl`, `ReentrancyGuard`.
  - Storage: `address amoMultisig`, `AmoDebtToken debtToken`, `EnumerableSet.AddressSet allowedVaults`, `EnumerableSet.AddressSet allowedEndpoints`, `uint256 tolerance`.
  - Roles: `DEFAULT_ADMIN_ROLE`, `AMO_MANAGER_ROLE`.
  - Admin fns: `setAmoMultisig(address)`, `setVaultAllowed(address,bool)`, `setEndpointAllowed(address,bool)`, `setTolerance(uint256)`; view getters for enumerating allowlists.
  - Helpers: `baseToDebtUnits(uint256 baseValue)` using `baseCurrencyUnit` and debt token decimals.
  - Stable AMO: `increaseAmoSupply(uint256 amount)`, `decreaseAmoSupply(uint256 amount)` (atomic, see Requirements).
  - Collateral AMO: `borrowTo(address vault, address endpoint, address asset, uint256 amount)`, `repayFrom(address vault, address endpoint, address asset, uint256 amount)`, plus optional `repayWithPermit`.
  - Errors: `UnsupportedVault(address)`, `UnsupportedCollateral(address)`, `UnsupportedEndpoint(address)`, `InvariantViolation(uint256 pre, uint256 post)`.
  - Events: `Borrowed(vault, endpoint, asset, collateralAmount, debtMinted)`, `Repaid(vault, endpoint, asset, collateralAmount, debtBurned)`.

2) Oracle configuration

- Ensure the active oracle wrapper for the environment returns `BASE_CURRENCY_UNIT` for the debt token address.
  - For tests: wire `MockOracleAggregator` (or existing mocks) to return base unit for debt token.
  - For deploy: update the oracle configurator or deployment script to set the feed for the debt token to a fixed $1 price.

3) Vault configuration

- On the accounting CollateralVault (e.g., `CollateralHolderVault`), add the debt token as supported collateral via `allowCollateral(debtToken)`. This ensures `totalValue()` reflects both real collateral and debt token at $1.
- Grant `COLLATERAL_WITHDRAWER_ROLE` on the vault to AmoManagerV2 (to perform `withdrawTo` during borrow).

4) Access Control wiring

- Debt token: grant `AMO_MINTER_ROLE` and `AMO_BORROWER_ROLE` to AmoManagerV2. Allowlist the accounting vault (and optionally the manager for burns via `burnFromVault`).
- dUSD token: grant `MINTER_ROLE` (or protocol‑specific mint role) to AmoManagerV2 so it can mint strictly for AMO flows to allowlisted endpoints.
- AmoManagerV2: grant `AMO_MANAGER_ROLE` to the AMO multisig. Set `amoMultisig` in the manager via admin; allowlist endpoints and vaults via EnumerableSet.
- Endpoints must pre‑approve the manager to spend collateral tokens used in repay paths (unless using permit).

5) Tests (TypeScript, Hardhat)

Add `test/dstable/AmoManagerV2.spec.ts` (or similar):
- Fixture: deploy oracle (mock), CollateralHolderVault (accounting vault), debt token, AmoManagerV2, IssuerV2; configure oracle price for debt token = base unit; allowlist vault/endpoints in token and manager; add debt token to vault supported collateral; grant roles.
- Stable AMO mint/burn
  - increaseAmoSupply: assert dUSD minted to manager (or endpoint); equal debt minted to vault.
  - decreaseAmoSupply: ensure manager holds dUSD; burn dUSD and equal debt.
- Borrow success
  - Fund vault with collateral X; record `pre = vault.totalValue()`; call borrow; assert collateral moved to endpoint; debt minted to vault; `post == pre` within tolerance.
- Repay success
  - From endpoint, approve manager (or use permit); call repay; assert collateral moved back into vault; debt burned; invariant holds.
- Unsupported collateral/vault/endpoint
  - Borrow/repay with unsupported asset, vault, or non‑allowlisted endpoint → revert.
- Transfer restrictions
  - Attempt to transfer debt token to non‑allowlisted EOA → revert.
  - Attempt to transferFrom non‑allowlisted (either sender or recipient) → revert, even if allowance was granted by an allowlisted holder.
- Rounding/tolerance
  - Test assets with 6/8/18 decimals; invariant holds within `tolerance`.
- Admin
  - `setAmoMultisig` only admin; endpoint allowlist only admin; `setTolerance` only admin.

6) Deployment

Add a deploy script (hardhat‑deploy) e.g. `deploy/46_amo_manager_v2_and_debt.ts`:
- Deploy `AmoDebtToken` with name/symbol/decimals.
- Deploy `AmoManagerV2` with oracle, debt token, and accounting vault addresses.
- Set `amoMultisig` on manager; allowlist endpoints and the accounting vault via manager admin fns; allowlist accounting vault in debt token.
- Grant roles:
  - Debt token `AMO_MINTER_ROLE` and `AMO_BORROWER_ROLE` -> AmoManagerV2.
  - dUSD token mint role -> AmoManagerV2 (AMO‑only minter).
  - Accounting vault `COLLATERAL_WITHDRAWER_ROLE` -> AmoManagerV2.
  - AmoManagerV2 `AMO_MANAGER_ROLE` -> multisig (and any ops addresses as needed).
- Configure oracle mapping: set price feed for debt token to base unit.
- Add debt token to accounting vault via `allowCollateral(debtToken)`.

7) Docs

- Update README/docs to describe AMO Debt flows, invariants, and admin operations (setting multisig, vault allowlists, oracle mapping, tolerance, and role grants).

## Acceptance Criteria

- Contracts compile; linting passes.
- Tests covering stable AMO mint/burn, collateral borrow/repay invariants, role enforcement, endpoint/vault allowlists, transfer restrictions, and rounding all pass.
- Oracle returns base unit for debt token in tests and is wired in deploy scripts for live.
- Accounting vault’s `totalValue()` includes debt token value after `allowCollateral(debtToken)`.
- Borrow/repay operate as single transactions with reverts on invariant violation; stable AMO mint/burn are atomic and mint/burn matching debt.
- AMO multisig configurable only by admin; manager enforces `isCollateralSupported` for both borrow and repay; endpoints are allowlisted.

## Risks / Considerations

- Oracle risk: a bad feed for the debt token would corrupt valuations. Use a fixed‑price configuration (1.0) with governance controls.
- Transfer allowlist must be airtight: no path for non‑allowlisted addresses to receive/hold debt tokens; otherwise vault value could be spoofed.
- Role hygiene: only AmoManagerV2 should hold `COLLATERAL_WITHDRAWER_ROLE` on the accounting vault.
- Approvals: repay requires endpoint approvals to the manager for each collateral token (unless using permit); operational runbooks should include this.

## File References

- contracts/dstable/CollateralVault.sol:1
- contracts/dstable/CollateralHolderVault.sol:1
- contracts/dstable/AmoManager.sol:46
- contracts/dstable/IssuerV2.sol:1
- contracts/dstable/OracleAware.sol:1

## Out of Scope

- Frontend balance sheet updates (frontend may independently aggregate and display AMO components), including backing adjustments due to debt valuation.
- Any migrations of existing contracts beyond new contracts, role grants, and config.
