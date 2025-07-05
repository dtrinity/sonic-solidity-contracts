import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import {
  AmoManager,
  MockAmoVault,
  TestMintableERC20,
} from "../../../typechain-types";
import {
  getTokenContractForSymbol,
  TokenInfo,
} from "../../../typescript/token/utils";
import {
  createDStableAmoFixture,
  DUSD_CONFIG,
  DS_CONFIG,
  DStableFixtureConfig,
} from "../fixtures";

// We re-use the existing utility to spin up fully featured deployments for each dStable
const dstableConfigs: DStableFixtureConfig[] = [DUSD_CONFIG, DS_CONFIG];

describe("AmoManager.deallocateAmo bounds checks", () => {
  let deployer: Address;

  before(async () => {
    ({ deployer } = await getNamedAccounts());
  });

  dstableConfigs.forEach((config) => {
    runTestsForDStable(config);
  });
});

async function runTestsForDStable(config: DStableFixtureConfig) {
  describe(`Bounds checks for ${config.symbol}`, () => {
    let fixture: () => Promise<void>;
    let amoManager: AmoManager;
    let mockAmoVault: MockAmoVault;
    let dstable: TestMintableERC20;
    let dstableInfo: TokenInfo;
    let deployer: Address;

    before(async () => {
      fixture = createDStableAmoFixture(config);
    });

    beforeEach(async () => {
      await fixture();

      ({ deployer } = await getNamedAccounts());

      // Obtain contracts required for the test
      const { address: amoManagerAddress } = await hre.deployments.get(
        config.amoManagerId
      );
      amoManager = await hre.ethers.getContractAt(
        "AmoManager",
        amoManagerAddress,
        await hre.ethers.getSigner(deployer)
      );

      const { address: mockVaultAddress } =
        await hre.deployments.get("MockAmoVault");
      mockAmoVault = await hre.ethers.getContractAt(
        "MockAmoVault",
        mockVaultAddress,
        await hre.ethers.getSigner(deployer)
      );

      ({ contract: dstable, tokenInfo: dstableInfo } =
        await getTokenContractForSymbol(hre, deployer, config.symbol));

      // Ensure vault is enabled before allocation
      if (!(await amoManager.isAmoActive(mockVaultAddress))) {
        await amoManager.enableAmoVault(mockVaultAddress);
      }
    });

    it("reverts with NotEnoughVaultAllocation when attempting to deallocate more than vault allocation", async () => {
      const allocationPrimary = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );

      // 1. Deploy a secondary mock AMO vault to inflate totalAllocated
      const secondaryVaultDeployment = await hre.deployments.deploy(
        "MockAmoVault_Overflow",
        {
          contract: "MockAmoVault",
          from: deployer,
          args: [
            dstableInfo.address,
            await amoManager.getAddress(),
            deployer,
            deployer,
            deployer,
            (await hre.deployments.get(config.oracleAggregatorId)).address,
          ],
          autoMine: true,
          log: false,
        }
      );

      const secondaryVault = await hre.ethers.getContractAt(
        "MockAmoVault",
        secondaryVaultDeployment.address,
        await hre.ethers.getSigner(deployer)
      );

      // Enable the secondary vault
      await amoManager.enableAmoVault(secondaryVaultDeployment.address);

      // 2. Mint AMO supply equal to primary + secondary allocations
      const secondaryAllocation = hre.ethers.parseUnits(
        "1000",
        dstableInfo.decimals
      );
      const totalMint = allocationPrimary + secondaryAllocation;

      await (
        await hre.ethers.getContractAt(
          "Issuer",
          (await hre.deployments.get(config.issuerContractId)).address,
          await hre.ethers.getSigner(deployer)
        )
      ).increaseAmoSupply(totalMint);

      // Allocate to both vaults
      const primaryVaultAddress = await mockAmoVault.getAddress();
      await amoManager.allocateAmo(primaryVaultAddress, allocationPrimary);
      await amoManager.allocateAmo(
        secondaryVaultDeployment.address,
        secondaryAllocation
      );

      // Calculate request that exceeds primary allocation by 1 wei but is less than totalAllocated
      const overAllocation = allocationPrimary + 1n; // 1000 + 1

      // Impersonate the primary vault so it can approve the manager for transfers
      const vaultAddress = primaryVaultAddress;
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [vaultAddress],
      });
      await hre.network.provider.send("hardhat_setBalance", [
        vaultAddress,
        "0x1000000000000000000",
      ]);
      await dstable
        .connect(await hre.ethers.getSigner(vaultAddress))
        .approve(await amoManager.getAddress(), overAllocation);

      await expect(
        amoManager.deallocateAmo(vaultAddress, overAllocation)
      ).to.be.revertedWithCustomError(amoManager, "NotEnoughVaultAllocation");

      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [vaultAddress],
      });
    });

    it("reverts with NotEnoughTotalAllocation when attempting to deallocate more than totalAllocated", async () => {
      const allocation = hre.ethers.parseUnits("500", dstableInfo.decimals);
      const deallocateAll = allocation;
      const overTotal = 1n; // Will attempt to over-deallocate by 1 wei after totalAllocated is zero

      // Fund AMO supply and allocate
      await (
        await hre.ethers.getContractAt(
          "Issuer",
          (await hre.deployments.get(config.issuerContractId)).address,
          await hre.ethers.getSigner(deployer)
        )
      ).increaseAmoSupply(allocation);
      const vaultAddress = await mockAmoVault.getAddress();
      await amoManager.allocateAmo(vaultAddress, allocation);

      // Impersonate vault for approvals
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [vaultAddress],
      });
      await hre.network.provider.send("hardhat_setBalance", [
        vaultAddress,
        "0x1000000000000000000",
      ]);
      const vaultSigner = await hre.ethers.getSigner(vaultAddress);

      // First: approve and deallocate the full allocation (valid path)
      await dstable
        .connect(vaultSigner)
        .approve(await amoManager.getAddress(), deallocateAll);
      await amoManager.deallocateAmo(vaultAddress, deallocateAll);

      // Second: approve and attempt another deallocation of 1 wei – should exceed totalAllocated (now zero)
      await dstable
        .connect(vaultSigner)
        .approve(await amoManager.getAddress(), overTotal);
      await expect(
        amoManager.deallocateAmo(vaultAddress, overTotal)
      ).to.be.revertedWithCustomError(amoManager, "NotEnoughTotalAllocation");

      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [vaultAddress],
      });
    });
  });
}
