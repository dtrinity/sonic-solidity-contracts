// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../oracle_aggregator/interface/chainlink/IPriceFeed.sol";

contract MockChainlinkFeed is IPriceFeed, Ownable {
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setMock(int256 answer, uint256 updatedAt) external onlyOwner {
        _answer = answer;
        _updatedAt = updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (0, _answer, 0, _updatedAt, 0);
    }
}
