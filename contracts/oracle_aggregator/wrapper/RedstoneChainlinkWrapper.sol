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

import "../interface/chainlink/BaseChainlinkWrapper.sol";
import "../interface/chainlink/IPriceFeed.sol";

/**
 * @title RedstoneChainlinkWrapper
 * @dev Implementation of BaseChainlinkWrapper for Redstone oracle feeds that follow Chainlink AggregatorV3Interface
 */
contract RedstoneChainlinkWrapper is BaseChainlinkWrapper {
    mapping(address => IPriceFeed) public assetToFeed;

    constructor(
        address baseCurrency,
        uint256 _baseCurrencyUnit
    ) BaseChainlinkWrapper(baseCurrency, _baseCurrencyUnit) {}

    function getPriceInfo(address asset) public view virtual override returns (uint256 price, bool isAlive) {
        IPriceFeed feed = assetToFeed[asset];
        if (address(feed) == address(0)) {
            revert FeedNotSet(asset);
        }

        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();

        // Validate the oracle data
        if (answer <= 0) {
            revert InvalidPrice();
        }

        price = uint256(answer);
        isAlive = updatedAt + CHAINLINK_HEARTBEAT + heartbeatStaleTimeLimit > block.timestamp;

        price = _convertToBaseCurrencyUnit(price);
    }

    /**
     * @notice Sets the price feed for an asset
     * @param asset The address of the asset
     * @param feed The address of the Redstone Chainlink-compatible price feed
     */
    function setFeed(address asset, address feed) external onlyRole(ORACLE_MANAGER_ROLE) {
        assetToFeed[asset] = IPriceFeed(feed);
    }
}
