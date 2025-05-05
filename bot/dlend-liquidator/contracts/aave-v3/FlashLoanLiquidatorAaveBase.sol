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

import "../interface/IWETH.sol";
import "../interface/aave-v3/aave/ILendingPoolAddressesProvider.sol";
import {ILendingPool} from "../interface/aave-v3/aave/ILendingPool.sol";
import "../interface/aave-v3/aave/IPriceOracleGetter.sol";
import "../interface/aave-v3/IAToken.sol";
import "../interface/aave-v3/ILiquidator.sol";
import "../interface/aave-v3/libraries/aave/ReserveConfiguration.sol";
import "../interface/aave-v3/IFlashLoanSimpleReceiver.sol";
import "../interface/aave-v3/libraries/DataTypes.sol";

import "../libraries/PercentageMath.sol";

import "../interface/aave-v3/aave/ILendingPool.sol";
import {SharedLiquidator, SafeERC20} from "../common/SharedLiquidator.sol";

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract FlashLoanLiquidatorAaveBase is
    ReentrancyGuard,
    SharedLiquidator,
    IFlashLoanSimpleReceiver
{
    using SafeERC20 for ERC20;
    using ReserveConfiguration for DataTypes.ReserveConfigurationMap;
    using PercentageMath for uint256;

    struct FlashLoanParams {
        address collateralUnderlying;
        address borrowedUnderlying;
        address poolTokenCollateral;
        address poolTokenBorrowed;
        address liquidator;
        address borrower;
        uint256 toLiquidate;
        bool isUnstakeCollateralToken;
        bytes swapData;
    }

    struct LiquidateParams {
        ERC20 collateralUnderlying;
        ERC20 borrowedUnderlying;
        IAToken poolTokenCollateral;
        IAToken poolTokenBorrowed;
        address liquidator;
        address borrower;
        uint256 toRepay;
        bool isUnstakeCollateralToken;
    }

    error InvalidSlippageTolerance(uint256 value);

    error UnknownLender();

    error UnknownInitiator();

    error NoProfitableLiquidation();

    error InvalidFlashLoanAmount(uint256 flashLoanAmount, uint256 toLiquidate);

    error InsufficientFlashLoanRepayAmount(
        uint256 balance,
        uint256 totalToRepay
    );

    event Liquidated(
        address indexed liquidator,
        address borrower,
        address indexed poolTokenBorrowedAddress,
        address indexed poolTokenCollateralAddress,
        uint256 amount,
        uint256 seized,
        bool usingFlashLoan
    );

    event FlashLoan(address indexed initiator, uint256 amount);

    ILendingPool public immutable flashLoanLender;
    ILendingPool public immutable liquidateLender;
    ILendingPoolAddressesProvider public immutable addressesProvider;

    constructor(
        ILendingPool _flashLoanLender,
        ILendingPool _liquidateLender,
        ILendingPoolAddressesProvider _addressesProvider
    ) SharedLiquidator() {
        flashLoanLender = _flashLoanLender;
        liquidateLender = _liquidateLender;
        addressesProvider = _addressesProvider;
    }

    function _liquidateInternal(
        LiquidateParams memory _liquidateParams
    ) internal returns (uint256 seized_) {
        uint256 balanceBefore = _liquidateParams.collateralUnderlying.balanceOf(
            address(this)
        );
        _liquidateParams.borrowedUnderlying.forceApprove(
            address(liquidateLender),
            _liquidateParams.toRepay
        );
        liquidateLender.liquidationCall(
            address(
                _getUnderlying(address(_liquidateParams.poolTokenCollateral))
            ),
            address(
                _getUnderlying(address(_liquidateParams.poolTokenBorrowed))
            ),
            _liquidateParams.borrower,
            _liquidateParams.toRepay,
            false
        );
        seized_ =
            _liquidateParams.collateralUnderlying.balanceOf(address(this)) -
            balanceBefore;
        emit Liquidated(
            msg.sender,
            _liquidateParams.borrower,
            address(_liquidateParams.poolTokenBorrowed),
            address(_liquidateParams.poolTokenCollateral),
            _liquidateParams.toRepay,
            seized_,
            false
        );
    }

    function _liquidateWithFlashLoan(
        FlashLoanParams memory _flashLoanParams
    ) internal returns (uint256 seized_, address actualCollateralToken_) {
        bytes memory data = _encodeData(_flashLoanParams);

        (actualCollateralToken_, ) = getActualCollateralToken(
            _flashLoanParams.collateralUnderlying,
            _flashLoanParams.isUnstakeCollateralToken
        );

        uint256 balanceBefore = ERC20(actualCollateralToken_).balanceOf(
            address(this)
        );

        // The liquidation is done in the callback at executeOperation()
        // - contracts/lending_liquidator/aave-v3/FlashLoanLiquidatorAaveBorrowRepayUniswapV3.sol
        // - The flashLoanSimple() of the minter will call the executeOperation() function of the receiver (FlashLoanSimpleReceiver)
        uint256 borrowedTokenToFlashLoan = _flashLoanParams.toLiquidate;
        flashLoanLender.flashLoanSimple(
            address(this),
            _flashLoanParams.borrowedUnderlying,
            borrowedTokenToFlashLoan,
            data,
            0
        );

        uint256 balanceAfter = ERC20(actualCollateralToken_).balanceOf(
            address(this)
        );

        if (balanceAfter > balanceBefore) {
            seized_ = balanceAfter - balanceBefore;
        } else {
            // As there is no profit, the seized amount is 0
            seized_ = 0;
        }

        emit FlashLoan(msg.sender, borrowedTokenToFlashLoan);
    }

    function _encodeData(
        FlashLoanParams memory _flashLoanParams
    ) internal pure returns (bytes memory data) {
        data = abi.encode(
            _flashLoanParams.collateralUnderlying,
            _flashLoanParams.borrowedUnderlying,
            _flashLoanParams.poolTokenCollateral,
            _flashLoanParams.poolTokenBorrowed,
            _flashLoanParams.liquidator,
            _flashLoanParams.borrower,
            _flashLoanParams.toLiquidate,
            _flashLoanParams.isUnstakeCollateralToken,
            _flashLoanParams.swapData
        );
    }

    function _decodeData(
        bytes calldata data
    ) internal pure returns (FlashLoanParams memory _flashLoanParams) {
        // Need to split the decode because of stack too deep error
        (
            _flashLoanParams.collateralUnderlying,
            _flashLoanParams.borrowedUnderlying,
            _flashLoanParams.poolTokenCollateral,
            _flashLoanParams.poolTokenBorrowed,
            ,
            ,
            ,
            ,

        ) = abi.decode(
            data,
            (
                address,
                address,
                address,
                address,
                address,
                address,
                uint256,
                bool,
                bytes
            )
        );
        (
            ,
            ,
            ,
            ,
            _flashLoanParams.liquidator,
            _flashLoanParams.borrower,
            _flashLoanParams.toLiquidate,
            _flashLoanParams.isUnstakeCollateralToken,
            _flashLoanParams.swapData
        ) = abi.decode(
            data,
            (
                address,
                address,
                address,
                address,
                address,
                address,
                uint256,
                bool,
                bytes
            )
        );
    }

    function _getUnderlying(
        address _poolToken
    ) internal view returns (ERC20 underlying_) {
        underlying_ = ERC20(IAToken(_poolToken).UNDERLYING_ASSET_ADDRESS());
    }

    /**
     * @dev Get the actual collateral token address
     * @param _collateralUnderlying The underlying collateral token address
     * @param _isUnstakeCollateralToken Whether the collateral token is unstaked
     * @return actualCollateralToken_ The actual collateral token address
     * @return proxyContract_ The proxy contract address
     */
    function getActualCollateralToken(
        address _collateralUnderlying,
        bool _isUnstakeCollateralToken
    )
        public
        view
        virtual
        returns (address actualCollateralToken_, address proxyContract_);
}
