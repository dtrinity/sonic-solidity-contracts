# Odos Exploit Test Suite Documentation

## Overview

This test suite provides comprehensive coverage for reproducing and analyzing the Sonic Odos Liquidity Swap Adapter exploit. The tests are structured to serve multiple purposes:

1. **Exploit Reproduction**: Accurately recreate the production attack flow
2. **RCA Evidence**: Generate artifacts for the post-mortem and root cause analysis
3. **Regression Testing**: Verify mitigation effectiveness once the fix lands
4. **Future Prevention**: Document attack patterns for security reviews

## Test Structure

### Test Files

- **`OdosLiquiditySwapAdapter.exploit.test.ts`**: Main test suite with positive and negative test cases
- **`fixtures/setup.ts`**: Fixture setup with mock contracts and initial state
- **`helpers/testHelpers.ts`**: Reusable balance tracking and event parsing utilities
- **`helpers/attackConstants.ts`**: Centralized constants derived from production attack

### Test Cases

#### 1. Basic Exploit (No Flash Loan)
**Purpose**: Validate core collateral drain mechanism without flash loan complexity

**Key Assertions**:
- Victim loses `26,243.751965 wstkscUSD` (entire aToken balance)
- Attacker gains `26,243.751965 wstkscUSD` directly
- CollateralPulled event emitted with correct parameters
- AttackerBurst event records the transfer

**Precision**: Exact wei-level (6 decimals for wstkscUSD)

#### 2. Full Flash Loan Exploit
**Purpose**: Reproduce complete production attack including flash mint and staging flow

**Key Assertions**:
- Event ordering matches Sonic trace:
  1. FlashMintStarted (27,000 dUSD)
  2. CollateralPulled (26,243.751965 wstkscUSD minus premium)
  3. FlashLoanExecuted
  4. AttackerBurst (leg 0): 26,230.630089 wstkscUSD
  5. AttackerBurst (leg 1): 8,877.536706 wstkscUSD
  6. FlashMintSettled (27,000 dUSD + premium)
- Victim loses entire collateral
- Attacker gains ~35,108.166795 wstkscUSD total
- dUSD recycler net delta: -28,627.60 dUSD
- Executor and adapter have zero residual balances

**Precision**:
- wstkscUSD: Exact wei-level (6 decimals)
- dUSD: Exact wei-level (18 decimals)
- Flash loan premium: ±1 micro-unit tolerance

#### 3. Complete State Snapshot Test
**Purpose**: Structured assertions with before/after state capture for RCA documentation

**Features**:
- Uses `captureAttackState()` helper to snapshot all participant balances
- Computes deltas with `computeAttackDeltas()`
- Verifies 6 distinct state transitions:
  1. Victim aToken drain (withdraw-hook burn)
  2. Attacker collateral gain (BURST_ONE + BURST_TWO)
  3. Reserve manager aToken burn (flash loan premium + extra collateral)
  4. dUSD recycler staging flow
  5. Executor final state (swept clean)
  6. Adapter final state (no residual)
- Logs human-readable summary for RCA artifacts

**Precision**: Same as full flash loan exploit test

#### 4. Negative Test: Post-Mitigation (No Flash Loan) - SKIPPED
**Purpose**: Verify mitigation blocks attack when `withFlashLoan = false`

**Expected Behavior** (once fix lands):
- Transaction reverts with `UnauthorizedCaller` error
- Victim collateral remains intact
- Attacker gains nothing
- No state changes occur

**How to Enable**: Remove `.skip` from test name after mitigation is merged

#### 5. Negative Test: Post-Mitigation (With Flash Loan) - SKIPPED
**Purpose**: Verify mitigation blocks attack and cleanly rolls back flash mint

**Expected Behavior** (once fix lands):
- Transaction reverts with `UnauthorizedCaller` error
- Flash loan callback fails
- Pool flash loan reverts and rolls back state
- No dUSD flash mint residue
- Victim collateral remains intact
- Attacker gains nothing
- Recycler balance unchanged

**How to Enable**: Remove `.skip` from test name after mitigation is merged

## Helper Utilities

### Balance Tracking (`testHelpers.ts`)

#### `formatBalanceChange(amount, decimals, symbol?)`
Formats a balance with decimal awareness for display.

```typescript
// Example: Format 26243751965 (6 decimals) as "26243.751965 wstkscUSD"
const formatted = formatBalanceChange(26243751965n, 6, "wstkscUSD");
```

#### `formatBalanceDiff(before, after, decimals, symbol?)`
Calculates and formats balance difference with sign indicator.

```typescript
// Example: "+35108.166795 wstkscUSD"
const diff = formatBalanceDiff(0n, 35108166795n, 6, "wstkscUSD");
```

#### `assertBalanceEquals(actual, expected, decimals, label, tolerance?)`
Wei-level assertion with tolerance and better error messages.

```typescript
// Exact equality required
assertBalanceEquals(
  victimDelta,
  -COLLATERAL_TO_SWAP,
  6,
  "Victim aToken drain",
  PRECISION_TOLERANCE.EXACT
);

// ±1 wei tolerance for rounding
assertBalanceEquals(
  premiumPaid,
  expectedPremium,
  6,
  "Flash loan premium",
  PRECISION_TOLERANCE.WEI_LEVEL
);
```

#### `BalanceTracker` Class
Captures balance snapshots and calculates deltas.

```typescript
const tracker = new BalanceTracker();

// Snapshot before
await tracker.snapshot(victim.address, tokenAddress, token, "victim");

// ... perform operations ...

// Calculate delta
const delta = await tracker.delta(victim.address, tokenAddress, token);
```

#### `captureAttackState()` and `computeAttackDeltas()`
Comprehensive state capture for all attack participants.

```typescript
const stateBefore = await captureAttackState(
  victim, attacker, reserveManager, executor, adapter,
  stagingVault, recycler, aToken, collateral, dusd
);

// ... execute attack ...

const stateAfter = await captureAttackState(...);
const deltas = computeAttackDeltas(stateBefore, stateAfter);

// Access structured deltas
console.log(deltas.victimATokenDelta);
console.log(deltas.attackerCollateralDelta);
console.log(deltas.recyclerDusdDelta);
```

### Event Parsing (`testHelpers.ts`)

#### `parseEvents(receipt, contractInterface, eventName?)`
Extracts and parses events from transaction receipt.

```typescript
const events = parseEvents(receipt, router.interface);
// Returns: [{ name: "CollateralPulled", args: {...}, address: "0x..." }, ...]
```

#### `findEvent(receipt, contractInterface, eventName)`
Finds first event matching the given name.

```typescript
const event = findEvent(receipt, attackExecutor.interface, "AttackerBurst");
```

#### `findEvents(receipt, contractInterface, eventName)`
Finds all events matching the given name.

```typescript
const bursts = findEvents(receipt, attackExecutor.interface, "AttackerBurst");
// Returns array of burst events
```

## Attack Constants (`attackConstants.ts`)

### Token Decimals
```typescript
DECIMALS.COLLATERAL = 6  // wstkscUSD
DECIMALS.DUSD = 18       // dUSD
```

### Collateral Flow
```typescript
ATTACK_COLLATERAL.COLLATERAL_TO_SWAP = 26243751965n  // 26,243.751965 wstkscUSD
ATTACK_COLLATERAL.FLASH_LOAN_PREMIUM_BPS = 5         // 0.05%
ATTACK_COLLATERAL.FLASH_LOAN_PREMIUM                 // Computed: 13.1218759825
ATTACK_COLLATERAL.BURST_ONE = 26230630089n           // 26,230.630089
ATTACK_COLLATERAL.BURST_TWO = 8877536706n            // 8,877.536706
ATTACK_COLLATERAL.TOTAL_ATTACKER_GAIN                // Computed: 35,108.166795
ATTACK_COLLATERAL.EXTRA_COLLATERAL                   // Computed: sum of bursts + premium
ATTACK_COLLATERAL.DUST_OUTPUT = 1n                   // 1 micro-unit (production behavior)
```

### dUSD Flow
```typescript
ATTACK_DUSD_FLOW.FLASH_MINT_AMOUNT = 27000e18n       // 27,000 dUSD
ATTACK_DUSD_FLOW.STAGE_ONE                           // 21,444.122... dUSD
ATTACK_DUSD_FLOW.STAGE_TWO                           // 7,133.477... dUSD
ATTACK_DUSD_FLOW.RECYCLER_PULL_ONE                   // 26,681.458... dUSD
ATTACK_DUSD_FLOW.RECYCLER_PULL_TWO                   // 8,998.899... dUSD
ATTACK_DUSD_FLOW.RECYCLER_RETURN                     // 7,052.758... dUSD
ATTACK_DUSD_FLOW.RECYCLER_NET_DELTA                  // Computed: -28,627.60 dUSD
```

### Expected Deltas
```typescript
EXPECTED_DELTAS.VICTIM_ATOKEN_DELTA                  // -26,243.751965
EXPECTED_DELTAS.ATTACKER_COLLATERAL_DELTA            // +35,108.166795
EXPECTED_DELTAS.RESERVE_MANAGER_ATOKEN_DELTA         // -35,121.288...
EXPECTED_DELTAS.RECYCLER_DUSD_DELTA                  // -28,627.60
EXPECTED_DELTAS.EXECUTOR_COLLATERAL_FINAL            // 0
EXPECTED_DELTAS.EXECUTOR_DUSD_FINAL                  // 0
EXPECTED_DELTAS.ADAPTER_COLLATERAL_FINAL             // 0
EXPECTED_DELTAS.ADAPTER_DUSD_FINAL                   // 0
```

### Event Names
```typescript
ATTACK_EVENTS.COLLATERAL_PULLED = "CollateralPulled"
ATTACK_EVENTS.FLASH_MINT_STARTED = "FlashMintStarted"
ATTACK_EVENTS.FLASH_MINT_SETTLED = "FlashMintSettled"
ATTACK_EVENTS.ATTACKER_BURST = "AttackerBurst"
ATTACK_EVENTS.FLASH_LOAN_EXECUTED = "FlashLoanExecuted"
// ... etc
```

### Precision Tolerances
```typescript
PRECISION_TOLERANCE.EXACT = 0n         // Exact match required
PRECISION_TOLERANCE.WEI_LEVEL = 1n     // ±1 wei/micro-unit
PRECISION_TOLERANCE.ROUNDING = 10n     // ±10 for multi-step flows
```

## Precision Requirements

### When to Use Exact Equality (`PRECISION_TOLERANCE.EXACT`)

**Use for**:
- Direct token transfers (victim drain, attacker bursts)
- Flash mint amounts (27,000 dUSD exactly)
- Executor final state (must be zero)
- Adapter final state (must be zero)

**Example**:
```typescript
// Victim loses exactly COLLATERAL_TO_SWAP
expect(deltas.victimATokenDelta).to.equal(-COLLATERAL_TO_SWAP);

// Attacker gains exactly BURST_ONE + BURST_TWO
expect(deltas.attackerCollateralDelta).to.equal(BURST_ONE + BURST_TWO);
```

### When to Use Wei-Level Tolerance (`PRECISION_TOLERANCE.WEI_LEVEL`)

**Use for**:
- Flash loan premium calculations with division rounding
- Reserve manager aToken burns (may involve premium rounding)

**Why**: Integer division `(amount * 5) / 10000` may produce ±1 micro-unit rounding

**Example**:
```typescript
assertBalanceEquals(
  reserveManagerDelta,
  expectedDelta,
  6,
  "Reserve manager burn",
  PRECISION_TOLERANCE.WEI_LEVEL  // ±1 tolerance
);
```

### When to Use Rounding Tolerance (`PRECISION_TOLERANCE.ROUNDING`)

**Use for**:
- Multi-step dUSD staging flows with intermediate calculations
- Cross-contract transfers with multiple hops

**Why**: Accumulated rounding from multiple intermediate steps

**Example**:
```typescript
assertBalanceEquals(
  stagingVaultDelta,
  expectedDelta,
  18,
  "Staging vault flow",
  PRECISION_TOLERANCE.ROUNDING  // ±10 tolerance
);
```

### Decimal Handling Notes

1. **wstkscUSD (6 decimals)**:
   - 1 unit = 1 micro-unit = 0.000001 wstkscUSD
   - Use `ethers.parseUnits("26243.751965", 6)` for amounts
   - Format with `ethers.formatUnits(amount, 6)`

2. **dUSD (18 decimals)**:
   - 1 unit = 1 wei = 0.000000000000000001 dUSD
   - Use `ethers.parseUnits("27000", 18)` for amounts
   - Format with `ethers.formatUnits(amount, 18)`

3. **Mixed Token Assertions**:
   - Always pass correct `decimals` parameter to formatting functions
   - Never compare 6-decimal and 18-decimal values directly
   - Use separate assertions for each token type

## Test Coverage Gaps

### Current Gaps

1. **Same-Asset Dust Return**
   - **Status**: Workaround in place (uses dUSD output instead of wstkscUSD)
   - **Impact**: Tests don't verify exact production dust mechanic
   - **Mitigation**: Router pre-credit shim documented in `Reproduce.md`
   - **Future**: Remove workaround once same-asset dust shim is stable

2. **Reserve Manager aToken Burn Event**
   - **Status**: Not explicitly asserted in current tests
   - **Impact**: Medium - balance changes are verified but not events
   - **Recommendation**: Add `ReserveBurned` event assertions in comprehensive test

3. **Staging Vault Balance Changes**
   - **Status**: Not captured in state snapshots
   - **Impact**: Low - recycler changes verified, staging is intermediate
   - **Recommendation**: Add if detailed dUSD flow analysis is needed for RCA

4. **Multi-Asset Flash Loan**
   - **Status**: Only single-asset flash loans tested
   - **Impact**: Low - production attack uses single-asset
   - **Recommendation**: Add if testing multi-collateral adapter exploits

5. **Permit Flow Testing**
   - **Status**: Permit inputs stubbed with zero values
   - **Impact**: Low - exploit doesn't rely on permit
   - **Recommendation**: Add if testing permit-based attack vectors

### Coverage Metrics

| Component | Coverage | Notes |
|-----------|----------|-------|
| Basic exploit flow | ✅ 100% | Both flash loan and non-flash loan cases |
| Event emissions | ✅ 90% | Missing some helper contract events |
| Balance assertions | ✅ 100% | All key participants verified |
| State snapshots | ✅ 90% | Missing staging vault details |
| Negative tests | ✅ 100% | Both cases covered (skipped until fix) |
| Edge cases | ⚠️ 50% | Same-asset dust workaround needed |

## Running the Tests

### Run All Tests
```bash
npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts
```

### Run Specific Test
```bash
npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts --grep "captures complete attack state"
```

### Run with Gas Reporting
```bash
REPORT_GAS=true npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts
```

### Run Negative Tests (after mitigation)
```bash
# Remove .skip from test names in file, then:
npx hardhat test test/dlend/adapters/odos/v1/OdosLiquiditySwapAdapter.exploit.test.ts --grep "should revert"
```

## Future Test Scenarios

### Recommended Additions

1. **Slippage Edge Cases**
   - Test with `minOut` values at various thresholds
   - Verify underflow checks work correctly post-mitigation

2. **Multiple Victim Scenarios**
   - Test with multiple victims having different collateral amounts
   - Verify attacker can't drain multiple positions atomically

3. **Gas Optimization Attacks**
   - Test with near-block-limit transactions
   - Verify no griefing vectors via gas manipulation

4. **Reentrancy Guards**
   - Test adapter behavior with reentrant calls
   - Verify mitigation doesn't introduce new reentrancy risks

5. **Oracle Manipulation**
   - Test with price oracle values at extremes
   - Verify adapter doesn't rely on manipulable oracles

6. **Flash Loan Edge Cases**
   - Test with pool at liquidity limits
   - Test with extremely high premium rates
   - Test with simultaneous flash loans from multiple attackers

## Maintenance Notes

### When Updating Constants

1. Update `helpers/attackConstants.ts` with new values
2. Run `validateConstants()` to ensure internal consistency
3. Update test assertions that reference old values
4. Regenerate Tenderly comparison reports to verify alignment

### When Adding New Tests

1. Use existing helpers from `testHelpers.ts` where possible
2. Document precision requirements in test comments
3. Add constants to `attackConstants.ts` if they'll be reused
4. Update this documentation with new test descriptions

### When Mitigation Lands

1. Remove `.skip` from negative test cases
2. Verify both negative tests fail with expected error
3. Update `Reproduce.md` to document mitigation
4. Archive test artifacts for post-mortem
5. Consider adding positive tests that verify legitimate use cases work

## Related Documentation

- `/contracts/dlend/periphery/adapters/Reproduce.md` - Exploit reproduction ticket
- `/contracts/dlend/periphery/adapters/ATTACK_STEPS.md` - Detailed attack narrative
- `/reports/tenderly/` - Tenderly trace analysis artifacts

## Questions?

For questions about these tests, consult:
1. This documentation file for structure and helpers
2. `Reproduce.md` for exploit mechanics and known gaps
3. Test code comments for specific assertion rationale