// SPDX-License-Identifier: GNU AGPLv3
pragma solidity ^0.8.20;

import "../../odos/interface/IOdosRouterV2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OdosRouterV2Mock
 * @notice Mock implementation of OdosRouterV2 for testing purposes
 * @dev Allows setting exchange rates between tokens and simulates swaps
 */
contract OdosRouterV2Mock is IOdosRouterV2, Ownable {
    using SafeERC20 for IERC20;

    // Exchange rate mapping: token1 => token2 => rate (1 token1 = rate token2)
    mapping(address => mapping(address => uint256)) public exchangeRates;

    // Constants required by interface
    uint256 public constant FEE_DENOM = 1e6;
    uint256 public constant REFERRAL_WITH_FEE_THRESHOLD = 1e6;
    uint256 public swapMultiFee;

    // Referral info storage
    mapping(uint32 => ReferralInfo) public referrals;
    struct ReferralInfo {
        uint64 referralFee;
        address beneficiary;
        bool registered;
    }

    constructor() Ownable(msg.sender) {}

    // Override Ownable functions to match interface
    function owner()
        public
        view
        override(IOdosRouterV2, Ownable)
        returns (address)
    {
        return super.owner();
    }

    function transferOwnership(
        address newOwner
    ) public override(IOdosRouterV2, Ownable) {
        super.transferOwnership(newOwner);
    }

    function renounceOwnership() public override(IOdosRouterV2, Ownable) {
        super.renounceOwnership();
    }

    /**
     * @notice Sets the exchange rate between two tokens
     * @param token1 First token address
     * @param token2 Second token address
     * @param rate Exchange rate (1 token1 = rate token2)
     */
    function setExchangeRate(
        address token1,
        address token2,
        uint256 rate
    ) external onlyOwner {
        exchangeRates[token1][token2] = rate;
    }

    /**
     * @notice Main swap function implementation
     * @param tokenInfo Swap token information
     * @param pathDefinition Not used in mock
     * @param executor Not used in mock
     * @param referralCode Referral code
     */
    function swap(
        swapTokenInfo calldata tokenInfo,
        bytes calldata pathDefinition,
        address executor,
        uint32 referralCode
    ) external payable override returns (uint256 amountOut) {
        // Transfer input tokens from sender to this contract
        IERC20(tokenInfo.inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            tokenInfo.inputAmount
        );

        // Calculate output amount based on exchange rate
        uint256 rate = exchangeRates[tokenInfo.inputToken][
            tokenInfo.outputToken
        ];
        require(rate > 0, "Exchange rate not set");

        amountOut = (tokenInfo.inputAmount * rate) / 1e18;
        require(amountOut >= tokenInfo.outputMin, "Insufficient output amount");

        // Transfer output tokens to receiver
        IERC20(tokenInfo.outputToken).safeTransfer(
            tokenInfo.outputReceiver,
            amountOut
        );

        emit Swap(
            msg.sender,
            tokenInfo.inputAmount,
            tokenInfo.inputToken,
            amountOut,
            tokenInfo.outputToken,
            0, // slippage not implemented in mock
            referralCode
        );
    }

    /**
     * @notice Register a referral code with fee and beneficiary
     */
    function registerReferralCode(
        uint32 _referralCode,
        uint64 _referralFee,
        address _beneficiary
    ) external override {
        referrals[_referralCode] = ReferralInfo({
            referralFee: _referralFee,
            beneficiary: _beneficiary,
            registered: true
        });
    }

    /**
     * @notice Get referral information
     */
    function referralLookup(
        uint32 code
    )
        external
        view
        override
        returns (uint64 referralFee, address beneficiary, bool registered)
    {
        ReferralInfo memory info = referrals[code];
        return (info.referralFee, info.beneficiary, info.registered);
    }

    /**
     * @notice Set swap multi fee
     */
    function setSwapMultiFee(
        uint256 _swapMultiFee
    ) external override onlyOwner {
        swapMultiFee = _swapMultiFee;
    }

    // Required interface implementations with minimal functionality
    function swapMulti(
        inputTokenInfo[] calldata,
        outputTokenInfo[] calldata,
        uint256,
        bytes calldata,
        address,
        uint32
    ) external payable override returns (uint256[] memory) {
        revert("Not implemented in mock");
    }

    function swapPermit2(
        permit2Info calldata,
        swapTokenInfo calldata,
        bytes calldata,
        address,
        uint32
    ) external override returns (uint256) {
        revert("Not implemented in mock");
    }

    function swapMultiPermit2(
        permit2Info calldata,
        inputTokenInfo[] calldata,
        outputTokenInfo[] calldata,
        uint256,
        bytes calldata,
        address,
        uint32
    ) external payable override returns (uint256[] memory) {
        revert("Not implemented in mock");
    }

    function swapRouterFunds(
        inputTokenInfo[] calldata,
        outputTokenInfo[] calldata,
        uint256,
        bytes calldata,
        address
    ) external override returns (uint256[] memory) {
        revert("Not implemented in mock");
    }

    function transferRouterFunds(
        address[] calldata tokens,
        uint256[] calldata amounts,
        address dest
    ) external override onlyOwner {
        require(tokens.length == amounts.length, "Length mismatch");
        for (uint i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).safeTransfer(dest, amounts[i]);
        }
    }

    function writeAddressList(address[] calldata) external override {
        revert("Not implemented in mock");
    }

    function addressList(uint256) external pure override returns (address) {
        return address(0);
    }

    function swapCompact() external payable override returns (uint256) {
        revert("Not implemented in mock");
    }

    function swapMultiCompact()
        external
        payable
        override
        returns (uint256[] memory)
    {
        revert("Not implemented in mock");
    }

    receive() external payable override {}
}
