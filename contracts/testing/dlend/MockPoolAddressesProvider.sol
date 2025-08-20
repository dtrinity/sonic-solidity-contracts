// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "contracts/vaults/dloop/core/venue/dlend/interface/IPoolAddressesProvider.sol";

contract MockPoolAddressesProvider is IPoolAddressesProvider {
    string private _marketId;
    address private _pool;
    address private _oracle;

    constructor(address pool_, address oracle_) {
        _marketId = "TEST";
        _pool = pool_;
        _oracle = oracle_;
    }

    function getMarketId() external view override returns (string memory) {
        return _marketId;
    }

    function setMarketId(string calldata newMarketId) external override {
        _marketId = newMarketId;
        emit MarketIdSet("", newMarketId);
    }

    function getAddressFromID(
        bytes32
    ) external pure override returns (address) {
        return address(0);
    }

    function setAddressAsProxy(bytes32, address) external override {}
    function setAddress(bytes32, address) external override {}

    function getPool() external view override returns (address) {
        return _pool;
    }

    function setPoolImpl(address newPoolImpl) external override {
        address old = _pool;
        _pool = newPoolImpl;
        emit PoolUpdated(old, newPoolImpl);
    }

    function getPoolConfigurator() external pure override returns (address) {
        return address(0);
    }
    function setPoolConfiguratorImpl(address) external override {}

    function getPriceOracle() external view override returns (address) {
        return _oracle;
    }

    function setPriceOracle(address newPriceOracle) external override {
        address old = _oracle;
        _oracle = newPriceOracle;
        emit PriceOracleUpdated(old, newPriceOracle);
    }

    function getACLManager() external pure override returns (address) {
        return address(0);
    }
    function setACLManager(address) external override {}

    function getACLAdmin() external pure override returns (address) {
        return address(0);
    }
    function setACLAdmin(address) external override {}

    function getPriceOracleSentinel() external pure override returns (address) {
        return address(0);
    }
    function setPriceOracleSentinel(address) external override {}

    function getPoolDataProvider() external pure override returns (address) {
        return address(0);
    }
    function setPoolDataProvider(address) external override {}
}
