// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { RewardCompounderDLendBase } from "../../base/RewardCompounderDLendBase.sol";

contract RewardCompounderDLendOdos is RewardCompounderDLendBase {
    constructor(address d, address c, address f, address core, address agg)
        RewardCompounderDLendBase(d, c, f, core, agg)
    {}
}

