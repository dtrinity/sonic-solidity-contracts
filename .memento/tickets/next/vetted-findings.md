**Issue**: Mix of custom errors and require statements

**Examples**:
- Custom errors in DStakeToken: `ZeroAddress()`, `ZeroShares()`
- Require statements in DStakeRouterDLend: `require(actualToVaultAsset == toVaultAsset, "Adapter asset mismatch")`

**Recommendation**: Standardize on custom errors for gas efficiency and consistency

---

**Issue**: Some functions have incomplete or misleading documentation

**Example**: `_withdraw` function comment doesn't mention the critical allowance check

---

**Location**: `DPoolVaultLP.sol` lines 269-277

**Description**: Withdrawal fees are calculated on the gross LP amount, but the `Withdraw` event emits the net amount. This could cause confusion in accounting.

**Impact**: Off-chain monitoring systems might incorrectly track withdrawals.

**Recommendation**: Consider emitting a separate event for fees collected.

Note: We made a similar fix in dSTAKE already, use that as a reference.