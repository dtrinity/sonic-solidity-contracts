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

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "contracts/common/IAaveOracle.sol";
import "contracts/common/IMintableERC20.sol";
import "./CollateralVault.sol";
import "./AmoManager.sol";
import "./OracleAware.sol";

/**
 * @title Issuer
 * @notice Contract responsible for issuing dUSD tokens
 */
contract Issuer is AccessControl, OracleAware {
    using SafeERC20 for IERC20Metadata;

    /* Core state */

    IMintableERC20 public dusd;
    uint8 public immutable dusdDecimals;
    CollateralVault public collateralVault;
    AmoManager public amoManager;

    uint256 public immutable USD_UNIT;

    /* Events */

    event CollateralVaultSet(address indexed collateralVault);
    event AmoManagerSet(address indexed amoManager);

    /* Roles */

    bytes32 public constant AMO_MANAGER_ROLE = keccak256("AMO_MANAGER_ROLE");
    bytes32 public constant INCENTIVES_MANAGER_ROLE =
        keccak256("INCENTIVES_MANAGER_ROLE");

    /* Errors */

    error SlippageTooHigh(uint256 minDUSD, uint256 dusdAmount);
    error IssuanceSurpassesExcessCollateral(
        uint256 collateralInDusd,
        uint256 circulatingDusd
    );
    error MintingToAmoShouldNotIncreaseSupply(
        uint256 circulatingDusdBefore,
        uint256 circulatingDusdAfter
    );

    /**
     * @notice Initializes the Issuer contract with core dependencies
     * @param _collateralVault The address of the collateral vault
     * @param _dusd The address of the dUSD stablecoin
     * @param oracle The address of the price oracle
     * @param _amoManager The address of the AMO Manager
     */
    constructor(
        address _collateralVault,
        address _dusd,
        IPriceOracleGetter oracle,
        address _amoManager
    ) OracleAware(oracle, DTrinityOracleConstants.ORACLE_BASE_CURRENCY_UNIT) {
        collateralVault = CollateralVault(_collateralVault);
        dusd = IMintableERC20(_dusd);
        dusdDecimals = dusd.decimals();
        amoManager = AmoManager(_amoManager);

        USD_UNIT = oracle.BASE_CURRENCY_UNIT();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(AMO_MANAGER_ROLE, msg.sender);
        grantRole(INCENTIVES_MANAGER_ROLE, msg.sender);
    }

    /* Issuer */

    /**
     * @notice Issues dUSD tokens in exchange for collateral from the caller
     * @param collateralAmount The amount of collateral to deposit
     * @param collateralAsset The address of the collateral asset
     * @param minDUSD The minimum amount of dUSD to receive, used for slippage protection
     */
    function issue(
        uint256 collateralAmount,
        address collateralAsset,
        uint256 minDUSD
    ) external {
        uint8 collateralDecimals = IERC20Metadata(collateralAsset).decimals();
        uint256 usdValue = (oracle.getAssetPrice(collateralAsset) *
            collateralAmount) / (10 ** collateralDecimals);
        uint256 dusdAmount = usdValueToDusdAmount(usdValue);
        if (dusdAmount < minDUSD) {
            revert SlippageTooHigh(minDUSD, dusdAmount);
        }

        // Transfer collateral directly to vault
        IERC20Metadata(collateralAsset).safeTransferFrom(
            msg.sender,
            address(collateralVault),
            collateralAmount
        );

        dusd.mint(msg.sender, dusdAmount);
    }

    /**
     * @notice Issues dUSD tokens using excess collateral in the system
     * @param receiver The address to receive the minted dUSD tokens
     * @param dusdAmount The amount of dUSD to mint
     */
    function issueUsingExcessCollateral(
        address receiver,
        uint256 dusdAmount
    ) external onlyRole(INCENTIVES_MANAGER_ROLE) {
        dusd.mint(receiver, dusdAmount);

        // We don't use the buffer value here because we only mint up to the excess collateral
        uint256 _circulatingDusd = circulatingDusd();
        uint256 _collateralInDusd = collateralInDusd();
        if (_collateralInDusd < _circulatingDusd) {
            revert IssuanceSurpassesExcessCollateral(
                _collateralInDusd,
                _circulatingDusd
            );
        }
    }

    /**
     * @notice Increases the AMO supply by minting new dUSD tokens
     * @param dusdAmount The amount of dUSD to mint and send to the AMO Manager
     */
    function increaseAmoSupply(
        uint256 dusdAmount
    ) external onlyRole(AMO_MANAGER_ROLE) {
        uint256 _circulatingDusdBefore = circulatingDusd();

        dusd.mint(address(amoManager), dusdAmount);

        uint256 _circulatingDusdAfter = circulatingDusd();

        // Sanity check that we are sending to the active AMO Manager
        if (_circulatingDusdAfter != _circulatingDusdBefore) {
            revert MintingToAmoShouldNotIncreaseSupply(
                _circulatingDusdBefore,
                _circulatingDusdAfter
            );
        }
    }

    /**
     * @notice Calculates the circulating supply of dUSD tokens
     * @return The amount of dUSD tokens that are not held by the AMO Manager
     */
    function circulatingDusd() public view returns (uint256) {
        uint256 totalDusd = dusd.totalSupply();
        uint256 amoDusd = amoManager.totalAmoSupply();
        return totalDusd - amoDusd;
    }

    /**
     * @notice Calculates the collateral value in dUSD tokens
     * @return The amount of dUSD tokens equivalent to the collateral value
     */
    function collateralInDusd() public view returns (uint256) {
        uint256 _collateralInUsd = collateralVault.totalValue();
        return usdValueToDusdAmount(_collateralInUsd);
    }

    /**
     * @notice Converts a USD value to an equivalent amount of dUSD tokens
     * @param usdValue The amount of USD value to convert
     * @return The equivalent amount of dUSD tokens
     */
    function usdValueToDusdAmount(
        uint256 usdValue
    ) public view returns (uint256) {
        return (usdValue * (10 ** dusdDecimals)) / USD_UNIT;
    }

    /* Admin */

    /**
     * @notice Sets the AMO Manager address
     * @param _amoManager The address of the AMO Manager
     */
    function setAmoManager(
        address _amoManager
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        amoManager = AmoManager(_amoManager);
        grantRole(AMO_MANAGER_ROLE, _amoManager);
        emit AmoManagerSet(_amoManager);
    }

    /**
     * @notice Sets the collateral vault address
     * @param _collateralVault The address of the collateral vault
     */
    function setCollateralVault(
        address _collateralVault
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collateralVault = CollateralVault(_collateralVault);
        emit CollateralVaultSet(_collateralVault);
    }
}
