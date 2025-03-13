import { expect } from "chai";
import hre, { getNamedAccounts } from "hardhat";
import { Address } from "hardhat-deploy/types";

import { API3Wrapper, MockAPI3OracleAlwaysAlive } from "../../typechain-types";
import {
  API3_HEARTBEAT_SECONDS,
  API3_PRICE_DECIMALS,
  USD_ORACLE_AGGREGATOR_PRICE_DECIMALS,
} from "../../typescript/oracle_aggregator/constants";
import { getTokenContractForSymbol } from "../../typescript/token/utils";
import { oracleAggregatorMinimalFixture } from "./fixtures";
import { API3_ORACLE_WRAPPER_ID } from "../../typescript/deploy-ids";

describe("API3Wrappers", () => {
  let api3WrapperContract: API3Wrapper;
  let mockAPI3OracleFrxUSDContract: MockAPI3OracleAlwaysAlive;
  let mockAPI3OracleSfrxUSDContract: MockAPI3OracleAlwaysAlive;
  let frxUSDAddress: string;
  let sfrxUSDAddress: string;
  let deployer: Address;
  let user1: Address;

  beforeEach(async function () {
    await oracleAggregatorMinimalFixture();

    ({ deployer, user1 } = await getNamedAccounts());

    // Get the API3Wrapper contract
    const { address: api3WrapperAddress } = await hre.deployments.get(
      API3_ORACLE_WRAPPER_ID
    );
    api3WrapperContract = await hre.ethers.getContractAt(
      "API3Wrapper",
      api3WrapperAddress,
      await hre.ethers.getSigner(deployer)
    );

    // Get token addresses
    const { tokenInfo: frxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "frxUSD"
    );
    const { tokenInfo: sfrxUSDInfo } = await getTokenContractForSymbol(
      hre,
      deployer,
      "sfrxUSD"
    );
    frxUSDAddress = frxUSDInfo.address;
    sfrxUSDAddress = sfrxUSDInfo.address;

    // Find the mock oracle deployments
    const mockOracleDeployments: Record<string, string> = {};
    const allDeployments = await hre.deployments.all();

    for (const [name, deployment] of Object.entries(allDeployments)) {
      if (name.startsWith("MockAPI3OracleAlwaysAlive_")) {
        const feedName = name.replace("MockAPI3OracleAlwaysAlive_", "");
        mockOracleDeployments[feedName] = deployment.address;
      }
    }

    // Set up proxies for testing
    const frxUSDOracleAddress = mockOracleDeployments["frxUSD_USD"];
    const sfrxUSDOracleAddress = mockOracleDeployments["sfrxUSD_frxUSD"];

    if (!frxUSDOracleAddress) {
      throw new Error("frxUSD_USD mock oracle not found");
    }

    if (!sfrxUSDOracleAddress) {
      throw new Error("sfrxUSD_frxUSD mock oracle not found");
    }

    // Set the proxies for the tokens we're testing
    await api3WrapperContract.setProxy(frxUSDAddress, frxUSDOracleAddress);
    await api3WrapperContract.setProxy(sfrxUSDAddress, sfrxUSDOracleAddress);

    // Get the mock oracle contracts for verification
    mockAPI3OracleFrxUSDContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      frxUSDOracleAddress,
      await hre.ethers.getSigner(deployer)
    );

    mockAPI3OracleSfrxUSDContract = await hre.ethers.getContractAt(
      "MockAPI3OracleAlwaysAlive",
      sfrxUSDOracleAddress,
      await hre.ethers.getSigner(deployer)
    );
  });

  describe("Getting asset prices", () => {
    describe("API3Wrapper", () => {
      it("should return expected prices for frxUSD and sfrxUSD", async function () {
        const expectedPriceFrxUSD = hre.ethers.parseUnits(
          "1",
          USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
        );

        const { price: actualPriceFrxUSD, isAlive: isAliveFrxUSD } =
          await api3WrapperContract.getPriceInfo(frxUSDAddress);

        expect(actualPriceFrxUSD).to.equal(expectedPriceFrxUSD);
        expect(isAliveFrxUSD).to.be.true;

        const expectedPriceSfrxUSD = hre.ethers.parseUnits(
          "1.1",
          USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
        );

        const { price: actualPriceSfrxUSD, isAlive: isAliveSfrxUSD } =
          await api3WrapperContract.getPriceInfo(sfrxUSDAddress);
        expect(actualPriceSfrxUSD).to.equal(expectedPriceSfrxUSD);
        expect(isAliveSfrxUSD).to.be.true;
      });

      it("should revert when getting price for non-existent asset", async function () {
        const nonExistentAsset = "0x1234567890123456789012345678901234567890";
        await expect(api3WrapperContract.getPriceInfo(nonExistentAsset))
          .to.be.revertedWithCustomError(api3WrapperContract, "ProxyNotSet")
          .withArgs(nonExistentAsset);
        await expect(api3WrapperContract.getAssetPrice(nonExistentAsset))
          .to.be.revertedWithCustomError(api3WrapperContract, "ProxyNotSet")
          .withArgs(nonExistentAsset);
      });

      it("should return false or revert when price is stale", async function () {
        // Create a mock oracle that can have stale prices
        const mockAPI3Oracle = await hre.deployments.deploy("MockAPI3Oracle", {
          from: deployer,
          args: ["0x0000000000000000000000000000000000000001"], // Dummy API3 server address
          contract: "MockAPI3Oracle",
          autoMine: true,
          log: false,
        });

        const mockAPI3OracleContract = await hre.ethers.getContractAt(
          "MockAPI3Oracle",
          mockAPI3Oracle.address,
          await hre.ethers.getSigner(deployer)
        );

        // Add a new asset with the stale-able mock oracle
        const newAsset = "0x1234567890123456789012345678901234567890";
        await api3WrapperContract.setProxy(newAsset, mockAPI3Oracle.address);

        // Set a stale price
        const price = hre.ethers.parseUnits("1", API3_PRICE_DECIMALS);
        const currentBlock = await hre.ethers.provider.getBlock("latest");
        if (!currentBlock) throw new Error("Failed to get current block");

        const staleTimestamp =
          currentBlock.timestamp - API3_HEARTBEAT_SECONDS * 2; // 2 days ago
        await mockAPI3OracleContract.setMock(price, staleTimestamp);

        // getPriceInfo should return false for isAlive
        const { isAlive } = await api3WrapperContract.getPriceInfo(newAsset);
        expect(isAlive).to.be.false;

        // getAssetPrice should revert
        await expect(
          api3WrapperContract.getAssetPrice(newAsset)
        ).to.be.revertedWithCustomError(api3WrapperContract, "PriceIsStale");
      });
    });
  });

  describe("Base currency and units", () => {
    describe("API3Wrapper", () => {
      it("should return correct BASE_CURRENCY", async function () {
        expect(await api3WrapperContract.BASE_CURRENCY()).to.equal(
          hre.ethers.ZeroAddress
        );
      });

      it("should return correct BASE_CURRENCY_UNIT", async function () {
        const expectedUnit = hre.ethers.parseUnits(
          "1",
          USD_ORACLE_AGGREGATOR_PRICE_DECIMALS
        );
        expect(await api3WrapperContract.BASE_CURRENCY_UNIT()).to.equal(
          expectedUnit
        );
      });
    });
  });

  describe("Role based access and management", () => {
    it("should allow setting proxy by ORACLE_MANAGER_ROLE", async function () {
      const newAsset = "0x1234567890123456789012345678901234567890";
      const proxy = "0x2345678901234567890123456789012345678901";

      await api3WrapperContract.setProxy(newAsset, proxy);

      expect(await api3WrapperContract.assetToProxy(newAsset)).to.equal(proxy);
    });

    it("should revert when non-ORACLE_MANAGER tries to set proxy", async function () {
      const unauthorizedSigner = await hre.ethers.getSigner(user1);
      const newAsset = "0x1234567890123456789012345678901234567890";
      const proxy = "0x2345678901234567890123456789012345678901";

      await expect(
        api3WrapperContract
          .connect(unauthorizedSigner)
          .setProxy(newAsset, proxy)
      )
        .to.be.revertedWithCustomError(
          api3WrapperContract,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(user1, await api3WrapperContract.ORACLE_MANAGER_ROLE());
    });
  });
});
