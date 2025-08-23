import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export const ZERO_BYTES_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Safely migrate DEFAULT_ADMIN_ROLE from one admin to another.
 *
 * Guarantees:
 * - Ensures/attempts `adminToKeep` has DEFAULT_ADMIN_ROLE before removing it from `adminToRevoke`.
 * - If caller is the same as `adminToRevoke`, will self-renounce via renounceRole once `adminToKeep` is confirmed.
 * - Falls back to manual actions when permissions are insufficient.
 *
 * @param hre Hardhat runtime environment
 * @param contractName Name of the contract
 * @param contractAddress Address of the contract
 * @param adminToKeep Address that should retain DEFAULT_ADMIN_ROLE
 * @param adminToRevoke Address from which DEFAULT_ADMIN_ROLE should be revoked
 * @param callerSigner Signer that will execute the transactions
 * @param manualActions Array to collect manual actions that need to be performed
 */
export async function ensureDefaultAdminExistsAndRevokeFrom(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  adminToKeep: string,
  adminToRevoke: string,
  callerSigner: Signer,
  manualActions?: string[],
): Promise<void> {
  const contract = await hre.ethers.getContractAt(contractName, contractAddress, callerSigner);
  const DEFAULT_ADMIN_ROLE = ZERO_BYTES_32;
  const contractRef = `${contractName} (${contractAddress})`;

  // Phase 1: Ensure adminToKeep has DEFAULT_ADMIN_ROLE
  try {
    const hasAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, adminToKeep);

    if (!hasAdmin) {
      try {
        await contract.grantRole(DEFAULT_ADMIN_ROLE, adminToKeep);
        console.log(`    ➕ Granted DEFAULT_ADMIN_ROLE to ${adminToKeep} on ${contractName}`);
      } catch (e) {
        console.log(`    ⚠️ Could not grant DEFAULT_ADMIN_ROLE to ${adminToKeep} on ${contractName}: ${(e as Error).message}`);
        manualActions?.push(`${contractRef}.grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`);
      }
    }
  } catch (e) {
    console.log(`    ⚠️ Could not check/grant DEFAULT_ADMIN_ROLE for ${adminToKeep} on ${contractName}: ${(e as Error).message}`);
    manualActions?.push(`${contractRef}.grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`);
  }

  // Phase 2: Confirm adminToKeep has admin before proceeding with removal from adminToRevoke
  try {
    const keepHasAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, adminToKeep);

    if (!keepHasAdmin) {
      // Do not proceed with removal to avoid lockout
      console.log(`    ⚠️ Skipping DEFAULT_ADMIN_ROLE revoke: ${adminToKeep} does not yet have admin on ${contractName}`);
      manualActions?.push(`${contractRef}.grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`);
      return;
    }
  } catch (e) {
    console.log(`    ⚠️ Could not confirm ${adminToKeep} DEFAULT_ADMIN_ROLE on ${contractName}: ${(e as Error).message}`);
    manualActions?.push(`${contractRef}.grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`);
    return;
  }

  // Phase 3: Remove DEFAULT_ADMIN_ROLE from adminToRevoke (self-renounce if caller == adminToRevoke)
  try {
    const revokeNeeded = await contract.hasRole(DEFAULT_ADMIN_ROLE, adminToRevoke);

    if (!revokeNeeded) {
      return;
    }
  } catch (e) {
    console.log(`    ⚠️ Could not check ${adminToRevoke} DEFAULT_ADMIN_ROLE on ${contractName}: ${(e as Error).message}`);
    manualActions?.push(`${contractRef}.revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`);
    return;
  }

  const caller = (await callerSigner.getAddress()).toLowerCase();

  if (caller === adminToRevoke.toLowerCase()) {
    // Self-removal path: use renounceRole after confirming adminToKeep already has admin
    try {
      await contract.renounceRole(DEFAULT_ADMIN_ROLE, adminToRevoke);
      console.log(`    ➖ Renounced DEFAULT_ADMIN_ROLE for ${adminToRevoke} on ${contractName}`);
    } catch (e) {
      console.log(`    ⚠️ Could not renounce DEFAULT_ADMIN_ROLE for ${adminToRevoke} on ${contractName}: ${(e as Error).message}`);
      manualActions?.push(`${contractRef}.revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`);
    }
    return;
  }

  try {
    await contract.revokeRole(DEFAULT_ADMIN_ROLE, adminToRevoke);
    console.log(`    ➖ Revoked DEFAULT_ADMIN_ROLE from ${adminToRevoke} on ${contractName}`);
  } catch (e) {
    console.log(`    ⚠️ Could not revoke DEFAULT_ADMIN_ROLE from ${adminToRevoke} on ${contractName}: ${(e as Error).message}`);
    manualActions?.push(`${contractRef}.revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`);
  }
}
