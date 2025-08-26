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

import "../../oracle_aggregator/interface/chainlink/IAggregatorV3Interface.sol";

contract MockChainlinkAggregatorV3 is AggregatorV3Interface {
    int256 private mockPrice;
    uint80 private mockRoundId;
    uint8 private mockDecimals;
    string private mockDescription;
    uint256 private mockUpdatedAt;

    constructor(uint8 _decimals, string memory _description) {
        mockRoundId = 1;
        mockDecimals = _decimals;
        mockDescription = _description;
        mockUpdatedAt = block.timestamp;
    }

    function decimals() external view override returns (uint8) {
        return mockDecimals;
    }

    function description() external view override returns (string memory) {
        return mockDescription;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function setMock(int256 _price) external {
        mockPrice = _price;
        mockRoundId++;
        mockUpdatedAt = block.timestamp;
    }

    function setMockWithTimestamp(int256 _price, uint256 _timestamp) external {
        mockPrice = _price;
        mockRoundId++;
        mockUpdatedAt = _timestamp;
    }

    function getRoundData(
        uint80 _roundId
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, mockPrice, mockUpdatedAt, mockUpdatedAt, _roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (mockRoundId, mockPrice, mockUpdatedAt, mockUpdatedAt, mockRoundId);
    }
}
