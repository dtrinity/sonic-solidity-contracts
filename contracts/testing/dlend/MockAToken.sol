// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "contracts/dlend/core/dependencies/openzeppelin/contracts/ERC20.sol";
import { IERC20WithPermit } from "contracts/dlend/core/interfaces/IERC20WithPermit.sol";

contract MockAToken is ERC20, IERC20WithPermit {
    address public immutable POOL;
    mapping(address => uint256) public nonces;

    error CallerNotPool(address caller, address expected);

    modifier onlyPool() {
        if (msg.sender != POOL) {
            revert CallerNotPool(msg.sender, POOL);
        }
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address pool_
    ) ERC20(name_, symbol_) {
        POOL = pool_;
        _setupDecimals(decimals_);
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        owner;
        deadline;
        v;
        r;
        s;
        _approve(owner, spender, value);
        nonces[owner] += 1;
    }
}
