# ERC20VestingNFT Design Documentation

## Overview

The `ERC20VestingNFT` contract implements a "soft locker" system for dSTAKE tokens with a 6-month vesting period. Users deposit dSTAKE tokens and receive NFTs that represent their locked positions. The contract supports two exit mechanisms: early redemption (burns NFT) and matured withdrawal (makes NFT soul-bound).

## Key Design Decisions

### 1. NFT State Management
- **Pre-vest**: NFT is transferable and can be burned for early exit
- **Post-vest**: NFT becomes soul-bound (non-transferable) after matured withdrawal
- **Burned**: NFT is destroyed when user exits before vesting period

### 2. Dual Exit Mechanisms
- **Early Redemption (`redeemEarly`)**: Available before vesting period ends, burns the NFT
- **Matured Withdrawal (`withdrawMatured`)**: Available after vesting period, makes NFT soul-bound

### 3. Maximum Supply Control
- Owner can set/update maximum total dSTAKE supply that can be deposited
- Prevents unlimited deposits while allowing program scaling
- Separate from individual deposit limits

### 4. Deposit Control
- Owner can disable new deposits without affecting existing positions
- Allows graceful program wind-down while preserving user rights

### 5. Minimum Deposit Threshold
- Owner can set a minimum amount for deposits to prevent micropayments and gas waste
- Threshold is specified in the constructor and stored in `minDepositAmount`
- Owner can update the threshold via `setMinDepositAmount`
- The `deposit` function reverts with `DepositBelowMinimum` if `amount < minDepositAmount`

### 6. NFT Metadata Strategy
- Each NFT stores: deposit amount, deposit timestamp, and matured status
- Token URI generation can be implemented to show vesting progress
- Matured status prevents transfers after withdrawal

## Non-Obvious Implementation Details

### 1. Reentrancy Protection
- All external functions that transfer tokens use `nonReentrant` modifier
- Critical for preventing reentrancy attacks during deposit/withdrawal flows

### 2. Soul-bound Implementation
- Uses `matured` mapping instead of burning to preserve NFT history
- Allows tracking of completed vesting positions
- `_beforeTokenTransfer` hook prevents transfers of matured NFTs

### 3. Vesting Period Immutability
- Set at deployment time for predictability and trust
- Cannot be changed by owner to prevent rug-pull scenarios
- Users can rely on fixed 6-month timeline

### 4. Token ID Management
- Uses OpenZeppelin's `_tokenIdCounter` for sequential, unique IDs
- Starts from 1 (not 0) for better UX and gas optimization

### 5. Emergency Considerations
- No emergency withdrawal function by design
- Owner cannot access user funds or force early exits
- Only controls: deposit enabling/disabling and max supply

### 6. Gas Optimization
- Struct packing in `VestingPosition` for efficient storage
- Early returns in view functions to save gas
- Minimal state changes in critical paths

## Security Considerations

### 1. Access Control
- Only owner can disable deposits and set max supply
- No admin functions that affect existing user positions
- Users maintain full control over their vesting positions

### 2. Integer Overflow Protection
- Solidity 0.8.20+ has built-in overflow protection
- Additional checks for max supply validation

### 3. Input Validation
- Zero amount deposits rejected
- Zero address checks for token transfers
- Proper NFT existence validation

## Future Extension Points

### 1. Metadata Enhancement
- `tokenURI` can be implemented to show vesting progress
- Could include visual indicators of time remaining

### 2. Batch Operations
- Multiple deposits/withdrawals in single transaction
- Gas optimization for power users

### 3. Delegation Features
- Could add voting delegation while tokens are locked
- Maintains governance participation during vesting

## Program Lifecycle

1. **Deployment**: Set vesting period (6 months), max supply
2. **Active Phase**: Users deposit dSTAKE, receive NFTs
3. **Wind-down**: Owner disables deposits (optional)
4. **Vesting**: Users wait for 6-month period
5. **Maturation**: Users can withdraw with soul-bound NFTs or redeem early

This design balances user flexibility with program integrity, ensuring a fair and predictable vesting experience.
