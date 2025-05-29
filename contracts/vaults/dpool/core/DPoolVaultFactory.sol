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
import "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title DPoolVaultFactory
 * @author dTRINITY Protocol
 * @notice Factory for deploying vault + periphery pairs across different DEX types
 * @dev Uses minimal proxy pattern for gas-efficient deployments
 */
contract DPoolVaultFactory is AccessControl {
    // --- Events ---

    /**
     * @notice Emitted when a new farm (vault + periphery) is deployed
     * @param dexType Type of DEX (e.g., "CURVE", "UNISWAP_V3")
     * @param vault Address of deployed vault
     * @param periphery Address of deployed periphery
     * @param lpToken Address of LP token
     * @param deployer Address that deployed the farm
     */
    event FarmDeployed(
        bytes32 indexed dexType,
        address indexed vault,
        address indexed periphery,
        address lpToken,
        address deployer
    );

    /**
     * @notice Emitted when vault implementation is updated
     * @param dexType DEX type
     * @param implementation New implementation address
     */
    event VaultImplementationUpdated(bytes32 indexed dexType, address implementation);

    /**
     * @notice Emitted when periphery implementation is updated
     * @param dexType DEX type
     * @param implementation New implementation address
     */
    event PeripheryImplementationUpdated(bytes32 indexed dexType, address implementation);

    // --- Errors ---

    /**
     * @notice Thrown when DEX type is not supported
     */
    error UnsupportedDexType();

    /**
     * @notice Thrown when implementation is not set
     */
    error ImplementationNotSet();

    // --- Structs ---

    /**
     * @notice Information about a deployed vault
     */
    struct VaultInfo {
        address vault;
        address periphery;
        bytes32 dexType;
        address lpToken;
        address baseAsset;
        string name;
        string symbol;
        uint256 deployedAt;
        address deployer;
    }

    // --- State Variables ---

    /// @notice Mapping from DEX type to vault implementation
    mapping(bytes32 => address) public vaultImplementations;

    /// @notice Mapping from DEX type to periphery implementation
    mapping(bytes32 => address) public peripheryImplementations;

    /// @notice Array of all deployed vaults
    address[] public deployedVaults;

    /// @notice Array of all deployed peripheries
    address[] public deployedPeripheries;

    /// @notice Mapping from vault address to vault info
    mapping(address => VaultInfo) public vaultInfo;

    /// @notice Mapping from vault to periphery
    mapping(address => address) public vaultToPeriphery;

    /// @notice Mapping from periphery to vault
    mapping(address => address) public peripheryToVault;

    // --- Constructor ---

    /**
     * @notice Initialize the factory
     * @param admin Address to grant admin role
     */
    constructor(address admin) {
        if (admin == address(0)) revert("Invalid admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // --- Deployment Functions ---

    /**
     * @notice Deploy a new farm (vault + periphery pair)
     * @param dexType Type of DEX (e.g., keccak256("CURVE"))
     * @param name Vault token name
     * @param symbol Vault token symbol
     * @param lpToken Address of LP token
     * @param pricingConfig DEX-specific configuration for pricing
     * @return vault Address of deployed vault
     * @return periphery Address of deployed periphery
     */
    function deployFarm(
        bytes32 dexType,
        string memory name,
        string memory symbol,
        address lpToken,
        bytes calldata pricingConfig
    ) external returns (address vault, address periphery) {
        // Check implementations exist
        address vaultImpl = vaultImplementations[dexType];
        address peripheryImpl = peripheryImplementations[dexType];
        
        if (vaultImpl == address(0) || peripheryImpl == address(0)) {
            revert ImplementationNotSet();
        }

        // Deploy vault clone
        vault = Clones.clone(vaultImpl);
        
        // Deploy periphery clone
        periphery = Clones.clone(peripheryImpl);

        // Initialize contracts based on DEX type
        if (dexType == keccak256("CURVE")) {
            _initializeCurveFarm(vault, periphery, name, symbol, lpToken, pricingConfig);
        } else {
            revert UnsupportedDexType();
        }

        // Record deployment
        deployedVaults.push(vault);
        deployedPeripheries.push(periphery);
        vaultToPeriphery[vault] = periphery;
        peripheryToVault[periphery] = vault;

        // Store vault info
        (address baseAsset, , ,) = abi.decode(pricingConfig, (address, address, int128, address));
        vaultInfo[vault] = VaultInfo({
            vault: vault,
            periphery: periphery,
            dexType: dexType,
            lpToken: lpToken,
            baseAsset: baseAsset,
            name: name,
            symbol: symbol,
            deployedAt: block.timestamp,
            deployer: msg.sender
        });

        emit FarmDeployed(dexType, vault, periphery, lpToken, msg.sender);
    }

    // --- View Functions ---

    /**
     * @notice Get information about a vault
     * @param vault Address of vault
     * @return Vault information struct
     */
    function getVaultInfo(address vault) external view returns (VaultInfo memory) {
        return vaultInfo[vault];
    }

    /**
     * @notice Get all deployed vaults
     * @return Array of vault addresses
     */
    function getAllVaults() external view returns (address[] memory) {
        return deployedVaults;
    }

    /**
     * @notice Get all deployed peripheries
     * @return Array of periphery addresses
     */
    function getAllPeripheries() external view returns (address[] memory) {
        return deployedPeripheries;
    }

    /**
     * @notice Get total number of deployed farms
     * @return Number of deployed farms
     */
    function getFarmCount() external view returns (uint256) {
        return deployedVaults.length;
    }

    /**
     * @notice Get periphery for a vault
     * @param vault Vault address
     * @return Periphery address
     */
    function getPeriphery(address vault) external view returns (address) {
        return vaultToPeriphery[vault];
    }

    /**
     * @notice Get vault for a periphery
     * @param periphery Periphery address
     * @return Vault address
     */
    function getVault(address periphery) external view returns (address) {
        return peripheryToVault[periphery];
    }

    // --- Admin Functions ---

    /**
     * @notice Set vault implementation for a DEX type
     * @param dexType DEX type identifier
     * @param implementation Implementation contract address
     */
    function setVaultImplementation(bytes32 dexType, address implementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (implementation == address(0)) revert("Invalid implementation");
        
        vaultImplementations[dexType] = implementation;
        emit VaultImplementationUpdated(dexType, implementation);
    }

    /**
     * @notice Set periphery implementation for a DEX type
     * @param dexType DEX type identifier
     * @param implementation Implementation contract address
     */
    function setPeripheryImplementation(bytes32 dexType, address implementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (implementation == address(0)) revert("Invalid implementation");
        
        peripheryImplementations[dexType] = implementation;
        emit PeripheryImplementationUpdated(dexType, implementation);
    }

    // --- Internal Functions ---

    /**
     * @notice Initialize Curve-specific farm
     * @param vault Vault address
     * @param periphery Periphery address
     * @param name Vault name
     * @param symbol Vault symbol
     * @param lpToken LP token address
     * @param pricingConfig Curve-specific config (baseAsset, pool, baseAssetIndex, admin)
     */
    function _initializeCurveFarm(
        address vault,
        address periphery,
        string memory name,
        string memory symbol,
        address lpToken,
        bytes calldata pricingConfig
    ) internal {
        (address baseAsset, address pool, int128 baseAssetIndex, address admin) = 
            abi.decode(pricingConfig, (address, address, int128, address));

        // Initialize vault
        (bool success,) = vault.call(
            abi.encodeWithSignature(
                "initialize(address,address,address,int128,string,string,address)",
                baseAsset,
                lpToken,
                pool,
                baseAssetIndex,
                name,
                symbol,
                admin
            )
        );
        require(success, "Vault initialization failed");

        // Initialize periphery
        (success,) = periphery.call(
            abi.encodeWithSignature(
                "initialize(address,address,address)",
                vault,
                pool,
                admin
            )
        );
        require(success, "Periphery initialization failed");
    }
} 