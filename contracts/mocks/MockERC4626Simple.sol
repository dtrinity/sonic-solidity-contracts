// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockERC4626Simple
 * @dev Very small ERC-4626 vault used only in tests. Behaves 1:1 on deposits,
 *      but on redeem / withdraw returns 10 % more dStable than theoretical
 *      book value to simulate positive slippage / yield.
 */
contract MockERC4626Simple is ERC4626 {
    uint256 private constant BONUS_BPS = 11_000; // 110 % (10000 = 100 %)
    uint256 private constant BASIS_POINTS = 10_000;

    constructor(IERC20 _asset) ERC20("Mock Vault Token", "mVT") ERC4626(_asset) {}

    // ---------- Deposit path (1:1) ---------- //
    // The default ERC4626 implementation already mints shares == assets when
    // totalSupply() == 0, so no override is necessary.

    // ---------- Redemption path (adds 10 % bonus) ---------- //

    function previewRedeem(uint256 shares) public pure override returns (uint256) {
        // users get 110 % of the nominal assets represented by `shares`
        return (shares * BONUS_BPS) / BASIS_POINTS;
    }

    function previewWithdraw(uint256 assets) public pure override returns (uint256) {
        // inverse of previewRedeem (ceil division to avoid under-funding)
        return (assets * BASIS_POINTS + BONUS_BPS - 1) / BONUS_BPS;
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        // Transfer shares from owner (handles allowance)
        if (owner != _msgSender()) {
            _spendAllowance(owner, _msgSender(), shares);
        }

        // Calculate assets including bonus and burn shares
        assets = previewRedeem(shares);
        _burn(owner, shares);

        // Pull the underlying tokens from vault and send to receiver
        IERC20(asset()).transfer(receiver, assets);

        emit Withdraw(_msgSender(), receiver, owner, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        shares = previewWithdraw(assets);
        redeem(shares, receiver, owner); // redeem already handles transfer & events
    }
}
