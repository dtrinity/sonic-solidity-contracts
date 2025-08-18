// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ICurveStableSwapNG} from "../vaults/dpool/core/interfaces/ICurveStableSwapNG.sol";

/**
 * @title MockCurveStableSwapNG
 * @notice Mock implementation of Curve StableSwap NG for testing dPOOL
 * @dev Simplified 2-token stable pool with 1:1 exchange rate and minimal fees
 */
contract MockCurveStableSwapNG is ICurveStableSwapNG, ERC20 {
    using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant A_PRECISION = 100;
    uint256 public constant FEE_DENOMINATOR = 10 ** 10;
    uint256 public constant PRECISION = 10 ** 18;

    // --- State ---
    address[2] public coins;
    uint256[2] public balances;
    uint256 public immutable fee; // Pool fee in basis points of FEE_DENOMINATOR
    uint256 public immutable admin_fee; // Admin fee share of total fees

    // --- Constructor ---
    constructor(
        string memory _name,
        string memory _symbol,
        address[2] memory _coins,
        uint256 _fee
    ) ERC20(_name, _symbol) {
        coins = _coins;
        fee = _fee; // e.g., 4000000 for 0.04%
        admin_fee = 5000000000; // 50% of fees to admin
    }

    // --- ICurveStableSwapNG Implementation ---

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external override returns (uint256) {
        return _exchange(i, j, dx, min_dy, msg.sender);
    }

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) external override returns (uint256) {
        return _exchange(i, j, dx, min_dy, receiver);
    }

    function exchange_received(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external override returns (uint256) {
        return _exchange(i, j, dx, min_dy, msg.sender);
    }

    function exchange_received(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) external override returns (uint256) {
        return _exchange(i, j, dx, min_dy, receiver);
    }

    function add_liquidity(
        uint256[] calldata amounts,
        uint256 min_mint_amount
    ) external override returns (uint256) {
        return _add_liquidity(amounts, min_mint_amount, msg.sender);
    }

    function add_liquidity(
        uint256[] calldata amounts,
        uint256 min_mint_amount,
        address receiver
    ) external override returns (uint256) {
        return _add_liquidity(amounts, min_mint_amount, receiver);
    }

    function remove_liquidity_one_coin(
        uint256 burn_amount,
        int128 i,
        uint256 min_received
    ) external override returns (uint256) {
        return
            _remove_liquidity_one_coin(
                burn_amount,
                i,
                min_received,
                msg.sender
            );
    }

    function remove_liquidity_one_coin(
        uint256 burn_amount,
        int128 i,
        uint256 min_received,
        address receiver
    ) external override returns (uint256) {
        return
            _remove_liquidity_one_coin(burn_amount, i, min_received, receiver);
    }

    function remove_liquidity_imbalance(
        uint256[] calldata amounts,
        uint256 max_burn_amount
    ) external override returns (uint256) {
        revert("Not implemented");
    }

    function remove_liquidity_imbalance(
        uint256[] calldata amounts,
        uint256 max_burn_amount,
        address receiver
    ) external override returns (uint256) {
        revert("Not implemented");
    }

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts
    ) external override returns (uint256[] memory) {
        return _remove_liquidity(burn_amount, min_amounts, msg.sender, false);
    }

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts,
        address receiver
    ) external override returns (uint256[] memory) {
        return _remove_liquidity(burn_amount, min_amounts, receiver, false);
    }

    function remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts,
        address receiver,
        bool claim_admin_fees
    ) external override returns (uint256[] memory) {
        return
            _remove_liquidity(
                burn_amount,
                min_amounts,
                receiver,
                claim_admin_fees
            );
    }

    // --- View Functions ---

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view override returns (uint256) {
        return _get_dy(i, j, dx);
    }

    function get_dx(
        int128 i,
        int128 j,
        uint256 dy
    ) external view override returns (uint256) {
        // Simplified: assume 1:1 exchange rate
        return dy;
    }

    function calc_withdraw_one_coin(
        uint256 burn_amount,
        int128 i
    ) external view override returns (uint256) {
        if (totalSupply() == 0) return 0;

        // Simplified: proportional withdrawal
        return (burn_amount * balances[uint256(uint128(i))]) / totalSupply();
    }

    function calc_token_amount(
        uint256[] calldata amounts,
        bool is_deposit
    ) external view override returns (uint256) {
        if (is_deposit) {
            // Simplified: sum of amounts as LP tokens (assuming balanced deposit)
            return amounts[0] + amounts[1];
        } else {
            // For withdrawal, return proportional amount
            return amounts[0] + amounts[1];
        }
    }

    function get_virtual_price() external view override returns (uint256) {
        if (totalSupply() == 0) return PRECISION;
        return ((balances[0] + balances[1]) * PRECISION) / totalSupply();
    }

    function get_balances() external view override returns (uint256[] memory) {
        uint256[] memory result = new uint256[](2);
        result[0] = balances[0];
        result[1] = balances[1];
        return result;
    }

    function stored_rates() external view override returns (uint256[] memory) {
        uint256[] memory rates = new uint256[](2);
        rates[0] = PRECISION;
        rates[1] = PRECISION;
        return rates;
    }

    function dynamic_fee(
        int128 i,
        int128 j
    ) external view override returns (uint256) {
        return fee;
    }

    function A() external view override returns (uint256) {
        return 2000 * A_PRECISION; // Stable A parameter
    }

    function A_precise() external view override returns (uint256) {
        return 2000 * A_PRECISION;
    }

    function offpeg_fee_multiplier() external view override returns (uint256) {
        return 20000000000; // 2x multiplier
    }

    // Override conflicting methods from both ICurveStableSwapNG and ERC20
    function balanceOf(
        address account
    ) public view override(ICurveStableSwapNG, ERC20) returns (uint256) {
        return ERC20.balanceOf(account);
    }

    function allowance(
        address owner,
        address spender
    ) public view override(ICurveStableSwapNG, ERC20) returns (uint256) {
        return ERC20.allowance(owner, spender);
    }

    // --- Internal Functions ---

    function _exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy,
        address receiver
    ) internal returns (uint256) {
        require(
            i != j && i >= 0 && j >= 0 && i < 2 && j < 2,
            "Invalid coin indices"
        );

        // Pull input token
        IERC20(coins[uint256(uint128(i))]).safeTransferFrom(
            msg.sender,
            address(this),
            dx
        );

        // Calculate output with minimal fee
        uint256 dy = _get_dy(i, j, dx);
        require(dy >= min_dy, "Slippage exceeded");

        // Update balances
        balances[uint256(uint128(i))] += dx;
        balances[uint256(uint128(j))] -= dy;

        // Send output token
        IERC20(coins[uint256(uint128(j))]).safeTransfer(receiver, dy);

        return dy;
    }

    function _add_liquidity(
        uint256[] calldata amounts,
        uint256 min_mint_amount,
        address receiver
    ) internal returns (uint256) {
        require(amounts.length == 2, "Invalid amounts length");

        uint256 mint_amount = 0;

        for (uint256 i = 0; i < 2; i++) {
            if (amounts[i] > 0) {
                IERC20(coins[i]).safeTransferFrom(
                    msg.sender,
                    address(this),
                    amounts[i]
                );
                balances[i] += amounts[i];
                mint_amount += amounts[i]; // Simplified: 1:1 LP token minting
            }
        }

        require(mint_amount >= min_mint_amount, "Slippage exceeded");

        _mint(receiver, mint_amount);
        return mint_amount;
    }

    function _remove_liquidity_one_coin(
        uint256 burn_amount,
        int128 i,
        uint256 min_received,
        address receiver
    ) internal returns (uint256) {
        require(i >= 0 && i < 2, "Invalid coin index");
        require(balanceOf(msg.sender) >= burn_amount, "Insufficient LP tokens");

        uint256 coin_amount = (burn_amount * balances[uint256(uint128(i))]) /
            totalSupply();
        require(coin_amount >= min_received, "Slippage exceeded");

        balances[uint256(uint128(i))] -= coin_amount;
        _burn(msg.sender, burn_amount);

        IERC20(coins[uint256(uint128(i))]).safeTransfer(receiver, coin_amount);
        return coin_amount;
    }

    function _remove_liquidity(
        uint256 burn_amount,
        uint256[] calldata min_amounts,
        address receiver,
        bool claim_admin_fees
    ) internal returns (uint256[] memory) {
        require(min_amounts.length == 2, "Invalid min_amounts length");
        require(balanceOf(msg.sender) >= burn_amount, "Insufficient LP tokens");

        uint256[] memory amounts = new uint256[](2);

        for (uint256 i = 0; i < 2; i++) {
            amounts[i] = (burn_amount * balances[i]) / totalSupply();
            require(amounts[i] >= min_amounts[i], "Slippage exceeded");

            balances[i] -= amounts[i];
            IERC20(coins[i]).safeTransfer(receiver, amounts[i]);
        }

        _burn(msg.sender, burn_amount);
        return amounts;
    }

    function _get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) internal view returns (uint256) {
        // Simplified stable swap: 1:1 exchange rate with small fee
        uint256 fee_amount = (dx * fee) / FEE_DENOMINATOR;
        return dx - fee_amount;
    }
}
