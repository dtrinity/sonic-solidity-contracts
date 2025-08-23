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

/**
 * @dev Interface for Odos Router V2.
 * @dev Generated from original ABI: https://fraxscan.com/address/0x56c85a254dd12ee8d9c04049a4ab62769ce98210#code
 */
pragma solidity ^0.8.20;

interface IOdosRouterV2 {
    struct swapTokenInfo {
        address inputToken;
        uint256 inputAmount;
        address inputReceiver;
        address outputToken;
        uint256 outputQuote;
        uint256 outputMin;
        address outputReceiver;
    }

    struct inputTokenInfo {
        address tokenAddress;
        uint256 amountIn;
        address receiver;
    }

    struct outputTokenInfo {
        address tokenAddress;
        uint256 relativeValue;
        address receiver;
    }

    struct permit2Info {
        address contractAddress;
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    event Swap(
        address sender,
        uint256 inputAmount,
        address inputToken,
        uint256 amountOut,
        address outputToken,
        int256 slippage,
        uint32 referralCode
    );

    event SwapMulti(
        address sender,
        uint256[] amountsIn,
        address[] tokensIn,
        uint256[] amountsOut,
        address[] tokensOut,
        uint32 referralCode
    );

    function FEE_DENOM() external view returns (uint256);

    function REFERRAL_WITH_FEE_THRESHOLD() external view returns (uint256);

    function addressList(uint256) external view returns (address);

    function owner() external view returns (address);

    function referralLookup(uint32) external view returns (uint64 referralFee, address beneficiary, bool registered);

    function registerReferralCode(uint32 _referralCode, uint64 _referralFee, address _beneficiary) external;

    function renounceOwnership() external;

    function setSwapMultiFee(uint256 _swapMultiFee) external;

    function swap(
        swapTokenInfo calldata tokenInfo,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external payable returns (uint256 amountOut);

    function swapCompact() external payable returns (uint256);

    function swapMulti(
        inputTokenInfo[] calldata inputs,
        outputTokenInfo[] calldata outputs,
        uint256 valueOutMin,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external payable returns (uint256[] memory amountsOut);

    function swapMultiCompact() external payable returns (uint256[] memory amountsOut);

    function swapMultiFee() external view returns (uint256);

    function swapMultiPermit2(
        permit2Info calldata permit2,
        inputTokenInfo[] calldata inputs,
        outputTokenInfo[] calldata outputs,
        uint256 valueOutMin,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external payable returns (uint256[] memory amountsOut);

    function swapPermit2(
        permit2Info calldata permit2,
        swapTokenInfo calldata tokenInfo,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external returns (uint256 amountOut);

    function swapRouterFunds(
        inputTokenInfo[] calldata inputs,
        outputTokenInfo[] calldata outputs,
        uint256 valueOutMin,
        bytes calldata pathDefinition,
        address executor
    ) external returns (uint256[] memory amountsOut);

    function transferOwnership(address newOwner) external;

    function transferRouterFunds(address[] calldata tokens, uint256[] calldata amounts, address dest) external;

    function writeAddressList(address[] calldata addresses) external;

    receive() external payable;
}
