import { Signer } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export const ZERO_BYTES_32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Safely migrate DEFAULT_ADMIN_ROLE from one admin to another.
 *
 * Guarantees:
 * - Attempts to ensure `adminToKeep` has DEFAULT_ADMIN_ROLE before revoking from `adminToRevoke`.
 * - Never performs a self-revocation (caller == adminToRevoke). In that case, it records a manual action
 *   instructing another admin (e.g., governance) to revoke instead.
 * - Falls back to manual actions when permissions are insufficient.
 */
export async function ensureDefaultAdminExistsAndRevokeFrom(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  contractAddress: string,
  adminToKeep: string,
  adminToRevoke: string,
  callerSigner: Signer,
  manualActions?: string[]
): Promise<void> {
  const contract = await hre.ethers.getContractAt(
    contractName,
    contractAddress,
    callerSigner
  );

  // Step 1: Ensure adminToKeep has DEFAULT_ADMIN_ROLE
  try {
    const hasAdmin = await contract.hasRole(ZERO_BYTES_32, adminToKeep);
    if (!hasAdmin) {
      try {
        await contract.grantRole(ZERO_BYTES_32, adminToKeep);
        console.log(
          `    ➕ Granted DEFAULT_ADMIN_ROLE to ${adminToKeep} on ${contractName}`
        );
      } catch (e) {
        console.log(
          `    ⚠️ Could not grant DEFAULT_ADMIN_ROLE to ${adminToKeep} on ${contractName}: ${(e as Error).message}`
        );
        manualActions?.push(
          `${contractName} (${contractAddress}).grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`
        );
      }
    }
  } catch (e) {
    console.log(
      `    ⚠️ Could not check/grant DEFAULT_ADMIN_ROLE for ${adminToKeep} on ${contractName}: ${(e as Error).message}`
    );
    manualActions?.push(
      `${contractName} (${contractAddress}).grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`
    );
  }

  // Re-check that adminToKeep has admin before proceeding with revoke
  try {
    const keepHasAdmin = await contract.hasRole(ZERO_BYTES_32, adminToKeep);
    if (!keepHasAdmin) {
      // Do not proceed with revoke to avoid lockout
      console.log(
        `    ⚠️ Skipping DEFAULT_ADMIN_ROLE revoke: ${adminToKeep} does not yet have admin on ${contractName}`
      );
      manualActions?.push(
        `${contractName} (${contractAddress}).grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`
      );
      return;
    }
  } catch (e) {
    console.log(
      `    ⚠️ Could not confirm ${adminToKeep} DEFAULT_ADMIN_ROLE on ${contractName}: ${(e as Error).message}`
    );
    manualActions?.push(
      `${contractName} (${contractAddress}).grantRole(DEFAULT_ADMIN_ROLE, ${adminToKeep})`
    );
    return;
  }

  // Step 2: Revoke DEFAULT_ADMIN_ROLE from adminToRevoke, but only by a different admin
  try {
    const revokeNeeded = await contract.hasRole(ZERO_BYTES_32, adminToRevoke);
    if (!revokeNeeded) {
      return;
    }
  } catch (e) {
    console.log(
      `    ⚠️ Could not check ${adminToRevoke} DEFAULT_ADMIN_ROLE on ${contractName}: ${(e as Error).message}`
    );
    manualActions?.push(
      `${contractName} (${contractAddress}).revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`
    );
    return;
  }

  const caller = (await callerSigner.getAddress()).toLowerCase();
  if (caller === adminToRevoke.toLowerCase()) {
    // Do not self-revoke; instruct another admin to revoke
    console.log(
      `    ⚠️ Not self-revoking DEFAULT_ADMIN_ROLE for ${adminToRevoke}. Recording manual action to revoke from a different admin.`
    );
    manualActions?.push(
      `${contractName} (${contractAddress}).revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`
    );
    return;
  }

  try {
    await contract.revokeRole(ZERO_BYTES_32, adminToRevoke);
    console.log(
      `    ➖ Revoked DEFAULT_ADMIN_ROLE from ${adminToRevoke} on ${contractName}`
    );
  } catch (e) {
    console.log(
      `    ⚠️ Could not revoke DEFAULT_ADMIN_ROLE from ${adminToRevoke} on ${contractName}: ${(e as Error).message}`
    );
    manualActions?.push(
      `${contractName} (${contractAddress}).revokeRole(DEFAULT_ADMIN_ROLE, ${adminToRevoke})`
    );
  }
}
