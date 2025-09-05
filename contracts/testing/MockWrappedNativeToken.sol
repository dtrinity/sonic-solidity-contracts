// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockWrappedNativeToken
 * @notice Mock wrapped native token contract for testing NativeMintingGateway
 * @dev Implements both ERC20 and wrapped native token functionality with deposit/withdraw
 */
contract MockWrappedNativeToken is ERC20 {
    
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /**
     * @notice Deposits native tokens and mints equivalent wrapped tokens
     * @dev Mints wrapped tokens 1:1 with sent native tokens
     */
    function deposit() external payable {
        require(msg.value > 0, "Must send some native tokens");
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @notice Withdraws wrapped tokens and returns equivalent native tokens
     * @param amount The amount of wrapped tokens to unwrap
     */
    function withdraw(uint256 amount) external {
        require(amount > 0, "Must withdraw some tokens");
        require(balanceOf(msg.sender) >= amount, "Insufficient wrapped token balance");
        
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
        emit Withdrawal(msg.sender, amount);
    }

    /**
     * @notice Allow contract to receive native tokens for withdrawals
     */
    receive() external payable {
        // Allow contract to receive native tokens for withdraw functionality
    }

    /**
     * @notice Mint tokens for testing purposes
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
