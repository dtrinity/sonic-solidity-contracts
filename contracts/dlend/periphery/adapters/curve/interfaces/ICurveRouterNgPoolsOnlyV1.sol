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

/**
 * @dev Interface for Curve.Fi RouterNG contract (pools-only version 1).
 * @dev Generated from original ABI: https://fraxscan.com/address/0x9f2Fa7709B30c75047980a0d70A106728f0Ef2db#code
 */

interface ICurveRouterNgPoolsOnlyV1 {
    event Exchange(
        address indexed sender,
        address indexed receiver,
        address[11] route,
        uint256[4][5] swap_params,
        uint256 in_amount,
        uint256 out_amount
    );

    function exchange(
        address[11] calldata _route,
        uint256[4][5] calldata _swap_params,
        uint256 _amount,
        uint256 _min_dy
    ) external payable returns (uint256);

    function exchange(
        address[11] calldata _route,
        uint256[4][5] calldata _swap_params,
        uint256 _amount,
        uint256 _min_dy,
        address _receiver
    ) external payable returns (uint256);

    function get_dy(
        address[11] calldata _route,
        uint256[4][5] calldata _swap_params,
        uint256 _amount
    ) external view returns (uint256);

    function get_dx(
        address[11] calldata _route,
        uint256[4][5] calldata _swap_params,
        uint256 _out_amount
    ) external view returns (uint256);

    function version() external view returns (string memory);
}
