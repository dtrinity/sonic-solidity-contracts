// SPDX-License-Identifier: MIT
/* ———————————————————————————————————————————————————————————————————————————————— *
 *    _____     ______   ______     __     __   __     __     ______   __  __       *
 *   /\  __-.  /\__  _\ /\  == \   /\ \   /\ "-.\ \   /\ \   /\__  _\ /\ \_\ \      *
 *   \ \ \/\ \ \/_/\ \/ \ \  __<   \ \ \  \ \ \-.  \  \ \ \  \/_/\ \/ \ \____ \     *
 *    \ \____-    \ \_\  \ \_\ \_\  \ \_\  \ \_\\"\_\  \ \_\    \ \_\  \/\_____\    *
 *     \/____/     \/_/   \/_/ /_/   \/_/   \/_/ \/_/   \/_/     \/_/   \/_____/    *
 *                                                                                  *
 * ————————————————————————————————— dtrinity.org ————————————————————————————————— *
 *                                                                                  *
 *                                         ▲                                        *
 *                                        ▲ ▲                                       *
 *                                                                                  *
 * ———————————————————————————————————————————————————————————————————————————————— *
 * dTRINITY Protocol: https://github.com/dtrinity                                   *
 * ———————————————————————————————————————————————————————————————————————————————— */

pragma solidity ^0.8.20;

import { IProxy } from "../../oracle_aggregator/interface/api3/IProxy.sol";

contract MockAPI3Oracle is IProxy {
    int224 private mockPrice;
    uint32 private mockTimestamp;
    address private immutable api3ServerV1Address;

    constructor(address _api3ServerV1Address) {
        api3ServerV1Address = _api3ServerV1Address;
    }

    function setMock(int224 _price, uint32 _timestamp) external {
        mockPrice = _price;
        mockTimestamp = _timestamp;
    }

    function read() external view override returns (int224 value, uint32 timestamp) {
        return (mockPrice, mockTimestamp);
    }

    function api3ServerV1() external view override returns (address) {
        return api3ServerV1Address;
    }
}
