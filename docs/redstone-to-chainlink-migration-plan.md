# Redstone To Chainlink Migration Plan

## Scope

This branch is migrating Sonic USD pricing away from Redstone feeds where live Chainlink-compatible replacements exist.

Current in-scope assets:

- `USDCe` -> direct `USDC/USD`
- `scUSD` -> direct `USDC/USD`
- `PTaUSDC` -> `PTaUSDC/USDC * USDC/USD`
- `PTwstkscUSD` -> `PTwstkscUSD/scUSD * USDC/USD`
- `frxUSD` -> direct `frxUSD/USD`
- `sfrxUSD` -> `sfrxUSD/frxUSD * frxUSD/USD`

`wS`, `dS`, and `stS` remain covered by the S-side migration flow already present in this branch.

## Feed Inventory

USD-side replacement feeds now available on Sonic:

- `USDC/USD`: `0x55bCa887199d5520B3Ce285D41e6dC10C08716C9`
- `frxUSD/USD` API3: `0xCa1371745467bAe4F9768aF689D50F55D1E75f8e`
- `sfrxUSD/frxUSD`: `0xD2FB92548227143FDE27B37Aa71CfE4e35Bd478D`

Feeds retained from existing Chainlink or protocol infrastructure:

- `PTaUSDC/USDC`: `0xc65F6b9dBAFa2A9243CeceDbf80EE9a79d6ADf09`
- `PTwstkscUSD/scUSD`: `0x2EfEb81d6A0E5638bfe917C6cFCeb42989058d08`

## Oracle Routing

The replacement `frxUSD` and `sfrxUSD` feeds report 18 decimals, so they must not be routed through the legacy Redstone/Chainlink wrappers that assume 8-decimal sources.

- `frxUSD` routes through the decimal-aware `USD_ChainlinkWrapperWithThresholding` simple-feed path.
- `scUSD` routes through the decimal-aware `USD_ChainlinkWrapperWithThresholding` simple-feed path with the USD leg thresholded to 1.
- `sfrxUSD` routes through the decimal-aware `USD_ChainlinkWrapperWithThresholding` composite path.

That means the migration deploys/configures the deploy/20 wrapper and queues `OracleAggregator.setOracle(...)` flips for the affected assets.

Threshold policy should stay aligned with the existing Sonic config:

- `frxUSD/USD`: threshold at `1.0`, fixed price `1.0`
- `sfrxUSD/frxUSD`: no threshold on leg 1
- `frxUSD/USD` inside `sfrxUSD`: threshold at `1.0`, fixed price `1.0`

## Script Naming

Per the migration approach for this branch, new deploy scripts should be additive and should not rewrite older deployment history.

Use `deploy/20_chainlink_oracle_migration/` for the active rollout. The undeployed deploy/19 follow-up scripts were removed so a normal deploy run cannot accidentally execute legacy 8-decimal wrapper updates for 18-decimal feeds.

## Testing Strategy

The branch now needs two USD-side fork sanity modes:

- Historical snapshot checks at block `50,542,516` for the assets already covered earlier in the migration work:
  - `USDCe`
  - `scUSD`
  - `PTaUSDC`
  - `PTwstkscUSD`
- Latest-state checks for `frxUSD` and `sfrxUSD`

The split is intentional: the new Frax API3 feed does not exist at block `50,542,516`, so extending the historical test block would weaken the earlier migration snapshot for the already-covered assets.

The USD fork test should keep logging:

- current aggregator oracle
- current wrapper feed configuration
- live candidate feed answers
- normalized candidate prices
- basis-point delta versus the current oracle

The acceptance condition stays the same: candidate Chainlink-compatible paths should remain within `100 bps` of the current on-chain oracle.
