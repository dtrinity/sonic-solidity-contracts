// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IDPoolRouter} from "./interfaces/IDPoolRouter.sol";
import {IDPoolLPAdapter} from "./interfaces/IDPoolLPAdapter.sol";
import {IDPoolCollateralVault} from "./interfaces/IDPoolCollateralVault.sol";
import {BasisPointConstants} from "../../common/BasisPointConstants.sol";

/**
 * @title DPoolRouter
 * @notice Converts base asset <=> LP tokens via adapters with slippage protection
 * @dev Handles deposit/withdraw routing and manages LP adapters
 *      This contract is non-upgradeable but replaceable via DPoolToken governance
 */
contract DPoolRouter is IDPoolRouter, AccessControl {
    using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant MAX_SLIPPAGE_BPS = 100_000; // 10% maximum (in new BPS scale)

    // --- Roles ---
    bytes32 public constant DPOOL_TOKEN_ROLE = keccak256("DPOOL_TOKEN_ROLE");

    // --- Errors ---
    error ZeroAddress();
    error AdapterNotFound(address lpToken);
    error LPTokenAlreadySupported(address lpToken);
    error InvalidSlippage(uint256 slippage, uint256 maxSlippage);
    error AdapterMismatch(address expected, address actual);
    error SlippageExceeded(
        uint256 expected,
        uint256 actual,
        uint256 maxSlippage
    );
    error InsufficientLPTokens(uint256 required, uint256 available);

    // --- State ---
    address public immutable poolToken; // The DPoolToken this router serves
    address public immutable collateralVault; // The collateral vault
    address public immutable baseAsset; // The base asset address

    mapping(address => address) internal _lpAdapters; // lpToken => adapter
    address public defaultDepositLP; // Default LP token for deposits
    uint256 public maxSlippageBps; // Maximum allowed slippage in basis points

    // --- Constructor ---
    constructor(address _poolToken, address _collateralVault) {
        if (_poolToken == address(0) || _collateralVault == address(0)) {
            revert ZeroAddress();
        }

        poolToken = _poolToken;
        collateralVault = _collateralVault;
        baseAsset = IDPoolCollateralVault(_collateralVault).asset();

        if (baseAsset == address(0)) {
            revert ZeroAddress();
        }

        // Set initial max slippage to 2% (20,000 in new BPS scale)
        maxSlippageBps = 20_000;

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DPOOL_TOKEN_ROLE, _poolToken);
    }

    // --- View Functions ---

    /**
     * @inheritdoc IDPoolRouter
     */
    function lpAdapters(
        address lpToken
    ) external view returns (address adapter) {
        return _lpAdapters[lpToken];
    }

    // --- External Functions (IDPoolRouter Interface) ---

    /**
     * @inheritdoc IDPoolRouter
     */
    function deposit(
        uint256 baseAssetAmount,
        address receiver,
        uint256 minLPAmount
    ) external override onlyRole(DPOOL_TOKEN_ROLE) {
        if (defaultDepositLP == address(0)) {
            revert AdapterNotFound(address(0));
        }

        address adapterAddress = _lpAdapters[defaultDepositLP];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(defaultDepositLP);
        }

        // 1. Pull base asset from DPoolToken (caller)
        IERC20(baseAsset).safeTransferFrom(
            msg.sender,
            address(this),
            baseAssetAmount
        );

        // 2. Approve adapter to spend base asset
        IERC20(baseAsset).approve(adapterAddress, baseAssetAmount);

        // 3. Convert base asset to LP tokens via adapter
        // Adapter will send LP tokens directly to collateral vault
        (, uint256 lpAmount) = IDPoolLPAdapter(adapterAddress).convertToLP(
            baseAssetAmount,
            minLPAmount
        );

        emit Deposit(msg.sender, receiver, baseAssetAmount, lpAmount);
    }

    /**
     * @inheritdoc IDPoolRouter
     */
    function withdraw(
        uint256 baseAssetAmount,
        address receiver,
        address owner,
        uint256 maxSlippage
    ) external override onlyRole(DPOOL_TOKEN_ROLE) {
        if (maxSlippage > maxSlippageBps) {
            revert InvalidSlippage(maxSlippage, maxSlippageBps);
        }

        if (defaultDepositLP == address(0)) {
            revert AdapterNotFound(address(0));
        }

        address adapterAddress = _lpAdapters[defaultDepositLP];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(defaultDepositLP);
        }

        IDPoolLPAdapter adapter = IDPoolLPAdapter(adapterAddress);
        address lpToken = adapter.lpToken();

        // 1. Calculate required LP tokens for desired base asset amount
        uint256 requiredLPAmount = _calculateRequiredLPTokens(
            adapter,
            baseAssetAmount
        );

        // 2. Pull LP tokens from collateral vault
        IDPoolCollateralVault(collateralVault).sendLP(
            lpToken,
            requiredLPAmount,
            address(this)
        );

        // 3. Approve adapter to spend LP tokens
        IERC20(lpToken).approve(adapterAddress, requiredLPAmount);

        // 4. Calculate minimum base asset amount considering slippage
        uint256 minBaseAssetAmount = (baseAssetAmount *
            (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS - maxSlippage)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // 5. Convert LP tokens back to base asset
        uint256 receivedBaseAsset = adapter.convertFromLP(
            requiredLPAmount,
            minBaseAssetAmount
        );

        // 6. Send base asset to receiver
        IERC20(baseAsset).safeTransfer(receiver, receivedBaseAsset);

        emit Withdraw(
            msg.sender,
            receiver,
            owner,
            receivedBaseAsset,
            requiredLPAmount
        );
    }

    // --- External Functions (Governance) ---

    /**
     * @inheritdoc IDPoolRouter
     */
    function addLPAdapter(
        address lpToken,
        address adapterAddress
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lpToken == address(0) || adapterAddress == address(0)) {
            revert ZeroAddress();
        }
        if (_lpAdapters[lpToken] != address(0)) {
            revert LPTokenAlreadySupported(lpToken);
        }

        // Validate adapter configuration
        _validateAdapter(lpToken, adapterAddress);

        _lpAdapters[lpToken] = adapterAddress;
        emit LPAdapterAdded(lpToken, adapterAddress);
    }

    /**
     * @inheritdoc IDPoolRouter
     */
    function removeLPAdapter(
        address lpToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address adapterAddress = _lpAdapters[lpToken];
        if (adapterAddress == address(0)) {
            revert AdapterNotFound(lpToken);
        }

        delete _lpAdapters[lpToken];

        // Clear default if this was the default LP
        if (defaultDepositLP == lpToken) {
            defaultDepositLP = address(0);
        }

        emit LPAdapterRemoved(lpToken);
    }

    /**
     * @inheritdoc IDPoolRouter
     */
    function setDefaultDepositLP(
        address lpToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_lpAdapters[lpToken] == address(0)) {
            revert AdapterNotFound(lpToken);
        }

        address oldDefaultLP = defaultDepositLP;
        defaultDepositLP = lpToken;
        emit DefaultDepositLPUpdated(oldDefaultLP, lpToken);
    }

    /**
     * @inheritdoc IDPoolRouter
     */
    function setMaxSlippageBps(
        uint256 newMaxSlippageBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newMaxSlippageBps > MAX_SLIPPAGE_BPS) {
            revert InvalidSlippage(newMaxSlippageBps, MAX_SLIPPAGE_BPS);
        }

        uint256 oldMaxSlippage = maxSlippageBps;
        maxSlippageBps = newMaxSlippageBps;
        emit MaxSlippageUpdated(oldMaxSlippage, newMaxSlippageBps);
    }

    // --- Internal Functions ---

    /**
     * @notice Validates adapter configuration matches expected parameters
     * @param lpToken The LP token address
     * @param adapterAddress The adapter contract address
     */
    function _validateAdapter(
        address lpToken,
        address adapterAddress
    ) internal view {
        IDPoolLPAdapter adapter = IDPoolLPAdapter(adapterAddress);

        // Validate LP token matches
        try adapter.lpToken() returns (address reportedLP) {
            if (reportedLP != lpToken) {
                revert AdapterMismatch(lpToken, reportedLP);
            }
        } catch {
            revert AdapterMismatch(lpToken, address(0));
        }

        // Validate base asset matches
        try adapter.baseAsset() returns (address reportedBaseAsset) {
            if (reportedBaseAsset != baseAsset) {
                revert AdapterMismatch(baseAsset, reportedBaseAsset);
            }
        } catch {
            revert AdapterMismatch(baseAsset, address(0));
        }

        // Validate collateral vault matches
        try adapter.collateralVault() returns (address reportedVault) {
            if (reportedVault != collateralVault) {
                revert AdapterMismatch(collateralVault, reportedVault);
            }
        } catch {
            revert AdapterMismatch(collateralVault, address(0));
        }
    }

    /**
     * @notice Calculates required LP tokens for withdrawal with precision buffer
     * @param adapter The LP adapter to use for calculations
     * @param baseAssetAmount Target base asset amount to withdraw
     * @return requiredLPAmount Amount of LP tokens needed
     */
    function _calculateRequiredLPTokens(
        IDPoolLPAdapter adapter,
        uint256 baseAssetAmount
    ) internal view returns (uint256 requiredLPAmount) {
        address lpToken = adapter.lpToken();

        // Get current LP balance in the collateral vault
        uint256 currentLPBalance = IERC20(lpToken).balanceOf(collateralVault);

        if (currentLPBalance == 0) {
            return 0;
        }

        // Get total assets that could be withdrawn from current LP balance
        uint256 totalAssetsAvailable = adapter.previewConvertFromLP(
            currentLPBalance
        );

        if (totalAssetsAvailable == 0) {
            return 0;
        }

        // If requesting more than available, cap to what's available
        if (baseAssetAmount > totalAssetsAvailable) {
            baseAssetAmount = totalAssetsAvailable;
        }

        // Use proportional calculation: lpTokensNeeded = (requestedAssets * currentLPBalance) / totalAvailableAssets
        uint256 lpTokensNeeded = (baseAssetAmount * currentLPBalance) /
            totalAssetsAvailable;

        // Add a minimal slippage buffer only if the proportional calculation might have precision issues
        // Use a smaller buffer (0.1%) for precision rather than market slippage
        uint256 precisionBuffer = BasisPointConstants.ONE_HUNDRED_PERCENT_BPS /
            1000; // 0.1%
        requiredLPAmount =
            (lpTokensNeeded *
                (BasisPointConstants.ONE_HUNDRED_PERCENT_BPS +
                    precisionBuffer)) /
            BasisPointConstants.ONE_HUNDRED_PERCENT_BPS;

        // Revert if we don't have enough LP tokens available
        if (requiredLPAmount > currentLPBalance) {
            revert InsufficientLPTokens(requiredLPAmount, currentLPBalance);
        }

        return requiredLPAmount;
    }
}
