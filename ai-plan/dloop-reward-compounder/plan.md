Title: DLoop Reward Compounder Bot — Implementation Plan, Test Plan, and Review Checklist

Goals

- Build a standalone bot at `bot/dloop-reward-compounder` to compound rewards for `DLoopCoreDLend` using a flashloan-based periphery.
- Implement and deploy a new periphery contract pair: an abstract base and an Odos venue-specific implementation.
- Quote expected profitability off-chain, then execute on-chain compounding only when the threshold condition holds.
- Ensure repo independence, matching style/structure of `dloop-rebalancer` and `dlend-liquidator` where appropriate.

Scope Summary

- Contracts: `RewardCompounderDLendBase.sol` (abstract), `RewardCompounderDLendOdos.sol` (venue-specific), `RewardHelper.sol` (quoting helper, optional but helpful for clean integration), mocks for testing.
- Bot runtime: TypeScript service that monitors, quotes, and triggers compounding via the periphery; Slack notifications for results.
- Tooling: Hardhat, eslint (matching `dloop-rebalancer`), Makefile, Dockerfile. Fully self-contained repo.

Repo Structure (to create under `bot/dloop-reward-compounder`)

- contracts/
  - base/
    - RewardCompounderDLendBase.sol
  - venue/odos/
    - RewardCompounderDLendOdos.sol
    - OdosSwapLogic.sol (copy/adapt minimal logic if needed; else import interface)
  - helpers/
    - RewardHelper.sol (based on `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md`)
  - interfaces/
    - IERC3156FlashBorrower.sol (if not available via deps)
    - IERC3156FlashLender.sol (if not available via deps)
    - IDLoopCoreDLend.sol (copy interface from monorepo)
    - IRewardClaimable.sol (copy if needed)
    - IOdosRouter.sol / IAggregator.sol (minimal swap interface)
    - IERC20.sol (local copy if not relying on OZ via deps)
  - mocks/ (tests only)
    - MockDLoopCoreDLend.sol (emulates previewMint/mint/compoundRewards/reward flow)
    - MockFlashLender.sol (ERC-3156)
    - MockOdosRouter.sol (exactOut/ExactIn toggle + slippage controls)
    - MockERC20.sol (dUSD, collateral)
- typescript/
  - bot/
    - runner.ts (main loop)
    - quoting.ts (uses RewardHelper and core view methods)
    - periphery.ts (tx builder: encode calldata and call periphery)
    - notification.ts (Slack integration; mirror `dlend-liquidator` pattern)
    - config.ts (load network addresses and params)
    - env.ts (env parsing, validation)
  - utils/
    - provider.ts, signer.ts, numbers.ts, logger.ts
  - abis/ (compiled ABIs or minimal hand-written if needed for mocks)
- config/
  - networks/
    - sonic_mainnet.ts (core addresses, tokens, routers)
    - sonic_testnet.ts
  - constants.ts
  - types.ts
- scripts/
  - deploy_periphery.ts (deploy base and Odos impl; record addresses)
  - verify.ts
  - run_once.ts (one-off compounding)
- deploy/
  - sonic_mainnet/
    - 001_deploy_periphery.ts
  - sonic_testnet/
    - 001_deploy_periphery.ts
- test/
  - contracts/
    - RewardCompounder.fullflow.spec.ts
    - RewardCompounder.reverts.spec.ts
    - RewardHelper.spec.ts
    - SwapLogic.exactOut.spec.ts
  - bot/
    - quoting.spec.ts
    - runner.success.spec.ts
    - runner.failures.spec.ts
- .env.example, package.json, hardhat.config.ts, eslint.config.mjs, jest.config.js, tsconfig.json
- Dockerfile, Makefile, README.md
- .yarn/
  - releases/
    - yarn-3.7.0.cjs
  - install-state.gz

Do not need to copy the `.tmp`, `artifacts`, `typechain-types`, `cache`, `state` folders from the reference repo.

Key Design Decisions

- Threshold-based compounding: always target `S = CORE.exchangeThreshold()` and compute `requiredCollateral = CORE.previewMint(S)`; perform an exact-out swap dUSD→collateral for `requiredCollateral` (+ small slippage buffer). This aligns with FCFS and avoids auction dynamics.
- Profitability check: off-chain feasibility check before sending tx. The on-chain logic remains trustless and reverts if insufficient.
  - Variables: X = flash amount, fee = flash fee, K = borrowed dUSD from CORE during mint, netZ = dUSD rewards after treasury fee from `compoundRewards`.
  - Break-even: `K + netZ >= X + fee`.
- Independence: vendor any missing interfaces locally; pin npm deps; do not import from parent repo via relative paths.
- No approvals for caller-side tokens: the periphery takes care of inside-transaction approvals for swap and repayment only.

Implementation Plan

1) Bootstrap repository and tooling
   - Copy eslint config pattern from `dloop-rebalancer` (lint rules, import ordering).
   - Initialize Hardhat with Solidity compiler versions matching the monorepo; include optimizer settings.
   - Add Makefile targets: `make compile`, `make lint`, `make test`, `make docker.build`, `make deploy.sonic_mainnet`, `make deploy.sonic_testnet`.
   - Provide Dockerfile similar to `dlend-liquidator` with runtime entrypoint for the bot and build steps for contracts and TS.

2) Contracts — Base periphery
   - `RewardCompounderDLendBase.sol`
     - Implements IERC3156FlashBorrower.
     - Params set via constructor: addresses for `CORE`, `FLASH_LENDER`, `DUSD`, `COLLATERAL`, `SWAP_AGG`.
     - Public `run(bytes swapCalldata, uint256 flashAmount, uint256 slippageBps)`:
       - Reads `S = CORE.exchangeThreshold()`; require `S > 0`.
       - `requiredCollateral = CORE.previewMint(S)`; add buffer via `slippageBps`.
       - Kicks flashloan on dUSD for `flashAmount`, passing encoded `swapCalldata`, `requiredCollateral`, `S`.
     - `onFlashLoan` callback performs:
       - Approve and exact-out swap dUSD→collateral to get `requiredCollateral` (guard by reading collateral balance ≥ requiredCollateral).
       - Approve CORE; `CORE.mint(S, address(this))`; record dUSD delta to estimate K if needed.
       - Approve shares to CORE; call `compoundRewards(S, [DUSD], address(this))`.
       - Approve `FLASH_LENDER` and return magic value for ERC-3156.
     - Emits events: `RunStarted`, `SwapExecuted`, `Minted`, `Compounded`, `FlashRepaid`, `RunFailed` (if try/catch used inside).
     - Internal functions for validation and safe approvals.

3) Contracts — Venue-specific Odos implementation
   - `RewardCompounderDLendOdos.sol`
     - Extends base; replaces swap execution with Odos-specific call pattern.
     - `OdosSwapLogic` library or thin contract adapter to perform exact-out swaps (ensure input token is dUSD and output is collateral). Guard for exact-out/in mismatch via calldata parsing or venue flag.
     - Sanity check slippage by verifying post-swap collateral balance and dUSD spent.

4) Contracts — Reward Helper (quoting)
   - Implement `RewardHelper.sol` from `ai-promt/dloop-reward-compounder/reward-quoting-implementation.md` under `contracts/helpers/`.
   - Used by the bot for efficient chain queries (optional; can be replaced with direct ABI calls if deploy footprint is a concern).

5) Interfaces and vendor copies
   - Include minimal interfaces: IERC3156, IOdos, IDLoopCoreDLend, RewardClaimable, IERC20 (if OZ not vendored via npm).
   - Keep namespaces and versions consistent.

6) Deployment scripts
   - `scripts/deploy_periphery.ts`: deploy `RewardCompounderDLendOdos` with network-specific addresses from `config/networks/*`. Save deployed addresses to `config/deploy-ids.ts`-like module.
   - Add `make deploy.sonic_mainnet`/`make deploy.sonic_testnet` targets to invoke hardhat scripts with proper `--network`.

7) Bot runtime (TypeScript)
   - `quoting.ts`:
     - Fetch `S = exchangeThreshold()` and `requiredCollateral = previewMint(S)` from CORE.
     - Estimate `K` by simulating/mirroring borrow math or using deltas from a static call to `mint` if feasible; otherwise conservative bound using current leverage targets and price.
     - Query rewards via `RewardHelper` or direct controller calls; apply `treasuryFeeBps` to compute `netZ`.
     - Compute required dUSD input for exact-out (via Odos/0x quote API). In tests, use mock; in prod, call API; pass pre-built `swapCalldata` to periphery.
     - Feasibility: `K + netZ >= X + fee` with buffers for fees and slippage.
   - `periphery.ts`:
     - Build transaction to `RewardCompounderDLendOdos.run(swapCalldata, flashAmount, slippageBps)` and send via signer.
   - `runner.ts`:
     - Loop on interval; for each vault from config, run quote; if feasible, submit tx; log and notify outcome.
   - `notification.ts`:
     - Slack webhook methods similar to `dlend-liquidator` (channel, message formatting). Fully mocked in unit tests.
   - `config.ts`/`networks/*`:
     - Store addresses: CORE, DUSD, COLLATERAL, FLASH_LENDER, ODOS, RewardController, Pool, AddressProvider, RewardHelper (if deployed), leverage parameters, slippage and fee buffers.

8) Linting and formatting
   - Port `eslint.config.mjs` from `dloop-rebalancer` with matching rules. Add `make lint` that runs eslint for TS and solhint/solhint-config for solidity (if applicable in this repo).

9) Docker
   - Dockerfile patterned after `dlend-liquidator`: node base image, install deps, build contracts + TS, minimal runtime layer; envs provided via `.env`.
   - `make docker.build` builds the image; optional `make docker.run` for local runs.

10) CI (optional stretch)

- GitHub Actions to run lint, compile, and tests.

Test Plan (with mock cases)
Contract tests (Hardhat, TypeScript)

1) Full-flow success (threshold-based)
   - Setup mocks: dUSD, collateral, MockDLoopCoreDLend with:
     - `exchangeThreshold()` returns S > 0
     - `previewMint(S)` returns requiredCollateral
     - `mint(S)` transfers `K` dUSD to caller and mints shares
     - `compoundRewards(S, [dUSD], receiver)` transfers `Z` dUSD to receiver, but pays treasury fee internally so netZ delivered
   - MockFlashLender lends X dUSD and requires fee. MockOdosRouter consumes ≤ X for exact-out to deliver requiredCollateral.
   - Call `RewardCompounderDLendOdos.run` with swapCalldata and flashAmount X; assert:
     - Collateral acquired ≥ requiredCollateral
     - Exactly S shares minted
     - compoundRewards succeeds, netZ transferred
     - Flash repaid and contract ends with profit ≥ 0
     - Events emitted.

2) Revert: below threshold
   - `exchangeThreshold()` returns S; force `run` to attempt smaller S via altered calldata (or set S=0 in mock). Expect revert with threshold check.

3) Revert: insufficient swap output
   - MockOdosRouter returns less than requiredCollateral (or consumes > flash X). Expect revert `insufficient collateral` or custom error.

4) Revert: deposit blocked (imbalanced)
   - Mock CORE `maxDeposit(address)` returns 0. Expect revert `deposit disabled`.

5) Revert: not enough to repay
   - Configure `K + netZ < X + fee` (e.g., lower Z or higher fee). Expect revert before approving repayment.

6) Exact-in/out mismatch guard
   - Provide swapCalldata flagged as exact-in; ensure contract detects and reverts or fails via post-condition checks (i.e., insufficient collateral).

7) Treasury fee accounting
   - Vary `treasuryFeeBps`; verify netZ used in profitability and balances is correct.

8) Edge: zero rewards
   - `compoundRewards` returns netZ = 0; ensure flow reverts or produces loss and is guarded by off-chain check (in tests, ensure on-chain reverts via repayment guard).

Bot tests (unit + integration with mocks)

1) Quoting logic — profitable path
   - Mock helper/controller returns rewards Z, feeBps; mock previewMint(S) and Odos quote for X, fee.
   - Verify feasibility `K + netZ >= X + fee` passes and runner decides to execute.

2) Quoting logic — unprofitable path
   - Same setup but set `Z` lower; verify runner skips execution.

3) Swap calldata construction
   - Build mock exact-out calldata; ensure periphery.ts forwards it without modification and contract decodes successfully.

4) Notifications
   - Mock Slack webhook; verify success and error messages are sent with transaction hash and metrics (S, X, K, Z, fee, profit).

5) Config parsing and safety
   - Missing envs cause process to exit with a clear error.

6) Large test file splitting (if needed)
   - If any test suite becomes flaky or too heavy, split into smaller describe groups per file per the hint.

Deployment Plan

- Pre-req: Fill `config/networks/*` with addresses for CORE, tokens, FLASH_LENDER, ODOS, RewardsController, Pool, AddressProvider.
- Build: `make compile` to compile contracts; confirm no errors.
- Deploy helper (optional): `hardhat run scripts/deploy_reward_helper.ts --network sonic_mainnet`.
- Deploy periphery: `make deploy.sonic_mainnet` runs `scripts/deploy_periphery.ts` which deploys `RewardCompounderDLendOdos` and records address.
- Verify: `scripts/verify.ts` with constructor args; store addresses in config.

Operational Runbook

- Configure `.env` for RPC, private key, Slack webhook, polling interval, slippageBps, minProfitBps, and safety buffers.
- Dry-run mode: only quote and log; no tx sent.
- Live mode: on profitable quote, send `run` tx; handle errors and notify Slack.

Security and Safety Checks

- Validate `maxDeposit(address(this)) > 0` before mint.
- Validate exact-out swap delivered collateral ≥ requiredCollateral; cap dUSD spent to flash amount.
- Use safe approvals; reset to zero before re-approving if needed.
- Reentrancy: onFlashLoan internal ordering prevents external callbacks besides swap venue.
- Access control: periphery callable by anyone; profit accrues to caller or contract owner as designed (decide in constructor).

Review Checklist (to satisfy ai-review expectations)

- Compile: `make compile` passes on a clean checkout.
- Deploy scripts: `make deploy.sonic_mainnet` is present and correct; constructor args wired from config.
- Swap logic correctness: exact-out only; mismatch cases tested; slippageBps guard present.
- Linting: `eslint` setup matches `dloop-rebalancer`; `make lint` passes for TS and Solidity.
- Tests: `make test` passes; external services are mocked (Slack, Odos API, flash lender).
- Repo independence: no imports from monorepo paths; all interfaces vendored or pulled via pinned npm deps.

Risks & Mitigations

- Front-running: FCFS and private tx submission recommended; add gas and maxPriorityFee params.
- Oracle/price movement: slippage buffer adjustable via config; small over-provision on collateral target.
- Flash liquidity unavailable: handle lender reverts; back off and retry later.
- Reward drift: off-chain quote refresh before sending tx; small time window between quote and submit minimized.

Acceptance Criteria

- Contracts compile and tests pass with mocks.
- Docker image builds with `make docker.build`.
- Bot can perform a full-flow compound on mocks, repaying flash with no loss when profitable.
- Lint passes with config aligned to `dloop-rebalancer`.

Detailed Contract Specification and Pseudocode

Core Interfaces and Types

- Tokens
  - `IERC20` with `balanceOf`, `transfer`, `transferFrom`, `approve`, `allowance`, `decimals`.
  - Optional: `IERC4626Like` (`asset()`, `totalAssets()`).
- Flashloans
  - `IERC3156FlashLender.flashLoan(address receiver, address token, uint256 amount, bytes data)`
  - `IERC3156FlashLender.flashFee(address token, uint256 amount)`
  - `IERC3156FlashBorrower.onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes data)`
- DLoop Core (minimal)
  - `exchangeThreshold() -> uint256`
  - `previewMint(uint256 shares) -> uint256 assets`
  - `maxDeposit(address) -> uint256`
  - `mint(uint256 shares, address receiver) -> uint256 assets`
  - `compoundRewards(uint256 amount, address[] rewardTokens, address receiver)`
  - `treasuryFeeBps() -> uint256` (if exposed; else compute off-chain)
  - `asset() -> address` (collateral token; if available)
- Odos Router (minimal)
  - `execute(bytes data) returns (uint256 amountOut)` or generic `call(data)` depending on router ABI

Storage Layout (Base)

- `IERC20 DUSD`, `IERC20 COLLATERAL`, `IERC3156FlashLender FLASH`, `IDLoopCoreDLend CORE`, `address SWAP_AGG`
- `bytes32 CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan")`

Events and Errors

- Events: `RunStarted`, `SwapExecuted`, `Minted`, `Compounded`, `FlashRepaid`, `RunProfit`
- Errors: `InvalidLender`, `InvalidToken`, `ZeroThreshold`, `DepositDisabled`, `SwapFailed`, `InsufficientCollateral`, `NotEnoughToRepay`

Pseudocode — RewardCompounderDLendBase.sol

```solidity
contract RewardCompounderDLendBase is IERC3156FlashBorrower {
  IERC20 public immutable DUSD;
  IERC20 public immutable COLLATERAL;
  IERC3156FlashLender public immutable FLASH;
  IDLoopCoreDLend public immutable CORE;
  address public immutable SWAP_AGG;
  bytes32 internal constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

  event RunStarted(uint256 sharesTarget, uint256 flashAmount);
  event SwapExecuted(uint256 spentDUSD, uint256 gotCollateral);
  event Minted(uint256 sharesMinted, uint256 assetsUsed, uint256 kBorrowed);
  event Compounded(uint256 netDUSDReward);
  event FlashRepaid(uint256 totalDebt);
  event RunProfit(int256 profit);

  error InvalidLender(); error InvalidToken(); error ZeroThreshold(); error DepositDisabled();
  error SwapFailed(); error InsufficientCollateral(); error NotEnoughToRepay();

  constructor(address _dusd, address _collateral, address _flash, address _core, address _swapAgg) {
    require(_dusd!=address(0)&&_collateral!=address(0)&&_flash!=address(0)&&_core!=address(0)&&_swapAgg!=address(0),"bad");
    DUSD = IERC20(_dusd); COLLATERAL = IERC20(_collateral); FLASH = IERC3156FlashLender(_flash);
    CORE = IDLoopCoreDLend(_core); SWAP_AGG = _swapAgg;
  }

  function run(bytes calldata swapCalldata, uint256 flashAmount, uint256 slippageBps) external {
    require(slippageBps <= 10_000, "slippage too high");
    if (CORE.maxDeposit(address(this)) == 0) revert DepositDisabled();
    uint256 S = CORE.exchangeThreshold(); if (S == 0) revert ZeroThreshold();
    uint256 requiredCollateral = CORE.previewMint(S);
    uint256 bufferedCollateral = requiredCollateral * (10_000 + slippageBps) / 10_000;
    emit RunStarted(S, flashAmount);
    FLASH.flashLoan(address(this), address(DUSD), flashAmount, abi.encode(swapCalldata, bufferedCollateral, S));
  }

  function onFlashLoan(address, address token, uint256 amount, uint256 fee, bytes calldata data) external returns (bytes32) {
    if (msg.sender != address(FLASH)) revert InvalidLender();
    if (token != address(DUSD)) revert InvalidToken();
    (bytes memory swapCalldata, uint256 collateralTarget, uint256 S) = abi.decode(data,(bytes,uint256,uint256));

    uint256 dusdBefore = DUSD.balanceOf(address(this));
    DUSD.approve(SWAP_AGG, amount);
    (bool ok,) = SWAP_AGG.call(swapCalldata); if (!ok) revert SwapFailed();
    uint256 got = COLLATERAL.balanceOf(address(this)); if (got < collateralTarget) revert InsufficientCollateral();
    uint256 spent = dusdBefore - DUSD.balanceOf(address(this)); emit SwapExecuted(spent, got);

    COLLATERAL.approve(address(CORE), got);
    uint256 dusdBeforeMint = DUSD.balanceOf(address(this));
    uint256 minted = CORE.mint(S, address(this)); require(minted == S, "mint mismatch");
    uint256 kBorrowed = DUSD.balanceOf(address(this)) - dusdBeforeMint; emit Minted(minted, got, kBorrowed);

    IERC20(address(CORE)).approve(address(CORE), S);
    address[] memory rewardTokens = new address[](1); rewardTokens[0] = address(DUSD);
    uint256 dusdBeforeComp = DUSD.balanceOf(address(this));
    CORE.compoundRewards(S, rewardTokens, address(this));
    uint256 netReward = DUSD.balanceOf(address(this)) - dusdBeforeComp; emit Compounded(netReward);

    uint256 totalDebt = amount + fee; uint256 bal = DUSD.balanceOf(address(this));
    if (bal < totalDebt) revert NotEnoughToRepay();
    DUSD.approve(address(FLASH), totalDebt); emit FlashRepaid(totalDebt);
    emit RunProfit(int256(bal) - int256(totalDebt));
    return CALLBACK_SUCCESS;
  }
}
```

Pseudocode — RewardCompounderDLendOdos.sol

```solidity
contract RewardCompounderDLendOdos is RewardCompounderDLendBase {
  constructor(address d,address c,address f,address core,address agg)
    RewardCompounderDLendBase(d,c,f,core,agg) {}

  // If using a library/adapter, override internal swap with Odos-specific execution if base factors it out.
}
```

Implementation Notes for Aggregator Calldata

- Off-chain quoting must produce exact-out calldata (dUSD→COLLATERAL) to buy `collateralTarget` with max spend ≤ `flashAmount`.
- In tests, MockOdosRouter can accept `(expectedOut, maxIn, exactOut)` encoded in calldata to assert behavior.

Detailed Bot Logic (TypeScript)

- Quoting and execution loop:
  - Read `S`, `requiredCollateral`, get Odos quote for exact-out -> `X` and `swapCalldata`.
  - Estimate `fee` via `FLASH.flashFee` or static bps.
  - Estimate `K` and `netZ`. If `K + netZ >= X + fee + buffer`, send tx to `periphery.run(swapCalldata, X, slippageBps)`.
  - Await receipt; on success/failure, send Slack message with structured payload.

Deployment Scripts — Detailed Steps

- `deploy_reward_helper.ts`: deploy helper with Pool, RewardsController, AddressesProvider from `config/networks`.
- `deploy_periphery.ts`: deploy Odos periphery with CORE, FLASH, DUSD, COLLATERAL, ODOS router.
- Persist addresses in `config/deploy-ids.ts`.

Makefile Targets (concrete)

- compile, lint, test, docker.build, deploy.sonic_mainnet, deploy.sonic_testnet as described above.

Mock Specifications

- MockERC20 (mint, transfer, decimals), MockFlashLender (feeBps, maxLoan), MockOdosRouter (underfill/revert toggles), MockDLoopCoreDLend (threshold, previewMint, mint->K, compoundRewards->netZ).

Concrete Test Values

- Example defaults: S=1e18; previewMint=300e18; K=200e18; Z=110e18; treasuryFeeBps=500; flashFeeBps=9; Odos maxInput X≈295e18; profitable: K+netZ=304.5e18 vs X+fee≈297.655e18.

Exact-Out vs Exact-In Guarding

- Enforce by post-swap collateral balance check and not exceeding flash amount.

ESLint and Repo Independence

- Mirror `dloop-rebalancer` eslint and avoid monorepo-relative imports; vendor interfaces.

README Key Sections

- Quick start, config, local mocks, Docker, safety notes.
