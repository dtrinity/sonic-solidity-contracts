// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDPoolCollateralVault} from "./interfaces/IDPoolCollateralVault.sol";
import {IDPoolLPAdapter} from "./interfaces/IDPoolLPAdapter.sol";

/**
 * @title DPoolCollateralVault
 * @notice Holds various LP tokens that can be priced in the base asset
 * @dev Calculates the total value of LP tokens using registered adapters
 *      This contract is non-upgradeable but replaceable via DPoolToken governance
 */
contract DPoolCollateralVault is IDPoolCollateralVault, AccessControl {
    using SafeERC20 for IERC20;

    // --- Roles ---
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error InvalidAdapter();
    error LPTokenNotSupported(address lpToken);
    error LPTokenAlreadySupported(address lpToken);
    error AdapterMismatch(address expected, address actual);
    error NonZeroBalance(address lpToken);
    error CollateralVaultMismatch(address expected, address actual);

    // --- State ---
    address public immutable poolToken; // The DPoolToken this vault serves
    address public immutable baseAsset; // The base asset address for pricing

    address public router; // The DPoolRouter allowed to interact

    mapping(address => address) public adapterForLP; // lpToken => adapter
    address[] public supportedLPTokens; // List of supported LP tokens

    // --- Constructor ---
    constructor(address _poolToken, address _baseAsset) {
        if (_poolToken == address(0) || _baseAsset == address(0)) {
            revert ZeroAddress();
        }
        poolToken = _poolToken;
        baseAsset = _baseAsset;

        // Set up the DEFAULT_ADMIN_ROLE initially to the contract deployer
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // --- External Views (IDPoolCollateralVault Interface) ---

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function getTotalAssetValue()
        external
        view
        override
        returns (uint256 baseAssetValue)
    {
        uint256 totalValue = 0;
        for (uint i = 0; i < supportedLPTokens.length; i++) {
            address lpToken = supportedLPTokens[i];
            address adapterAddress = adapterForLP[lpToken];
            if (adapterAddress != address(0)) {
                uint256 balance = IERC20(lpToken).balanceOf(address(this));
                if (balance > 0) {
                    totalValue += IDPoolLPAdapter(adapterAddress)
                        .lpValueInBaseAsset(lpToken, balance);
                }
            }
        }
        return totalValue;
    }

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function asset() external view override returns (address) {
        return baseAsset;
    }

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function getSupportedLPTokens()
        external
        view
        override
        returns (address[] memory)
    {
        return supportedLPTokens;
    }

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function getLPTokenBalance(
        address lpToken
    ) external view override returns (uint256) {
        return IERC20(lpToken).balanceOf(address(this));
    }

    // --- External Functions (Router Interactions) ---

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function sendLP(
        address lpToken,
        uint256 amount,
        address recipient
    ) external onlyRole(ROUTER_ROLE) {
        if (adapterForLP[lpToken] == address(0)) {
            revert LPTokenNotSupported(lpToken);
        }
        IERC20(lpToken).safeTransfer(recipient, amount);
        emit LPTokensSent(lpToken, amount, recipient);
    }

    // --- External Functions (Governance) ---

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function setRouter(
        address _newRouter
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRouter == address(0)) {
            revert ZeroAddress();
        }

        address oldRouter = router;

        // Revoke the ROUTER_ROLE from the old router if it exists
        if (router != address(0)) {
            _revokeRole(ROUTER_ROLE, router);
        }

        // Grant the ROUTER_ROLE to the new router
        _grantRole(ROUTER_ROLE, _newRouter);

        router = _newRouter;
        emit RouterUpdated(oldRouter, _newRouter);
    }

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function addLPAdapter(
        address lpToken,
        address adapterAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lpToken == address(0) || adapterAddress == address(0)) {
            revert ZeroAddress();
        }
        if (adapterForLP[lpToken] != address(0)) {
            revert LPTokenAlreadySupported(lpToken);
        }

        // Validate adapter interface and LP token match
        try IDPoolLPAdapter(adapterAddress).lpToken() returns (
            address reportedLPToken
        ) {
            if (reportedLPToken != lpToken) {
                revert AdapterMismatch(lpToken, reportedLPToken);
            }
        } catch {
            revert InvalidAdapter();
        }

        // Validate adapter points to correct collateral vault
        try IDPoolLPAdapter(adapterAddress).collateralVault() returns (
            address reportedVault
        ) {
            if (reportedVault != address(this)) {
                revert CollateralVaultMismatch(address(this), reportedVault);
            }
        } catch {
            revert InvalidAdapter();
        }

        // Validate adapter uses correct base asset
        try IDPoolLPAdapter(adapterAddress).baseAsset() returns (
            address reportedBaseAsset
        ) {
            if (reportedBaseAsset != baseAsset) {
                revert AdapterMismatch(baseAsset, reportedBaseAsset);
            }
        } catch {
            revert InvalidAdapter();
        }

        adapterForLP[lpToken] = adapterAddress;
        supportedLPTokens.push(lpToken);
        emit LPAdapterAdded(lpToken, adapterAddress);
    }

    /**
     * @inheritdoc IDPoolCollateralVault
     */
    function removeLPAdapter(
        address lpToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapterForLP[lpToken] == address(0)) {
            revert LPTokenNotSupported(lpToken);
        }
        if (IERC20(lpToken).balanceOf(address(this)) > 0) {
            revert NonZeroBalance(lpToken);
        }

        delete adapterForLP[lpToken];

        // Remove from supportedLPTokens array
        for (uint i = 0; i < supportedLPTokens.length; i++) {
            if (supportedLPTokens[i] == lpToken) {
                supportedLPTokens[i] = supportedLPTokens[
                    supportedLPTokens.length - 1
                ];
                supportedLPTokens.pop();
                break;
            }
        }
        emit LPAdapterRemoved(lpToken);
    }
}
