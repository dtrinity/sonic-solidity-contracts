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

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AmoDebtToken
 * @notice ERC20 receipt token for AMO operations with transfer restrictions via allowlist
 * @dev Transfer-restricted ERC20 that only allows allowlisted addresses to send/receive tokens.
 * Used for unified accounting of AMO debt across collateral and stable AMO operations.
 * Token name is "dTRINITY AMO Receipt" with symbol "amo-dUSD" or "amo-dS" depending on the stablecoin type.
 */
contract AmoDebtToken is ERC20, AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    /* Core state */

    EnumerableSet.AddressSet private _allowlist;

    /* Roles */

    bytes32 public constant AMO_MINTER_ROLE = keccak256("AMO_MINTER_ROLE");
    bytes32 public constant AMO_BORROWER_ROLE = keccak256("AMO_BORROWER_ROLE");

    /* Events */

    event AllowlistSet(address indexed account, bool isAllowlisted);

    /* Errors */

    error NotAllowlisted(address account);
    error OnlyMinter();
    error OnlyBorrower();
    error InvalidVault(address vault);

    /**
     * @notice Initializes the AmoDebtToken with name and symbol
     * @param name The token name (e.g., "dTRINITY AMO Receipt")
     * @param symbol The token symbol (e.g., "amo-dUSD" or "amo-dS")
     * @dev Grants DEFAULT_ADMIN_ROLE to the deployer
     */
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Returns 18 decimals following dStable convention
     * @return The number of decimals (18)
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @notice Sets the allowlist status for an address
     * @param account The address to set allowlist status for
     * @param allowed Whether the address should be allowlisted
     * @dev Only callable by DEFAULT_ADMIN_ROLE
     */
    function setAllowlisted(address account, bool allowed) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed) {
            _allowlist.add(account);
        } else {
            _allowlist.remove(account);
        }
        emit AllowlistSet(account, allowed);
    }

    /**
     * @notice Checks if an address is allowlisted
     * @param account The address to check
     * @return Whether the address is allowlisted
     */
    function isAllowlisted(address account) public view returns (bool) {
        return _allowlist.contains(account);
    }

    /**
     * @notice Returns all allowlisted addresses
     * @return Array of allowlisted addresses
     */
    function getAllowlist() public view returns (address[] memory) {
        return _allowlist.values();
    }

    /**
     * @notice Returns the number of allowlisted addresses
     * @return The count of allowlisted addresses
     */
    function getAllowlistLength() public view returns (uint256) {
        return _allowlist.length();
    }

    /**
     * @notice Mints debt tokens to an allowlisted vault
     * @param vault The vault address to mint tokens to
     * @param amount The amount of tokens to mint
     * @dev Only callable by AMO_MINTER_ROLE and vault must be allowlisted
     */
    function mintToVault(address vault, uint256 amount) public onlyRole(AMO_MINTER_ROLE) {
        if (!_allowlist.contains(vault)) {
            revert InvalidVault(vault);
        }
        _mint(vault, amount);
    }

    /**
     * @notice Burns debt tokens from an allowlisted vault
     * @param vault The vault address to burn tokens from
     * @param amount The amount of tokens to burn
     * @dev Only callable by AMO_BORROWER_ROLE and vault must be allowlisted
     */
    function burnFromVault(address vault, uint256 amount) public onlyRole(AMO_BORROWER_ROLE) {
        if (!_allowlist.contains(vault)) {
            revert InvalidVault(vault);
        }
        _burn(vault, amount);
    }

    /**
     * @notice Override _update to enforce allowlist restrictions
     * @param from The address tokens are transferred from (zero address for minting)
     * @param to The address tokens are transferred to (zero address for burning)
     * @param value The amount of tokens being transferred
     * @dev Reverts if either sender or recipient is not allowlisted (except for mint/burn)
     */
    function _update(address from, address to, uint256 value) internal override {
        // Allow minting (from == address(0)) and burning (to == address(0))
        if (from != address(0) && !_allowlist.contains(from)) {
            revert NotAllowlisted(from);
        }
        if (to != address(0) && !_allowlist.contains(to)) {
            revert NotAllowlisted(to);
        }

        super._update(from, to, value);
    }
}
