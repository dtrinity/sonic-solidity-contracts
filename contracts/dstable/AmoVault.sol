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

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/common/IMintableERC20.sol";
import "./AmoManager.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "contracts/dstable/CollateralVault.sol";

interface IRecoverable {
    function recoverERC20(address token, address to, uint256 amount) external;

    function recoverETH(address to, uint256 amount) external;
}

/**
 * @title AmoVault
 * @notice Base contract for AMO (Algorithmic Market Operations) vaults that manage dStable and collateral assets
 */
abstract contract AmoVault is CollateralVault, IRecoverable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeERC20 for IMintableERC20;
    using Address for address payable;

    /* Core state */

    IMintableERC20 public immutable dstable;
    uint8 public immutable dstableDecimals;
    AmoManager public amoManager;

    /* Roles */

    bytes32 public constant RECOVERER_ROLE = keccak256("RECOVERER_ROLE");

    /* Errors */

    error CannotRecoverVaultToken(address token);
    error InvalidAmoManager();

    constructor(
        address _dstable,
        address _amoManager,
        address _admin,
        address _collateralWithdrawer,
        address _recoverer,
        IPriceOracleGetter _oracle
    ) CollateralVault(_oracle) {
        dstable = IMintableERC20(_dstable);
        dstableDecimals = IERC20Metadata(_dstable).decimals();
        amoManager = AmoManager(_amoManager);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        grantRole(COLLATERAL_WITHDRAWER_ROLE, _collateralWithdrawer);
        grantRole(RECOVERER_ROLE, _recoverer);
        // Use standard approve for trusted protocol token (dStable) and trusted protocol contract (AmoManager)
        dstable.approve(address(amoManager), type(uint256).max);
    }

    /**
     * @notice Approves the AmoManager to spend dStable on behalf of this contract
     * @dev Only callable by the contract owner or an account with the DEFAULT_ADMIN_ROLE
     */
    function approveAmoManager() public onlyRole(DEFAULT_ADMIN_ROLE) {
        dstable.forceApprove(address(amoManager), type(uint256).max);
    }

    /**
     * @notice Updates the dStable allowance granted to the current AmoManager
     * @dev Resets the existing allowance to 0 first to accommodate non-standard ERC20 tokens that require
     *      the allowance to be set to zero before changing it.
     * @param amount The new allowance amount to grant.
     */
    function setAmoManagerApproval(
        uint256 amount
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        // Reset to zero first for safety with tokens that enforce the ERC20 race-condition mitigation
        // Use standard approve for trusted protocol token (dStable) and trusted protocol contract (AmoManager)
        dstable.approve(address(amoManager), 0);
        dstable.approve(address(amoManager), amount);
    }

    /**
     * @notice Sets a new AmoManager address
     * @param _newAmoManager The address of the new AmoManager
     * @dev Only callable by an account with the DEFAULT_ADMIN_ROLE
     */
    function setAmoManager(
        address _newAmoManager
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newAmoManager == address(0)) revert InvalidAmoManager();

        // Revoke allowance from the previous AmoManager to prevent it from spending vault funds
        // Use standard approve for trusted protocol token (dStable) and trusted protocol contract (AmoManager)
        dstable.approve(address(amoManager), 0);

        // Set new AMO manager
        amoManager = AmoManager(_newAmoManager);

        // Approve new AMO manager
        approveAmoManager();
    }

    /* Recovery */

    /**
     * @notice Recovers ERC20 tokens accidentally sent to the contract
     * @param token The address of the token to recover
     * @param to The address to send the tokens to
     * @param amount The amount of tokens to recover
     */
    function recoverERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(RECOVERER_ROLE) nonReentrant {
        if (token == address(dstable) || isCollateralSupported(token)) {
            revert CannotRecoverVaultToken(token);
        }
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Recovers ETH accidentally sent to the contract
     * @param to The address to send the ETH to
     * @param amount The amount of ETH to recover
     */
    function recoverETH(
        address to,
        uint256 amount
    ) external onlyRole(RECOVERER_ROLE) {
        payable(to).sendValue(amount);
    }

    /* Virtual functions */

    /**
     * @notice Calculates the total value of non-dStable collateral assets in the vault
     * @return The total value of collateral assets denominated in the base currency
     * @dev Must be implemented by derived contracts
     */
    function totalCollateralValue() public view virtual returns (uint256);

    /**
     * @notice Calculates the total value of dStable holdings in the vault
     * @return The total value of dStable holdings denominated in the base currency
     * @dev Must be implemented by derived contracts
     */
    function totalDstableValue() public view virtual returns (uint256);
}
