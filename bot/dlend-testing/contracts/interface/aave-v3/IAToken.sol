// SPDX-License-Identifier: GNU AGPLv3
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title IAToken
 * @dev Interface for the AToken contract
 */
interface IAToken {
  /**
   * @dev Returns the address of the underlying asset of this aToken
   **/
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);

  /**
   * @dev Burns aTokens from `user` and sends the equivalent amount of underlying to `receiverOfUnderlying`
   * @param user The owner of the aTokens, getting them burned
   * @param receiverOfUnderlying The address that will receive the underlying
   * @param amount The amount being burned
   * @param index The new liquidity index of the reserve
   **/
  function burn(
    address user,
    address receiverOfUnderlying,
    uint256 amount,
    uint256 index
  ) external;
} 