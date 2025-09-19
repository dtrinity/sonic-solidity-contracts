import { expect } from "chai";
import { ethers } from "hardhat";
import {
  executeStateCheckedMutation,
  executeStateCheckedMutationBatch,
  executePermissionAwareMutation,
  ContractMutationFactory
} from "./state-checked-mutations";

describe("State-Checked Mutations Utility", function () {
  let mockContract: any;
  let mockTransaction: any;

  beforeEach(function () {
    // Mock transaction object
    mockTransaction = {
      hash: "0x1234567890abcdef",
      wait: async () => ({ status: 1 })
    };

    // Mock contract
    mockContract = {
      currentValue: "0x0000000000000000000000000000000000000000",
      hasPermission: true,
      setValue: async () => mockTransaction,
      getValue: async () => mockContract.currentValue,
      hasRole: async () => mockContract.hasPermission
    };
  });

  describe("executeStateCheckedMutation", function () {
    it("should skip mutation when state already matches", async function () {
      mockContract.currentValue = "targetValue";

      const result = await executeStateCheckedMutation({
        description: "Test mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "targetValue",
        executeMutation: () => mockContract.setValue("targetValue")
      });

      expect(result.executed).to.be.false;
      expect(result.skipReason).to.equal("State already matches expected value");
    });

    it("should execute mutation when state differs", async function () {
      mockContract.currentValue = "currentValue";

      const result = await executeStateCheckedMutation({
        description: "Test mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "targetValue",
        executeMutation: () => mockContract.setValue("targetValue")
      });

      expect(result.executed).to.be.true;
      expect(result.transaction).to.equal(mockTransaction);
    });

    it("should handle address comparison case-insensitively", async function () {
      mockContract.currentValue = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";

      const result = await executeStateCheckedMutation({
        description: "Test address mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "0xabcdef0123456789abcdef0123456789abcdef01",
        executeMutation: () => mockContract.setValue("0xabcdef0123456789abcdef0123456789abcdef01")
      });

      expect(result.executed).to.be.false; // Should skip because addresses match
    });

    it("should handle BigInt comparison correctly", async function () {
      mockContract.currentValue = 1000n;

      const result = await executeStateCheckedMutation({
        description: "Test BigInt mutation",
        getCurrentState: () => Promise.resolve(mockContract.currentValue),
        expectedState: 1000,
        executeMutation: () => mockContract.setValue(1000)
      });

      expect(result.executed).to.be.false; // Should skip because values match when converted to string
    });
  });

  describe("executeStateCheckedMutationBatch", function () {
    it("should execute multiple mutations", async function () {
      const mutations = [
        {
          description: "Mutation 1",
          getCurrentState: () => Promise.resolve("current1"),
          expectedState: "target1",
          executeMutation: () => mockContract.setValue("target1")
        },
        {
          description: "Mutation 2",
          getCurrentState: () => Promise.resolve("target2"), // Already matches
          expectedState: "target2",
          executeMutation: () => mockContract.setValue("target2")
        }
      ];

      const results = await executeStateCheckedMutationBatch(mutations);

      expect(results).to.have.length(2);
      expect(results[0].executed).to.be.true;
      expect(results[1].executed).to.be.false;
    });
  });

  describe("executePermissionAwareMutation", function () {
    it("should skip when state already matches", async function () {
      mockContract.currentValue = "targetValue";

      const result = await executePermissionAwareMutation({
        description: "Test permission-aware mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "targetValue",
        executeMutation: () => mockContract.setValue("targetValue"),
        hasPermission: () => mockContract.hasRole(),
        manualInstruction: "Manual instruction"
      });

      expect(result.executed).to.be.false;
      expect(result.skipReason).to.equal("State already matches expected value");
      expect(result.manualInstruction).to.be.undefined;
    });

    it("should provide manual instruction when permission is missing", async function () {
      mockContract.currentValue = "currentValue";
      mockContract.hasPermission = false;

      const result = await executePermissionAwareMutation({
        description: "Test permission-aware mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "targetValue",
        executeMutation: () => mockContract.setValue("targetValue"),
        hasPermission: () => mockContract.hasRole(),
        manualInstruction: "Manual instruction needed"
      });

      expect(result.executed).to.be.false;
      expect(result.skipReason).to.equal("Insufficient permissions");
      expect(result.manualInstruction).to.equal("Manual instruction needed");
    });

    it("should execute when permission is available and state differs", async function () {
      mockContract.currentValue = "currentValue";
      mockContract.hasPermission = true;

      const result = await executePermissionAwareMutation({
        description: "Test permission-aware mutation",
        getCurrentState: () => mockContract.getValue(),
        expectedState: "targetValue",
        executeMutation: () => mockContract.setValue("targetValue"),
        hasPermission: () => mockContract.hasRole(),
        manualInstruction: "Manual instruction"
      });

      expect(result.executed).to.be.true;
      expect(result.transaction).to.equal(mockTransaction);
    });
  });

  describe("ContractMutationFactory", function () {
    it("should create oracle mutation correctly", function () {
      const oracleAggregator = {
        assetOracles: async (asset: string) => "0x0000000000000000000000000000000000000000",
        setOracle: async () => mockTransaction
      };

      const mutation = ContractMutationFactory.setOracle(
        oracleAggregator,
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222"
      );

      expect(mutation.description).to.contain("Set oracle for asset");
      expect(mutation.expectedState).to.equal("0x2222222222222222222222222222222222222222");
    });

    it("should create address mutation correctly", function () {
      const contract = {
        getAddress: async () => "0x0000000000000000000000000000000000000000",
        setAddress: async () => mockTransaction
      };

      const mutation = ContractMutationFactory.setAddress(
        contract,
        "Test address setting",
        () => contract.getAddress(),
        (addr) => contract.setAddress(addr),
        "0x1111111111111111111111111111111111111111"
      );

      expect(mutation.description).to.equal("Test address setting");
      expect(mutation.expectedState).to.equal("0x1111111111111111111111111111111111111111");
    });

    it("should create role mutation correctly", function () {
      const contract = {
        hasRole: async () => false,
        grantRole: async () => mockTransaction
      };

      const mutation = ContractMutationFactory.grantRole(
        contract,
        "Grant admin role",
        "ADMIN_ROLE",
        "0x1111111111111111111111111111111111111111"
      );

      expect(mutation.description).to.equal("Grant admin role");
      expect(mutation.expectedState).to.be.true;
    });
  });
});