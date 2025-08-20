// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC3156FlashLender {
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);

    function maxFlashLoan(address token) external view returns (uint256);
    function flashFee(address token, uint256 amount) external view returns (uint256);
}

