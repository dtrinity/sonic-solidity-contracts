// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RewardCompounderDLendBase} from "../base/RewardCompounderDLendBase.sol";
import {IOdosRouterV2} from "../odos/interface/IOdosRouterV2.sol";
import {IERC20} from "../interface/IERC20.sol";
import {IDLoopCoreDLend} from "../interface/IDLoopCoreDLend.sol";
import {IERC3156FlashLender} from "../interface/IERC3156FlashLender.sol";

contract RewardCompounderDLendOdos is RewardCompounderDLendBase {
    IOdosRouterV2 public immutable odosRouter;

    constructor(
        IERC20 _dusd,
        IERC20 _collateral,
        address _core,
        address _lender,
        address _odosRouter
    ) RewardCompounderDLendBase(_dusd, _collateral, IDLoopCoreDLend(_core), IERC3156FlashLender(_lender)) {
        odosRouter = IOdosRouterV2(_odosRouter);
    }

    function _swapExactIn(uint256 dusdIn, uint256 minOut, bytes memory swapData) internal override returns (uint256) {
        IERC20 d = dusd;
        IERC20 c = collateral;
        // approve router
        if (d.allowance(address(this), address(odosRouter)) < dusdIn) {
            d.approve(address(odosRouter), type(uint256).max);
        }
        uint256 balBefore = c.balanceOf(address(this));
        (bool ok, bytes memory ret) = address(odosRouter).call(swapData);
        if (!ok) {
            assembly {
                let len := mload(ret)
                revert(add(ret, 32), len)
            }
        }
        // compute out
        uint256 balAfter = c.balanceOf(address(this));
        uint256 received = balAfter - balBefore;
        if (received < minOut) revert Slippage();
        return received;
    }
}
