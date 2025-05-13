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

import "./FlashLoanLiquidatorAaveBase.sol";
import {Constants} from "../shared/Constants.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

abstract contract FlashLoanLiquidatorAaveBorrowRepayBase is
    FlashLoanLiquidatorAaveBase,
    Ownable
{
    using SafeERC20 for ERC20;
    using PercentageMath for uint256;

    uint256 public slippageTolerance; // in basis points units

    event SlippageToleranceSet(uint256 newTolerance);

    mapping(address => address) private proxyContractMap;

    constructor(
        ILendingPool _flashLoanLender,
        ILendingPoolAddressesProvider _addressesProvider,
        ILendingPool _liquidateLender,
        uint256 _slippageTolerance
    )
        FlashLoanLiquidatorAaveBase(
            _flashLoanLender,
            _liquidateLender,
            _addressesProvider
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
        bytes memory _swapData
    ) external nonReentrant {
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

        uint256 seized;
        address actualCollateralToken;
        if (
            liquidateParams.borrowedUnderlying.balanceOf(address(this)) >=
            _repayAmount
        )
            // we can liquidate without flash loan by using the contract balance
            seized = _liquidateInternal(liquidateParams);
        else {
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
            (seized, actualCollateralToken) = _liquidateWithFlashLoan(params);
        }

        if (!_stakeTokens)
            ERC20(actualCollateralToken).safeTransfer(msg.sender, seized);
    }

    /// @dev IFlashLoanSimpleReceiver callback
    function executeOperation(
        address, // asset to flash loan
        uint256 flashLoanAmount, // amount to flash loan
        uint256 premium, // fee to pay
        address _initiator, // initiator of the flash loan
        bytes calldata params
    ) external override returns (bool) {
        if (msg.sender != address(flashLoanLender)) revert UnknownLender();
        if (_initiator != address(this)) revert UnknownInitiator();
        FlashLoanParams memory flashLoanParams = _decodeData(params);
        if (flashLoanAmount != flashLoanParams.toRepay) {
            revert InvalidFlashLoanAmount(
                flashLoanAmount,
                flashLoanParams.toRepay
            );
        }

        _flashLoanInternal(flashLoanParams, premium);
        return true;
    }

    /// @dev IFlashLoanReceiver required function
    function ADDRESSES_PROVIDER()
        external
        view
        override
        returns (IPoolAddressesProvider)
    {
        return addressesProvider;
    }

    /// @dev IFlashLoanReceiver required function
    function POOL() external view override returns (IPool) {
        return flashLoanLender;
    }

    function _flashLoanInternal(
        FlashLoanParams memory _flashLoanParams,
        uint256 _premium
    ) internal {
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
            (
                address actualCollateralToken,
                address proxyContract
            ) = getActualCollateralToken(
                    _flashLoanParams.collateralUnderlying,
                    _flashLoanParams.isUnstakeCollateralToken
                );
            uint256 actualCollateralAmount = seized;

            if (_flashLoanParams.isUnstakeCollateralToken) {
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
            }

            IPriceOracleGetter oracle = IPriceOracleGetter(
                addressesProvider.getPriceOracle()
            );
            uint256 maxIn = (((actualCollateralAmount *
                10 ** ERC20(actualCollateralToken).decimals() *
                oracle.getAssetPrice(_flashLoanParams.borrowedUnderlying)) /
                oracle.getAssetPrice(actualCollateralToken) /
                10 ** liquidateParams.borrowedUnderlying.decimals()) *
                (Constants.ONE_HUNDRED_PERCENT_BPS + slippageTolerance)) /
                Constants.ONE_HUNDRED_PERCENT_BPS;

            _swapExactOutput(
                actualCollateralToken,
                _flashLoanParams.borrowedUnderlying,
                _flashLoanParams.swapData,
                _flashLoanParams.toRepay + _premium,
                maxIn
            );

            uint256 borrowedUnderlyingBalanceAfter = ERC20(
                _flashLoanParams.borrowedUnderlying
            ).balanceOf(address(this));

            // Make sure we have enough to repay the flash loan
            if (
                borrowedUnderlyingBalanceAfter <
                _flashLoanParams.toRepay + _premium
            ) {
                revert InsufficientFlashLoanRepayAmount(
                    borrowedUnderlyingBalanceAfter,
                    _flashLoanParams.toRepay + _premium
                );
            }
        }
        ERC20(_flashLoanParams.borrowedUnderlying).forceApprove(
            address(flashLoanLender),
            _flashLoanParams.toRepay + _premium
        );

        emit Liquidated(
            _flashLoanParams.liquidator,
            _flashLoanParams.borrower,
            _flashLoanParams.poolTokenBorrowed,
            _flashLoanParams.poolTokenCollateral,
            _flashLoanParams.toRepay,
            seized,
            true
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
    /// @param _inputToken address of the token to swap from
    /// @param _outputToken address of the token to swap to
    /// @param _swapData swap data
    /// @param _amount amount of tokens to swap
    /// @param _maxIn maximum amount of input tokens
    function _swapExactOutput(
        address _inputToken,
        address _outputToken,
        bytes memory _swapData,
        uint256 _amount,
        uint256 _maxIn
    ) internal virtual returns (uint256 amountIn);
}
