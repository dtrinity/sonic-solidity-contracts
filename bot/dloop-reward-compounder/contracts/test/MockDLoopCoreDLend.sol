// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interface/IERC20.sol";

// Minimal mock of DLoopCoreDLend
contract MockDLoopCoreDLend {
    string public name = "MockCoreShares";
    string public symbol = "mSHARE";
    uint8 public constant decimals = 18;

    IERC20 public immutable collateral;
    IERC20 public immutable dusd;

    uint256 public exchangeThresholdValue;
    uint256 public kBps; // K dUSD per asset = assets * kBps / 10000
    uint256 public treasuryFeeBps; // applied on rewards minted in compoundRewards
    bool public depositEnabled = true;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(IERC20 _collateral, IERC20 _dusd, uint256 _kBps, uint256 _exchangeThreshold, uint256 _treasuryFeeBps) {
        collateral = _collateral;
        dusd = _dusd;
        kBps = _kBps;
        exchangeThresholdValue = _exchangeThreshold;
        treasuryFeeBps = _treasuryFeeBps;
    }

    function setDepositEnabled(bool v) external { depositEnabled = v; }
    function setExchangeThreshold(uint256 v) external { exchangeThresholdValue = v; }
    function setKBps(uint256 v) external { kBps = v; }
    function setTreasuryFeeBps(uint256 v) external { treasuryFeeBps = v; }

    function exchangeThreshold() external view returns (uint256) { return exchangeThresholdValue; }
    function maxDeposit(address) external view returns (uint256) { return depositEnabled ? type(uint256).max : 0; }

    // ERC20 shares functions
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function previewDeposit(uint256 assets) external pure returns (uint256 shares) { return assets; }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        // pull collateral
        require(collateral.transferFrom(msg.sender, address(this), assets), "pull collateral");
        // mint shares 1:1
        shares = assets;
        balanceOf[receiver] += shares;
        totalSupply += shares;
        // send K dUSD to receiver
        uint256 K = (assets * kBps) / 10000;
        require(dusd.transfer(receiver, K), "send K");
    }

    function compoundRewards(uint256 amount, address[] calldata rewardTokens, address receiver) external {
        require(rewardTokens.length == 1 && rewardTokens[0] == address(dusd), "only dUSD");
        // pull shares from caller
        uint256 allowed = allowance[msg.sender][address(this)];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[msg.sender][address(this)] = allowed - amount;
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        // mock reward proportional to shares: Z = amount * 0.4 (for testing) => 4000 bps
        uint256 gross = (amount * 4000) / 10000;
        uint256 fee = (gross * treasuryFeeBps) / 10000;
        uint256 net = gross - fee;
        require(dusd.transfer(receiver, net), "send reward");
    }
}

