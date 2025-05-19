// SPDX-License-Identifier: GNU AGPLv3
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

pragma solidity 0.8.20;

import "./FlashMintLiquidatorAaveBase.sol";
import {Constants} from "../shared/Constants.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

abstract contract FlashMintLiquidatorAaveBorrowRepayBase is
    FlashMintLiquidatorAaveBase,
    Ownable
{
    using SafeERC20 for ERC20;
    using PercentageMath for uint256;
    using BreakPointHelper for uint256;

    uint256 public slippageTolerance; // in basis points units

    event SlippageToleranceSet(uint256 newTolerance);
    error NotSupportingNonDSTABLE(address borrowedToken, string symbol);

    mapping(address => address) private proxyContractMap;

    constructor(
        IERC3156FlashLender _flashMinter,
        ILendingPoolAddressesProvider _addressesProvider,
        ILendingPool _liquidateLender,
        IAToken _aDSTABLE,
        uint256 _slippageTolerance
    )
        FlashMintLiquidatorAaveBase(
            _flashMinter,
            _liquidateLender,
            _addressesProvider,
            _aDSTABLE
        )
        Ownable(msg.sender)
    {
        slippageTolerance = _slippageTolerance;
        emit SlippageToleranceSet(_slippageTolerance);
    }

    function setProxyContract(
        address _collateralUnderlying,
        address _proxyContract
    ) external onlyOwner {
        proxyContractMap[_collateralUnderlying] = _proxyContract;
    }

    function getProxyContract(
        address _collateralUnderlying
    ) public view returns (address) {
        address proxyContract = proxyContractMap[_collateralUnderlying];
        if (proxyContract != address(0)) {
            return proxyContract;
        }
        return _collateralUnderlying;
    }

    function setSlippageTolerance(uint256 _newTolerance) external onlyOwner {
        if (_newTolerance > Constants.ONE_HUNDRED_PERCENT_BPS)
            revert InvalidSlippageTolerance(_newTolerance);

        slippageTolerance = _newTolerance;
        emit SlippageToleranceSet(_newTolerance);
    }

    function liquidate(
        address _poolTokenBorrowedAddress,
        address _poolTokenCollateralAddress,
        address _borrower,
        uint256 _repayAmount,
        bool _stakeTokens,
        bool _isUnstakeCollateralToken,
        bytes memory _swapData,
        uint256 _breakPoint
    ) external nonReentrant {
        breakPoint = _breakPoint;

        LiquidateParams memory liquidateParams = LiquidateParams(
            _getUnderlying(_poolTokenCollateralAddress),
            _getUnderlying(_poolTokenBorrowedAddress),
            IAToken(_poolTokenCollateralAddress),
            IAToken(_poolTokenBorrowedAddress),
            msg.sender,
            _borrower,
            _repayAmount,
            _isUnstakeCollateralToken
        );
        breakPoint.checkBreakpointWithMessage(
            10001,
            "Yo 1"
        );

        uint256 seized;
        address actualCollateralToken;
        if (
            liquidateParams.borrowedUnderlying.balanceOf(address(this)) >=
            _repayAmount
        ) {
            // we can liquidate without flash loan by using the contract balance
            breakPoint.checkBreakpointWithMessage(
                10002,
                "Yo 2"
            );
            seized = _liquidateInternal(liquidateParams);
            breakPoint.checkBreakpointWithMessage(
                10003,
                "Yo 3"
            );
        } else {
            breakPoint.checkBreakpointWithMessage(
                10004,
                "Yo 4"
            );
            FlashLoanParams memory params = FlashLoanParams(
                address(liquidateParams.collateralUnderlying),
                address(liquidateParams.borrowedUnderlying),
                address(liquidateParams.poolTokenCollateral),
                address(liquidateParams.poolTokenBorrowed),
                liquidateParams.liquidator,
                liquidateParams.borrower,
                liquidateParams.toRepay,
                _isUnstakeCollateralToken,
                _swapData
            );
            breakPoint.checkBreakpointWithMessage(
                10005,
                "Yo 5"
            );
            (seized, actualCollateralToken) = _liquidateWithFlashLoan(params);
            breakPoint.checkBreakpointWithMessage(
                10006,
                "Yo 6"
            );
        }

        breakPoint.checkBreakpointWithMessage(
            10007,
            "Yo 7"
        );

        if (!_stakeTokens)
            ERC20(actualCollateralToken).safeTransfer(msg.sender, seized);

        breakPoint.checkBreakpointWithMessage(
            10008,
            "Yo 8"
        );
    }

    /// @dev ERC-3156 Flash loan callback
    function onFlashLoan(
        address _initiator,
        address,
        uint256, // flashloan amount
        uint256,
        bytes calldata data
    ) external override returns (bytes32) {
        if (msg.sender != address(flashMinter)) revert UnknownLender();
        if (_initiator != address(this)) revert UnknownInitiator();
        FlashLoanParams memory flashLoanParams = _decodeData(data);

        _flashLoanInternal(flashLoanParams);
        return FLASHLOAN_CALLBACK;
    }

    function _flashLoanInternal(
        FlashLoanParams memory _flashLoanParams
    ) internal {
        if (_flashLoanParams.borrowedUnderlying != address(dstable)) {
            revert NotSupportingNonDSTABLE(
                _flashLoanParams.borrowedUnderlying,
                ERC20(_flashLoanParams.borrowedUnderlying).symbol()
            );
        }

        LiquidateParams memory liquidateParams = LiquidateParams(
            ERC20(_flashLoanParams.collateralUnderlying),
            ERC20(_flashLoanParams.borrowedUnderlying),
            IAToken(_flashLoanParams.poolTokenCollateral),
            IAToken(_flashLoanParams.poolTokenBorrowed),
            _flashLoanParams.liquidator,
            _flashLoanParams.borrower,
            _flashLoanParams.toRepay,
            _flashLoanParams.isUnstakeCollateralToken
        );
        uint256 seized = _liquidateInternal(liquidateParams);

        if (
            _flashLoanParams.borrowedUnderlying !=
            _flashLoanParams.collateralUnderlying
        ) {
            breakPoint.checkBreakpointWithMessage(
                30001,
                "_flashLoanInternal 1"
            );
            (
                address actualCollateralToken,
                address proxyContract
            ) = getActualCollateralToken(
                    _flashLoanParams.collateralUnderlying,
                    _flashLoanParams.isUnstakeCollateralToken
                );
            breakPoint.checkBreakpointWithMessage(
                30002,
                "_flashLoanInternal 2"
            );
            uint256 actualCollateralAmount = seized;
            // If isUnstakeCollateralToken is true, we need to unstake the collateral to its underlying token
            if (_flashLoanParams.isUnstakeCollateralToken) {
                breakPoint.checkBreakpointWithMessage(
                    30003,
                    "_flashLoanInternal 3"
                );
                // Approve to burn the shares
                ERC20(_flashLoanParams.collateralUnderlying).approve(
                    proxyContract,
                    actualCollateralAmount
                );

                actualCollateralAmount = redeemERC4626Token(
                    proxyContract,
                    actualCollateralAmount,
                    address(this)
                );
                breakPoint.checkBreakpointWithMessage(
                    30004,
                    "_flashLoanInternal 4"
                );
            }

            // need a swap
            // we use aave oracle
            IPriceOracleGetter oracle = IPriceOracleGetter(
                addressesProvider.getPriceOracle()
            );
            breakPoint.checkBreakpointWithMessage(
                30005,
                "_flashLoanInternal 5"
            );

            // Convert toRepay amount from borrowedUnderlying to collateral token amount using oracle prices
            uint256 maxIn = (_flashLoanParams.toRepay *
                10 ** ERC20(actualCollateralToken).decimals() *
                oracle.getAssetPrice(_flashLoanParams.borrowedUnderlying)) /
                (oracle.getAssetPrice(actualCollateralToken) *
                10 ** liquidateParams.borrowedUnderlying.decimals()) *
                (Constants.ONE_HUNDRED_PERCENT_BPS + slippageTolerance) /
                Constants.ONE_HUNDRED_PERCENT_BPS;

            // breakPoint.checkBreakpointWithMessage(
            //     30006,
            //     string.concat(
            //         "_flashLoanInternal 6",
            //         "\n",
            //         "actualCollateralAmount: ",
            //         Converter.uintToString(actualCollateralAmount),
            //         "\n",
            //         "10 ** ERC20(actualCollateralToken).decimals(): ",
            //         Converter.uintToString(10 ** ERC20(actualCollateralToken).decimals()),
            //         "\n",
            //         "oracle.getAssetPrice(actualCollateralToken): ",
            //         Converter.uintToString(oracle.getAssetPrice(actualCollateralToken)),
            //         "\n",
            //         "oracle.getAssetPrice(_flashLoanParams.borrowedUnderlying): ",
            //         Converter.uintToString(oracle.getAssetPrice(_flashLoanParams.borrowedUnderlying)),
            //         "\n",
            //         "10 ** liquidateParams.borrowedUnderlying.decimals(): ",
            //         Converter.uintToString(10 ** liquidateParams.borrowedUnderlying.decimals()),
            //         "\n",
            //         "Constants.ONE_HUNDRED_PERCENT_BPS: ",
            //         Converter.uintToString(Constants.ONE_HUNDRED_PERCENT_BPS),
            //         "\n",
            //         "slippageTolerance: ",
            //         Converter.uintToString(slippageTolerance)
            //     )
            // );
            breakPoint.checkBreakpointWithMessage(
                30006,
                string.concat(
                    "\n",
                    "_flashLoanInternal 6",
                    "\n",
                    "maxIn: ",
                    Converter.uintToString(maxIn),
                    "\n",
                    "_flashLoanParams.toRepay: ",
                    Converter.uintToString(_flashLoanParams.toRepay),
                    "\n",
                    "price of collateral token: ",
                    Converter.uintToString(oracle.getAssetPrice(actualCollateralToken)),
                    "\n",
                    "price of borrowed token: ",
                    Converter.uintToString(oracle.getAssetPrice(_flashLoanParams.borrowedUnderlying)),
                    "\n",
                    "balance of collateral token: ",
                    Converter.uintToString(ERC20(actualCollateralToken).balanceOf(address(this))),
                    "\n",
                    "balance of borrowed token: ",
                    Converter.uintToString(ERC20(_flashLoanParams.borrowedUnderlying).balanceOf(address(this)))
                )
            );

            _swapExactOutput(
                actualCollateralToken,
                _flashLoanParams.borrowedUnderlying,
                _flashLoanParams.swapData,
                _flashLoanParams.toRepay,
                maxIn
            );
            breakPoint.checkBreakpointWithMessage(
                30007,
                "_flashLoanInternal 7"
            );
        }
        emit Liquidated(
            _flashLoanParams.liquidator,
            _flashLoanParams.borrower,
            _flashLoanParams.poolTokenBorrowed,
            _flashLoanParams.poolTokenCollateral,
            _flashLoanParams.toRepay,
            seized,
            true
        );
        breakPoint.checkBreakpointWithMessage(
            30008,
            "_flashLoanInternal 8"
        );
    }

    function redeemERC4626Token(
        address _collateralERC4626Token,
        uint256 _amount,
        address _recipient
    ) public returns (uint256) {
        return
            ERC4626(_collateralERC4626Token).redeem(
                _amount,
                _recipient,
                _recipient
            );
    }

    function getActualCollateralToken(
        address _collateralUnderlying,
        bool _isUnstakeCollateralToken
    )
        public
        view
        override
        returns (address actualCollateralToken_, address proxyContract_)
    {
        if (_isUnstakeCollateralToken) {
            proxyContract_ = getProxyContract(_collateralUnderlying);
            actualCollateralToken_ = ERC4626(proxyContract_).asset();
        } else {
            actualCollateralToken_ = _collateralUnderlying;
        }
        // If not unstake, the proxyContract_ is zero address
        return (actualCollateralToken_, proxyContract_);
    }

    /// @dev Swap exact output amount of tokens (need to override this method)
    /// @param _inputToken address of the token to swap
    /// @param _outputToken address of the token to swap
    /// @param _swapData swap data
    /// @param _amount amount of tokens to swap
    /// @param _maxIn maximum amount of input tokens
    /// @return amountIn amount of input tokens
    function _swapExactOutput(
        address _inputToken,
        address _outputToken,
        bytes memory _swapData,
        uint256 _amount,
        uint256 _maxIn
    ) internal virtual returns (uint256 amountIn);
}
