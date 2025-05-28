// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool, DataTypes} from "contracts/dlend/core/interfaces/IPool.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {StaticATokenLM} from "./StaticATokenLM.sol";
import {IStaticATokenFactory} from "./interfaces/IStaticATokenFactory.sol";
import {IRewardsController} from "contracts/dlend/periphery/rewards/interfaces/IRewardsController.sol";

/**
 * @title StaticATokenFactory
 * @notice Factory contract that keeps track of all deployed static aToken wrappers for a specified pool.
 * This registry also acts as a factory, allowing to deploy new static aTokens on demand.
 * There can only be one static aToken per underlying on the registry at a time.
 * @author BGD labs (modified by dTrinity)
 */
contract StaticATokenFactory is IStaticATokenFactory {
    IPool public immutable POOL;

    mapping(address => address) internal _underlyingToStaticAToken;
    address[] internal _staticATokens;

    event StaticTokenCreated(
        address indexed staticAToken,
        address indexed underlying
    );

    constructor(IPool pool) {
        POOL = pool;
    }

    function initialize() external pure {
        revert("NO_INITIALIZER");
    }

    ///@inheritdoc IStaticATokenFactory
    function createStaticATokens(
        address[] memory underlyings
    ) external returns (address[] memory) {
        address[] memory staticATokens = new address[](underlyings.length);
        for (uint256 i = 0; i < underlyings.length; i++) {
            address cachedStaticAToken = _underlyingToStaticAToken[
                underlyings[i]
            ];
            if (cachedStaticAToken == address(0)) {
                DataTypes.ReserveData memory reserveData = POOL.getReserveData(
                    underlyings[i]
                );
                require(
                    reserveData.aTokenAddress != address(0),
                    "UNDERLYING_NOT_LISTED"
                );
                StaticATokenLM staticAToken = new StaticATokenLM(
                    POOL,
                    IRewardsController(address(0)), // TODO: pass correct incentives controller if needed
                    reserveData.aTokenAddress,
                    string(
                        abi.encodePacked(
                            "Wrapped ",
                            IERC20Metadata(reserveData.aTokenAddress).name()
                        )
                    ),
                    string(
                        abi.encodePacked(
                            "w",
                            IERC20Metadata(reserveData.aTokenAddress).symbol()
                        )
                    )
                );
                address staticATokenAddr = address(staticAToken);
                _underlyingToStaticAToken[underlyings[i]] = staticATokenAddr;
                staticATokens[i] = staticATokenAddr;
                _staticATokens.push(staticATokenAddr);
                emit StaticTokenCreated(staticATokenAddr, underlyings[i]);
            } else {
                staticATokens[i] = cachedStaticAToken;
            }
        }
        return staticATokens;
    }

    ///@inheritdoc IStaticATokenFactory
    function getStaticATokens() external view returns (address[] memory) {
        return _staticATokens;
    }

    ///@inheritdoc IStaticATokenFactory
    function getStaticAToken(
        address underlying
    ) external view returns (address) {
        return _underlyingToStaticAToken[underlying];
    }
}
