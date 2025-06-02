# Refactor Withdrawal Fee Logic for Consistency

**Date:** 2024-07-26

**Status:** Completed

## Goal

Unify the withdrawal fee logic across `DStakeToken.sol` and `DPoolVaultLP.sol` to ensure consistent behavior and correct fee accounting, especially in preview functions.

## Problem Statement

Currently, `DStakeToken.sol` and `DPoolVaultLP.sol` implement their withdrawal fee mechanisms independently. This leads to a few issues:

1.  **Inconsistent Fee Application in Previews:** `DPoolVaultLP.sol` does not correctly account for withdrawal fees in its `previewWithdraw` and `previewRedeem` functions. This can mislead users about the actual amount of assets they will receive or the number of shares required for a specific asset amount.
2.  **Code Duplication:** Similar fee logic (setting fees, calculating fees) is duplicated across both contracts, increasing maintenance overhead.
3.  **Divergent Implementations:** While both have withdrawal fees, the nuances of their implementation (e.g., how previews are handled) differ. We aim to align them, leaning towards the more robust approach in `DStakeToken.sol`.

## Proposed Solution

1.  **Create `SupportsWithdrawalFee.sol`:**
    *   A new abstract contract will be created at `contracts/common/SupportsWithdrawalFee.sol`.
    *   This contract will encapsulate the shared withdrawal fee logic, including:
        *   State variable for `withdrawalFeeBps`.
        *   Events: `WithdrawalFeeSet` and `WithdrawalFeeApplied`.
        *   Internal functions: `_initializeWithdrawalFee`, `_setWithdrawalFee`, `_calculateWithdrawalFee`, `_getNetAmountAfterFee` (for `previewRedeem`), and `_getGrossAmountRequiredForNet` (for `previewWithdraw`).
        *   An abstract function `_maxWithdrawalFeeBps()` to be implemented by inheriting contracts to define their specific maximum fee.
    *   This approach allows both upgradeable (`DStakeToken`) and non-upgradeable (`DPoolVaultLP`) contracts to inherit this common logic.

2.  **Refactor `DStakeToken.sol`:**
    *   Inherit from `SupportsWithdrawalFee.sol`.
    *   Remove its local withdrawal fee state and functions, delegating to the abstract contract.
    *   Implement the `_maxWithdrawalFeeBps()` function.
    *   Update `initialize`, `_withdraw`, `previewWithdraw`, `previewRedeem`, and `setWithdrawalFee` functions to use the helpers from `SupportsWithdrawalFee`.
    *   Ensure events are emitted correctly via the abstract contract.

3.  **Refactor `DPoolVaultLP.sol`:**
    *   Inherit from `SupportsWithdrawalFee.sol`.
    *   Remove its local withdrawal fee state and functions, delegating to the abstract contract.
    *   Implement the `_maxWithdrawalFeeBps()` function.
    *   Update its constructor, `_withdraw`, and `setWithdrawalFee` functions.
    *   **Crucially, override `previewWithdraw` and `previewRedeem` (from ERC4626) to correctly incorporate withdrawal fees using the helper functions from `SupportsWithdrawalFee.sol`. This addresses the current shortcoming.**
    *   Ensure events are emitted correctly.

## Rationale

*   **Consistency:** Ensures withdrawal fees are calculated and applied uniformly across different vault types.
*   **Accuracy:** Fixes the bug in `DPoolVaultLP.sol` where preview functions do not account for fees.
*   **Maintainability:** Reduces code duplication, making future updates to fee logic simpler and less error-prone.
*   **Clarity:** Centralizes fee logic, making it easier to understand and audit.
*   **Alignment:** Follows the more comprehensive fee handling pattern already present in `DStakeToken.sol` for preview functions.

## Implementation Notes

*   **State Variable Visibility:** Changed `withdrawalFeeBps` from `public` to `internal` (`withdrawalFeeBps_`) in `SupportsWithdrawalFee` to avoid inheritance conflicts with non-upgradeable contracts. Added a public getter `getWithdrawalFeeBps()`.
*   **Interface Updates:** Updated `IDPoolVaultLP` interface to remove redundant events and errors that are now handled by `SupportsWithdrawalFee`.
*   **Error Handling:** Removed duplicate error declarations from `DPoolVaultLP.sol` since they're already defined in the interface.
*   **Preview Function Fixes:** Both `DStakeToken.sol` and `DPoolVaultLP.sol` now correctly account for withdrawal fees in their preview functions, ensuring accurate user expectations.
*   **Naming Change:** Renamed from `AbstractWithdrawalFee` to `SupportsWithdrawalFee` for better clarity and naming consistency.
*   **Test Fixes:** Added missing `maxWithdrawalFeeBps()` public function to `DStakeToken.sol` and updated error names to match the actual implementation.

## Tasks

- [x] Create `contracts/common/SupportsWithdrawalFee.sol` (renamed from `AbstractWithdrawalFee.sol`).
- [x] Refactor `contracts/vaults/dstake/DStakeToken.sol` to use `SupportsWithdrawalFee.sol`.
- [x] Refactor `contracts/vaults/dpool/core/DPoolVaultLP.sol` to use `SupportsWithdrawalFee.sol`.
- [x] Update `contracts/vaults/dpool/core/interfaces/IDPoolVaultLP.sol` to align with the new fee mechanism.
- [x] Update relevant design documents (`contracts/vaults/dstake/Design.md`, `contracts/vaults/dpool/Design.md`) to reflect the new shared fee mechanism.
- [x] Fix test failures by adding missing functions and correcting error/event names.
- [ ] Ensure comprehensive test coverage for the new fee logic and its integration in both contracts.

## Results

✅ **Successfully completed the refactor with the following improvements:**

1. **Unified Fee Logic:** Both `DStakeToken.sol` and `DPoolVaultLP.sol` now use the same withdrawal fee calculation and preview logic from `SupportsWithdrawalFee.sol`.

2. **Fixed Preview Functions:** `DPoolVaultLP.sol` preview functions (`previewWithdraw` and `previewRedeem`) now correctly account for withdrawal fees, addressing the original bug.

3. **Consistent Events:** Both contracts emit the same fee-related events (`WithdrawalFeeSet` and `WithdrawalFeeApplied`).

4. **Reduced Code Duplication:** Fee logic is centralized in `SupportsWithdrawalFee.sol`, making maintenance easier.

5. **Updated Documentation:** Both design documents now reflect the shared fee mechanism and its benefits.

6. **Improved Naming:** Renamed to `SupportsWithdrawalFee` for better clarity and consistency.

7. **Fixed Test Issues:** Added missing `maxWithdrawalFeeBps()` function and corrected error/event names to match implementation.

The withdrawal fee logic is now uniform across both vault types, providing users with accurate preview functions and consistent fee handling. 