// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICurveStableSwapNG {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) external returns (uint256);

    function exchange_received(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    function exchange_received(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) external returns (uint256);

    function add_liquidity(
        uint256[] calldata amounts,
        uint256 min_mint_amount
    ) external returns (uint256);

    function add_liquidity(
        uint256[] calldata amounts,
        uint256 min_mint_amount,
        address receiver
    ) external returns (uint256);

    function remove_liquidity_one_coin(
        uint256 burn_amount,
        int128 i,
        uint256 min_received
    ) external returns (uint256);

    function remove_liquidity_one_coin(
        uint256 burn_amount,
        int128 i,
        uint256 min_received,
        address receiver
    ) external returns (uint256);

    function remove_liquidity_imbalance(
        uint256[] calldata amounts,
        uint256 max_burn_amount
    ) external returns (uint256);

    function remove_liquidity_imbalance(
        uint256[] calldata amounts,
        uint256 max_burn_amount,
        address receiver
    ) external returns (uint256);

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts
    ) external returns (uint256[] memory);

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts,
        address receiver
    ) external returns (uint256[] memory);

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts,
        address receiver,
        bool claim_admin_fees
    ) external returns (uint256[] memory);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);

    function get_dx(
        int128 i,
        int128 j,
        uint256 dy
    ) external view returns (uint256);

    function calc_withdraw_one_coin(
        uint256 burn_amount,
        int128 i
    ) external view returns (uint256);

    function calc_token_amount(
        uint256[] calldata amounts,
        bool is_deposit
    ) external view returns (uint256);

    function get_virtual_price() external view returns (uint256);

    function get_balances() external view returns (uint256[] memory);

    function stored_rates() external view returns (uint256[] memory);

    function dynamic_fee(int128 i, int128 j) external view returns (uint256);

    function balances(uint256 i) external view returns (uint256);

    function coins(uint256 i) external view returns (address);

    function fee() external view returns (uint256);

    function admin_fee() external view returns (uint256);

    function offpeg_fee_multiplier() external view returns (uint256);

    function A() external view returns (uint256);

    function A_precise() external view returns (uint256);

    function balanceOf(address arg0) external view returns (uint256);

    function allowance(
        address arg0,
        address arg1
    ) external view returns (uint256);
}
