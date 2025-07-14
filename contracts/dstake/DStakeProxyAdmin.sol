// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

// Dedicated ProxyAdmin for the dSTAKE subsystem.
// Deploying a separate ProxyAdmin keeps dSTAKE upgrades isolated from the
// global DefaultProxyAdmin used elsewhere in the protocol.
contract DStakeProxyAdmin is ProxyAdmin {
    constructor(address initialOwner) ProxyAdmin(initialOwner) {}
}
