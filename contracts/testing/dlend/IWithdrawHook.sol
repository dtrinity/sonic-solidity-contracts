// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWithdrawHook {
    function onWithdraw(
        address asset,
        address caller,
        address originalRecipient,
        uint256 amount
    ) external;
}
