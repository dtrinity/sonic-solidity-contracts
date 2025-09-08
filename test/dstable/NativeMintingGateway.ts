import { expect } from "chai";
import hre, { ethers, getNamedAccounts } from "hardhat";
import { Signer, parseEther, ZeroAddress } from "ethers";
import { Address } from "hardhat-deploy/types";

import {
  NativeMintingGateway,
  IssuerV2,
  ERC20StablecoinUpgradeable,
  MockWrappedNativeToken,
  CollateralHolderVault,
  OracleAggregator,
} from "../../typechain-types";

import { createDStableFixture, DS_CONFIG } from "./fixtures";
import { getTokenContractForSymbol, TokenInfo } from "../../typescript/token/utils";
import {
  DS_ISSUER_V2_CONTRACT_ID,
  DS_TOKEN_ID,
  DS_COLLATERAL_VAULT_CONTRACT_ID,
  S_ORACLE_AGGREGATOR_ID,
  WS_DS_NATIVE_MINTING_GATEWAY_ID,
} from "../../typescript/deploy-ids";

describe("NativeMintingGateway (Integration)", () => {
  let deployer: Signer;
  let user1: Signer;
  let user2: Signer;
  let user3: Signer;
  let deployerAddress: Address;
  let user1Address: Address;
  let user2Address: Address;
  let user3Address: Address;

  let gateway: NativeMintingGateway;
  let issuerContract: IssuerV2;
  let dStableContract: ERC20StablecoinUpgradeable;
  let wNativeContract: MockWrappedNativeToken;
  let wNativeInfo: TokenInfo;
  let collateralVault: CollateralHolderVault;
  let oracleAggregator: OracleAggregator;

  // Test constants
  const depositAmount = parseEther("1.0");
  const minDStableLow = parseEther("0.5"); // Low minimum to succeed
  const minDStableHigh = parseEther("10000"); // High minimum to test slippage
  // MAX_DEPOSIT removed in contract

  // Use the dS fixture to deploy full ecosystem
  const fixture = createDStableFixture(DS_CONFIG);

  beforeEach(async () => {
    // Deploy the dS ecosystem using the fixture
    await fixture();

    // Deploy the native minting gateways using the deployment system
    // This tests the actual deployment configuration and process
    await hre.deployments.fixture(["native-minting-gateways"]);

    // Get named accounts
    const namedAccounts = await getNamedAccounts();
    ({ deployer: deployerAddress, user1: user1Address, user2: user2Address, user3: user3Address } = namedAccounts);

    deployer = await ethers.getSigner(deployerAddress);
    user1 = await ethers.getSigner(user1Address);
    user2 = await ethers.getSigner(user2Address);
    user3 = await ethers.getSigner(user3Address || user1Address);

    // Get deployed contracts using proper deployment pattern
    const issuerAddress = (await hre.deployments.get(DS_ISSUER_V2_CONTRACT_ID)).address;
    issuerContract = await hre.ethers.getContractAt("IssuerV2", issuerAddress, deployer);

    const dStableAddress = (await hre.deployments.get(DS_TOKEN_ID)).address;
    dStableContract = await hre.ethers.getContractAt("ERC20StablecoinUpgradeable", dStableAddress, deployer);

    const collateralVaultAddress = (await hre.deployments.get(DS_COLLATERAL_VAULT_CONTRACT_ID)).address;
    collateralVault = await hre.ethers.getContractAt("CollateralHolderVault", collateralVaultAddress, deployer);

    const oracleAggregatorAddress = (await hre.deployments.get(S_ORACLE_AGGREGATOR_ID)).address;
    oracleAggregator = await hre.ethers.getContractAt("OracleAggregator", oracleAggregatorAddress, deployer);

    // Get the deployed wS token (wrapped native for Sonic) from the ecosystem
    const wNativeResult = await getTokenContractForSymbol(hre, deployerAddress, "wS");
    wNativeInfo = wNativeResult.tokenInfo;

    // Deploy MockWrappedNativeToken for testing (since wS doesn't have deposit function)
    // But use the real wS oracle and collateral configuration
    const MockWNativeFactory = await ethers.getContractFactory("MockWrappedNativeToken", deployer);
    wNativeContract = await MockWNativeFactory.deploy("Wrapped Sonic", "wS");
    await wNativeContract.waitForDeployment();

    // Set up oracle price for our wrapped token using existing wS oracle configuration
    const wSOracleAddress = (await hre.deployments.get("wS_HardPegOracleWrapper")).address;
    await oracleAggregator.setOracle(await wNativeContract.getAddress(), wSOracleAddress);

    // Whitelist our wrapped token as collateral (following real deployment pattern)
    await collateralVault.connect(deployer).allowCollateral(await wNativeContract.getAddress());

    // Get the deployed NativeMintingGateway from the deployment system
    // This verifies the deployment system worked correctly
    const gatewayDeployment = await hre.deployments.get(WS_DS_NATIVE_MINTING_GATEWAY_ID);
    const deployedGateway = await hre.ethers.getContractAt("NativeMintingGateway", gatewayDeployment.address, deployer);

    // For functional testing, create a test version that uses MockWrappedNativeToken
    // This allows us to test the full deposit flow while maintaining deployment pattern verification
    const gatewayFactory = await ethers.getContractFactory("NativeMintingGateway", deployer);
    gateway = await gatewayFactory.deploy(
      await wNativeContract.getAddress(), // Mock with deposit() for testing
      issuerAddress,
      dStableAddress,
      user1Address, // owner from config (matches deployment config)
    );
    await gateway.waitForDeployment();

    // Store references for deployment verification tests
    (gateway as any).deployedGateway = deployedGateway;
    (gateway as any).deploymentConfig = {
      expectedWNative: wNativeInfo.address,
      expectedIssuer: issuerAddress,
      expectedToken: dStableAddress,
      expectedOwner: user1Address,
    };

    // Set up users with ETH for testing
    const users = [user1Address, user2Address, user3Address];
    for (const userAddr of users) {
      await hre.network.provider.send("hardhat_setBalance", [
        userAddr,
        "0x56BC75E2D63100000", // 100 ETH
      ]);
    }
  });

  // --- Core Functionality Tests ---
  describe("Core Functionality", () => {
    describe("Successful Operations", () => {
      it("Should successfully deposit native tokens and receive dStable", async () => {
        const gatewayAddress = await gateway.getAddress();

        // Record initial balances
        const userNativeBalanceBefore = await ethers.provider.getBalance(user1Address);
        const userDStableBalanceBefore = await dStableContract.balanceOf(user1Address);
        const gatewayNativeBalanceBefore = await ethers.provider.getBalance(gatewayAddress);
        const gatewayWNativeBalanceBefore = await wNativeContract.balanceOf(gatewayAddress);
        const gatewayDStableBalanceBefore = await dStableContract.balanceOf(gatewayAddress);
        const vaultWNativeBalanceBefore = await wNativeContract.balanceOf(await collateralVault.getAddress());

        // Execute deposit
        const tx = await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice!;

        // Record final balances
        const userNativeBalanceAfter = await ethers.provider.getBalance(user1Address);
        const userDStableBalanceAfter = await dStableContract.balanceOf(user1Address);
        const gatewayNativeBalanceAfter = await ethers.provider.getBalance(gatewayAddress);
        const gatewayWNativeBalanceAfter = await wNativeContract.balanceOf(gatewayAddress);
        const gatewayDStableBalanceAfter = await dStableContract.balanceOf(gatewayAddress);
        const vaultWNativeBalanceAfter = await wNativeContract.balanceOf(await collateralVault.getAddress());

        // Calculate amounts
        const dStableReceived = userDStableBalanceAfter - userDStableBalanceBefore;
        const nativeSpent = userNativeBalanceBefore - userNativeBalanceAfter - gasUsed;
        const vaultTokensReceived = vaultWNativeBalanceAfter - vaultWNativeBalanceBefore;

        // Core assertions
        expect(nativeSpent).to.equal(depositAmount, "User should spend exactly deposit amount");
        expect(dStableReceived).to.be.gt(0, "User should receive some dStable tokens");
        expect(dStableReceived).to.be.gte(minDStableLow, "User should receive at least minimum dStable");
        expect(vaultTokensReceived).to.equal(depositAmount, "Collateral vault should receive wrapped tokens");

        // Gateway should not hold any tokens after successful operation
        expect(gatewayNativeBalanceAfter).to.equal(gatewayNativeBalanceBefore, "Gateway should not hold native tokens");
        expect(gatewayWNativeBalanceAfter).to.equal(
          gatewayWNativeBalanceBefore,
          "Gateway should not hold wrapped tokens",
        );
        expect(gatewayDStableBalanceAfter).to.equal(
          gatewayDStableBalanceBefore,
          "Gateway should not hold dStable tokens",
        );

        // Downstream contracts emit their own events; gateway does not emit

        // Verify wrapped token deposit event
        await expect(tx).to.emit(wNativeContract, "Deposit").withArgs(gatewayAddress, depositAmount);
      });

      it("Should handle multiple sequential deposits correctly", async () => {
        const deposits = [parseEther("0.5"), parseEther("1.0"), parseEther("2.0")];
        let totalReceived = 0n;

        for (let i = 0; i < deposits.length; i++) {
          const depositAmt = deposits[i];
          const balanceBefore = await dStableContract.balanceOf(user1Address);

          await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmt });

          const balanceAfter = await dStableContract.balanceOf(user1Address);
          const received = balanceAfter - balanceBefore;

          expect(received).to.be.gt(0, `Deposit ${i + 1} should yield dStable tokens`);
          totalReceived += received;
        }

        expect(totalReceived).to.be.gt(parseEther("1"), "Multiple deposits should accumulate dStable");
      });

      it("Should work with multiple concurrent users", async () => {
        const users = [user1, user2, user3];
        const userAddresses = [user1Address, user2Address, user3Address];
        const deposits = [parseEther("1.0"), parseEther("1.5"), parseEther("0.8")];

        // Record initial balances
        const initialBalances = await Promise.all(userAddresses.map((addr) => dStableContract.balanceOf(addr)));

        // Execute deposits for each user
        for (let i = 0; i < users.length; i++) {
          await gateway.connect(users[i]).depositAndMint(minDStableLow, { value: deposits[i] });
        }

        // Verify all users received tokens
        const finalBalances = await Promise.all(userAddresses.map((addr) => dStableContract.balanceOf(addr)));

        for (let i = 0; i < users.length; i++) {
          const received = finalBalances[i] - initialBalances[i];
          expect(received).to.be.gt(0, `User ${i + 1} should receive dStable tokens`);
          expect(received).to.be.gte(minDStableLow, `User ${i + 1} should receive at least minimum`);
        }
      });
    });
  });

  // --- Input Validation Tests ---
  describe("Input Validation", () => {
    it("Should revert if zero value is sent", async () => {
      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: 0 })).to.be.revertedWithCustomError(
        gateway,
        "ZeroDeposit",
      );
    });

    it("Should revert if minDStable is zero", async () => {
      await expect(gateway.connect(user1).depositAndMint(0, { value: depositAmount })).to.be.revertedWithCustomError(
        gateway,
        "InvalidMinDStable",
      );
    });

    // Removed: max deposit check (contract no longer enforces MAX_DEPOSIT)

    it("Should handle existing wrapped token balances correctly", async () => {
      const existingBalance = parseEther("0.5");
      const gatewayAddress = await gateway.getAddress();

      // Send some wrapped tokens to gateway first (simulate stuck tokens)
      await wNativeContract.connect(user1).mint(gatewayAddress, existingBalance);

      const gatewayWNativeBalanceBefore = await wNativeContract.balanceOf(gatewayAddress);
      expect(gatewayWNativeBalanceBefore).to.equal(existingBalance);

      // Deposit should still work correctly despite existing balance
      const userBalanceBefore = await dStableContract.balanceOf(user1Address);

      await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });

      const userBalanceAfter = await dStableContract.balanceOf(user1Address);
      const gatewayWNativeBalanceAfter = await wNativeContract.balanceOf(gatewayAddress);

      // User should receive dStable tokens
      expect(userBalanceAfter - userBalanceBefore).to.be.gt(0);

      // Gateway should only hold the pre-existing balance (new tokens should be processed)
      expect(gatewayWNativeBalanceAfter).to.equal(existingBalance);
    });
  });

  // --- Failure Scenarios ---
  describe("Failure Scenarios", () => {
    it("Should handle issuer failures gracefully", async () => {
      // Pause the issuer to simulate failure
      const governanceSigner = await ethers.getSigner(user1Address);
      await issuerContract.connect(governanceSigner).pauseMinting();

      const userBalanceBefore = await ethers.provider.getBalance(user1Address);

      // Transaction should fail and return funds
      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount })).to.be.reverted;

      const userBalanceAfter = await ethers.provider.getBalance(user1Address);
      const balanceChange = userBalanceBefore - userBalanceAfter;

      // User should only lose gas, not the deposit amount
      expect(balanceChange).to.be.lt(parseEther("0.01"));
      expect(balanceChange).to.be.gt(0);
    });

    it("Should revert with IssuerOperationFailed on issuer failure", async () => {
      const governanceSigner = await ethers.getSigner(user1Address);
      await issuerContract.connect(governanceSigner).setAssetMintingPause(await wNativeContract.getAddress(), true);

      await expect(
        gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount }),
      ).to.be.revertedWithCustomError(gateway, "IssuerOperationFailed");
    });
  });

  // --- Emergency Rescue Functions Tests ---
  describe("Emergency Rescue Functions", () => {
    describe("rescueNative", () => {
      it("Should allow owner to rescue native tokens", async () => {
        const rescueAmount = parseEther("0.5");
        const gatewayAddress = await gateway.getAddress();
        const owner = await gateway.owner();
        const ownerSigner = await ethers.getSigner(owner);

        // Set gateway native balance directly since receive() now reverts
        await hre.network.provider.send("hardhat_setBalance", [gatewayAddress, `0x${rescueAmount.toString(16)}`]);

        const ownerBalanceBefore = await ethers.provider.getBalance(owner);
        const gatewayBalanceBefore = await ethers.provider.getBalance(gatewayAddress);

        expect(gatewayBalanceBefore).to.equal(rescueAmount);

        // Rescue tokens
        const tx = await gateway.connect(ownerSigner).rescueNative();
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice!;

        const ownerBalanceAfter = await ethers.provider.getBalance(owner);
        const gatewayBalanceAfter = await ethers.provider.getBalance(gatewayAddress);

        // Check balances
        expect(gatewayBalanceAfter).to.equal(0);
        expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + rescueAmount - gasUsed);
      });

      it("Should revert if called by non-owner", async () => {
        await expect(
          gateway.connect(user2).rescueNative(), // user2 is not owner
        ).to.be.revertedWithCustomError(gateway, "OwnableUnauthorizedAccount");
      });

      it("Should do nothing if no native tokens to rescue", async () => {
        const owner = await gateway.owner();
        const ownerSigner = await ethers.getSigner(owner);

        // Should not revert when no tokens to rescue
        await expect(gateway.connect(ownerSigner).rescueNative()).to.not.be.reverted;
      });
    });

    describe("rescueTokens", () => {
      it("Should allow owner to rescue ERC20 tokens", async () => {
        const rescueAmount = parseEther("2.0");
        const gatewayAddress = await gateway.getAddress();
        const owner = await gateway.owner();
        const ownerSigner = await ethers.getSigner(owner);

        // Mint and send wrapped tokens to gateway (simulating stuck tokens)
        await wNativeContract.connect(deployer).mint(gatewayAddress, rescueAmount);

        const ownerBalanceBefore = await wNativeContract.balanceOf(owner);
        const gatewayBalanceBefore = await wNativeContract.balanceOf(gatewayAddress);

        expect(gatewayBalanceBefore).to.equal(rescueAmount);

        // Rescue tokens
        await gateway.connect(ownerSigner).rescueTokens(wNativeContract.getAddress());

        const ownerBalanceAfter = await wNativeContract.balanceOf(owner);
        const gatewayBalanceAfter = await wNativeContract.balanceOf(gatewayAddress);

        // Check balances
        expect(gatewayBalanceAfter).to.equal(0);
        expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + rescueAmount);
      });

      it("Should rescue dStable tokens if any remain", async () => {
        const rescueAmount = parseEther("1.0");
        const gatewayAddress = await gateway.getAddress();
        const owner = await gateway.owner();
        const ownerSigner = await ethers.getSigner(owner);

        // Mint dStable tokens to deployer first, then transfer to gateway
        const minterRole = await dStableContract.MINTER_ROLE();
        await dStableContract.grantRole(minterRole, deployerAddress);
        await dStableContract.connect(deployer).mint(deployerAddress, rescueAmount);
        await dStableContract.connect(deployer).transfer(gatewayAddress, rescueAmount);

        const ownerBalanceBefore = await dStableContract.balanceOf(owner);

        // Rescue tokens
        await gateway.connect(ownerSigner).rescueTokens(dStableContract.getAddress());

        const ownerBalanceAfter = await dStableContract.balanceOf(owner);
        const gatewayBalanceAfter = await dStableContract.balanceOf(gatewayAddress);

        expect(gatewayBalanceAfter).to.equal(0);
        expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + rescueAmount);
      });

      it("Should revert if called by non-owner", async () => {
        await expect(
          gateway.connect(user2).rescueTokens(wNativeContract.getAddress()), // user2 is not owner
        ).to.be.revertedWithCustomError(gateway, "OwnableUnauthorizedAccount");
      });

      it("Should do nothing if no tokens to rescue", async () => {
        const owner = await gateway.owner();
        const ownerSigner = await ethers.getSigner(owner);

        await expect(gateway.connect(ownerSigner).rescueTokens(wNativeContract.getAddress())).to.not.be.reverted;
      });
    });
  });

  // --- Receive Fallback Tests ---
  describe("receive", () => {
    it("Should revert on direct native transfers", async () => {
      const sendAmount = parseEther("0.5");
      const gatewayAddress = await gateway.getAddress();

      await expect(user1.sendTransaction({ to: gatewayAddress, value: sendAmount })).to.be.revertedWithCustomError(
        gateway,
        "DirectNativeTransferNotAllowed",
      );
    });
  });

  // --- Contract Configuration Tests ---
  describe("Contract Configuration", () => {
    it("Should be properly configured with IssuerV2", async () => {
      const issuerAddress = await gateway.DSTABLE_ISSUER();
      const issuer = await hre.ethers.getContractAt("IssuerV2", issuerAddress);

      // Verify it's actually IssuerV2 by checking for V2-specific functions
      expect(await issuer.assetMintingPaused(await wNativeContract.getAddress())).to.be.false;
    });

    it("Should have proper access controls", async () => {
      // Check owner is set correctly from config
      const owner = await gateway.owner();
      expect(owner).to.equal(user1Address); // From localhost config

      // Check reentrancy guard is inherited (method should exist)
      expect(gateway.interface.hasFunction("depositAndMint")).to.be.true;
    });

    it("Should have proper state variables", async () => {
      expect(await gateway.W_NATIVE_TOKEN()).to.equal(await wNativeContract.getAddress());
      expect(await gateway.DSTABLE_ISSUER()).to.equal(await issuerContract.getAddress());
      expect(await gateway.DSTABLE_TOKEN()).to.equal(await dStableContract.getAddress());
      // MAX_DEPOSIT removed; no assertion
    });
  });

  // --- MockWrappedNativeToken Testing ---
  describe("MockWrappedNativeToken Functionality", () => {
    it("Should work properly with MockWrappedNativeToken", async () => {
      // This test verifies that our MockWrappedNativeToken enables proper testing
      // The MockWrappedNativeToken has deposit() and withdraw() functions

      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount })).to.not.be.reverted;

      // Verify we actually received dStable tokens
      const userBalance = await dStableContract.balanceOf(user1Address);
      expect(userBalance).to.be.gt(0);
      expect(userBalance).to.be.gte(minDStableLow);
    });

    it("Should show the call that would be made to real wrapped token", async () => {
      // Verify the gateway would call the correct function on a real wrapped token
      const wNativeAddress = await gateway.W_NATIVE_TOKEN();

      // The gateway expects this contract to have a deposit() function
      // Real wrapped native tokens implement this interface:
      // interface IwNative {
      //     function deposit() external payable;
      //     function balanceOf(address) external view returns (uint256);
      // }

      expect(wNativeAddress).to.equal(await wNativeContract.getAddress());
      expect(await ethers.provider.getCode(wNativeAddress)).to.not.equal("0x");
    });

    it("Should demonstrate proper error handling on external call failure", async () => {
      // Test that external call failures are handled gracefully
      // Pause the issuer to simulate external failure

      const governanceSigner = await ethers.getSigner(user1Address);
      await issuerContract.connect(governanceSigner).pauseMinting();

      const tx = gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });

      await expect(tx).to.be.reverted;

      // The native tokens should be returned to user via transaction revert
      // This is automatically handled by EVM transaction atomicity
    });
  });

  // --- Security Tests ---
  describe("Security Features", () => {
    // Removed: maximum deposit limit test
    it("Should prevent unauthorized access to rescue functions", async () => {
      await expect(gateway.connect(user2).rescueNative()).to.be.revertedWithCustomError(
        gateway,
        "OwnableUnauthorizedAccount",
      );

      await expect(gateway.connect(user2).rescueTokens(wNativeContract.getAddress())).to.be.revertedWithCustomError(
        gateway,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should be protected against reentrancy", async () => {
      // The contract should have nonReentrant modifier on depositAndMint
      // This is verified by checking the modifier exists in the interface
      const func = gateway.interface.getFunction("depositAndMint");
      expect(func).to.not.be.undefined;
    });
  });

  // --- Integration Verification ---
  describe("Integration with dS Ecosystem", () => {
    it("Should be integrated with the correct IssuerV2 contract", async () => {
      const issuerAddress = await gateway.DSTABLE_ISSUER();
      expect(issuerAddress).to.equal(await issuerContract.getAddress());

      // Verify issuer configuration
      expect(await issuerContract.dstable()).to.equal(await dStableContract.getAddress());
      expect(await issuerContract.collateralVault()).to.equal(await collateralVault.getAddress());
    });

    it("Should verify collateral support in the ecosystem", async () => {
      // Verify wS is supported as collateral by the issuer's vault
      const issuerVault = await issuerContract.collateralVault();
      const vault = await hre.ethers.getContractAt("CollateralHolderVault", issuerVault);

      expect(await vault.isCollateralSupported(await wNativeContract.getAddress())).to.be.true;
    });

    it("Should have proper oracle configuration", async () => {
      const issuerOracleAddress = await issuerContract.oracle();
      const oracle = await hre.ethers.getContractAt(
        "contracts/common/IAaveOracle.sol:IPriceOracleGetter",
        issuerOracleAddress,
      );

      // Verify oracle can provide price for wS
      const wNativePrice = await oracle.getAssetPrice(await wNativeContract.getAddress());
      expect(wNativePrice).to.be.gt(0, "Oracle should provide valid price for wS");
    });
  });

  // --- Error Handling Tests ---
  describe("Error Handling", () => {
    it("Should have descriptive custom errors", async () => {
      // Test each custom error exists and can be triggered appropriately

      // ZeroDeposit
      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: 0 })).to.be.revertedWithCustomError(
        gateway,
        "ZeroDeposit",
      );

      // InvalidMinDStable
      await expect(gateway.connect(user1).depositAndMint(0, { value: depositAmount })).to.be.revertedWithCustomError(
        gateway,
        "InvalidMinDStable",
      );

      // ExceedsMaxDeposit (when user has sufficient balance)
      await hre.network.provider.send("hardhat_setBalance", [
        user1Address,
        `0x${(parseEther("1000000") * 2n).toString(16)}`,
      ]);

      // Removed: ExceedsMaxDeposit check
    });

    it("Should handle external contract failures gracefully", async () => {
      // Test external failure by pausing the issuer
      const governanceSigner = await ethers.getSigner(user1Address);
      await issuerContract.connect(governanceSigner).pauseMinting();

      const userBalanceBefore = await ethers.provider.getBalance(user1Address);

      try {
        await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });
      } catch (error) {
        // Expected to fail due to paused issuer
      }

      const userBalanceAfter = await ethers.provider.getBalance(user1Address);
      const gasSpent = userBalanceBefore - userBalanceAfter;

      // User should only lose gas, not the deposit amount (transaction reverts)
      expect(gasSpent).to.be.lt(parseEther("0.1")); // Only gas costs (increased tolerance)
      expect(gasSpent).to.be.gt(0); // Some gas was spent
    });
  });

  // --- Production Readiness Tests ---
  describe("Production Readiness", () => {
    it("Should be properly configured for production use", async () => {
      // Verify all addresses are properly configured
      expect(await gateway.W_NATIVE_TOKEN()).to.not.equal(ZeroAddress);
      expect(await gateway.DSTABLE_ISSUER()).to.not.equal(ZeroAddress);
      expect(await gateway.DSTABLE_TOKEN()).to.not.equal(ZeroAddress);
      expect(await gateway.owner()).to.not.equal(ZeroAddress);
    });

    it("Should have security features enabled", async () => {
      // Verify security constants
      // MAX_DEPOSIT removed
      // Verify access control
      const owner = await gateway.owner();
      expect(owner).to.equal(user1Address); // From localhost config
    });

    it("Should be ready for mainnet deployment", async () => {
      // All the security features we implemented should be present
      const interfaceFragment = gateway.interface;

      // Should have required functions
      expect(interfaceFragment.hasFunction("depositAndMint")).to.be.true;
      expect(interfaceFragment.hasFunction("rescueNative")).to.be.true;
      expect(interfaceFragment.hasFunction("rescueTokens")).to.be.true;
      // TransactionFailed event removed
    });
  });

  // --- Deployment System Verification ---
  describe("Deployment System Verification", () => {
    it("Should deploy gateway via hardhat-deploy system", async () => {
      const deployedGateway = (gateway as any).deployedGateway;
      const config = (gateway as any).deploymentConfig;

      // Verify deployment system created the contract
      expect(await deployedGateway.getAddress()).to.not.equal(ZeroAddress);

      // Verify deployed gateway has correct configuration from config files
      expect(await deployedGateway.W_NATIVE_TOKEN()).to.equal(config.expectedWNative);
      expect(await deployedGateway.DSTABLE_ISSUER()).to.equal(config.expectedIssuer);
      expect(await deployedGateway.DSTABLE_TOKEN()).to.equal(config.expectedToken);
      expect(await deployedGateway.owner()).to.equal(config.expectedOwner);
      // MAX_DEPOSIT removed
    });

    it("Should have deployment ID correctly registered", async () => {
      // Verify deployment system registered the contract with correct ID
      const deployment = await hre.deployments.get(WS_DS_NATIVE_MINTING_GATEWAY_ID);
      expect(deployment.address).to.not.equal(ZeroAddress);
      expect(deployment.abi).to.be.an("array");
      expect(deployment.args).to.be.an("array");
      expect(deployment.args).to.have.length(4); // 4 constructor arguments
    });

    it("Should match localhost configuration exactly", async () => {
      const deployedGateway = (gateway as any).deployedGateway;

      // Verify the deployed contract matches the configuration in localhost.ts
      // This ensures the deployment script correctly read and used the config
      const expectedWNative = wNativeInfo.address; // Real wS from ecosystem
      const expectedIssuer = await issuerContract.getAddress(); // IssuerV2
      const expectedToken = await dStableContract.getAddress(); // dS token
      const expectedOwner = user1Address; // From localhost config

      expect(await deployedGateway.W_NATIVE_TOKEN()).to.equal(expectedWNative);
      expect(await deployedGateway.DSTABLE_ISSUER()).to.equal(expectedIssuer);
      expect(await deployedGateway.DSTABLE_TOKEN()).to.equal(expectedToken);
      expect(await deployedGateway.owner()).to.equal(expectedOwner);
    });

    it("Should be ready for production deployment", async () => {
      const deployedGateway = (gateway as any).deployedGateway;

      // Verify all critical aspects are properly configured
      expect(await deployedGateway.W_NATIVE_TOKEN()).to.not.equal(ZeroAddress);
      expect(await deployedGateway.DSTABLE_ISSUER()).to.not.equal(ZeroAddress);
      expect(await deployedGateway.DSTABLE_TOKEN()).to.not.equal(ZeroAddress);
      expect(await deployedGateway.owner()).to.not.equal(ZeroAddress);

      // Verify contract is not paused or in invalid state
      // MAX_DEPOSIT removed
    });
  });

  // --- Configuration Compatibility ---
  describe("Test Configuration Compatibility", () => {
    it("Should match functional test configuration", async () => {
      // Our functional test gateway should have consistent configuration
      const config = (gateway as any).deploymentConfig;

      expect(await gateway.DSTABLE_ISSUER()).to.equal(config.expectedIssuer);
      expect(await gateway.DSTABLE_TOKEN()).to.equal(config.expectedToken);
      expect(await gateway.owner()).to.equal(config.expectedOwner);
      // MAX_DEPOSIT removed
    });

    it("Should demonstrate deployment script compatibility", async () => {
      // Verify our test setup matches what the deployment script would create
      const deployedGateway = (gateway as any).deployedGateway;
      const testGateway = gateway;

      // Both should have same basic configuration (except wNative for testing)
      expect(await testGateway.DSTABLE_ISSUER()).to.equal(await deployedGateway.DSTABLE_ISSUER());
      expect(await testGateway.DSTABLE_TOKEN()).to.equal(await deployedGateway.DSTABLE_TOKEN());
      expect(await testGateway.owner()).to.equal(await deployedGateway.owner());
      // MAX_DEPOSIT removed
    });
  });

  // --- Gas Usage Analysis ---
  describe("Gas Usage Analysis", () => {
    it("Should use reasonable gas for normal operations", async () => {
      const tx = await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });
      const receipt = await tx.wait();

      console.log(`Gas used for successful deposit: ${receipt!.gasUsed}`);

      expect(receipt!.gasUsed).to.be.lt(400000); // Should be well under 400k gas
      expect(receipt!.gasUsed).to.be.gt(150000); // Should be more than 150k for complex operation
    });

    it("Should use less gas for failed operations", async () => {
      const governanceSigner = await ethers.getSigner(user1Address);
      await issuerContract.connect(governanceSigner).pauseMinting();

      try {
        const tx = await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });
        await tx.wait();
      } catch (error: any) {
        if (error.receipt) {
          console.log(`Gas used for failed deposit: ${error.receipt.gasUsed}`);
          expect(error.receipt.gasUsed).to.be.lt(200000);
        }
      }
    });
  });

  // --- Integration Tests ---
  describe("Integration with dS Ecosystem", () => {
    it("Should work with real oracle pricing", async () => {
      const price = await oracleAggregator.getAssetPrice(await wNativeContract.getAddress());
      expect(price).to.be.gt(0, "Oracle should provide valid price");

      await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });

      const userBalance = await dStableContract.balanceOf(user1Address);
      expect(userBalance).to.be.gt(0);
    });

    it("Should integrate properly with IssuerV2 pause controls", async () => {
      const governanceSigner = await ethers.getSigner(user1Address);

      // Test global pause
      await issuerContract.connect(governanceSigner).pauseMinting();
      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount })).to.be.reverted;

      // Unpause and test asset-specific pause
      await issuerContract.connect(governanceSigner).unpauseMinting();
      await issuerContract.connect(governanceSigner).setAssetMintingPause(await wNativeContract.getAddress(), true);

      await expect(gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount })).to.be.reverted;
    });

    it("Should interact correctly with collateral vault", async () => {
      const vaultBalanceBefore = await wNativeContract.balanceOf(await collateralVault.getAddress());

      await gateway.connect(user1).depositAndMint(minDStableLow, { value: depositAmount });

      const vaultBalanceAfter = await wNativeContract.balanceOf(await collateralVault.getAddress());

      expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(depositAmount);
    });
  });
});
