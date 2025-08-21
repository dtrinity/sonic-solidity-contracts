import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "ethers";
import { RunnerService } from "../../typescript/bot/runner";
import { Config } from "../../typescript/bot/config";
import { QuotingService } from "../../typescript/bot/quoting";
import { PeripheryService } from "../../typescript/bot/periphery";
import { NotificationService } from "../../typescript/bot/notification";

describe("RunnerService - Failure Cases", function () {
    let runner: RunnerService;
    let mockConfig: Config;
    let mockQuotingService: sinon.SinonStubbedInstance<QuotingService>;
    let mockPeripheryService: sinon.SinonStubbedInstance<PeripheryService>;
    let mockNotificationService: sinon.SinonStubbedInstance<NotificationService>;

    beforeEach(function () {
        mockConfig = {
            constants: {
                POLLING_INTERVAL_MS: 1000,
                MAX_GAS_PRICE_GWEI: 100
            }
        } as any;

        mockQuotingService = sinon.createStubInstance(QuotingService);
        mockPeripheryService = sinon.createStubInstance(PeripheryService);
        mockNotificationService = sinon.createStubInstance(NotificationService);

        runner = new RunnerService(
            mockConfig,
            mockQuotingService,
            mockPeripheryService,
            mockNotificationService
        );
    });

    afterEach(function () {
        sinon.restore();
    });

    describe("transaction failures", function () {
        it("should handle transaction reverts", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.rejects(new Error("Transaction reverted: Insufficient collateral"));

            await runner.runOnce();

            expect(mockQuotingService.getQuote.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.calledOnce).to.be.true;
            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;

            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Insufficient collateral");
            expect(errorNotification.quote).to.equal(mockQuote);
        });

        it("should handle network errors", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.rejects(new Error("Network connection failed"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Network connection failed");
        });

        it("should handle gas estimation failures", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.rejects(new Error("Gas estimation failed"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Gas estimation failed");
        });

        it("should handle insufficient funds errors", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.rejects(new Error("Insufficient funds for gas"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Insufficient funds for gas");
        });
    });

    describe("quoting failures", function () {
        it("should handle Odos API failures", async function () {
            mockQuotingService.getQuote.rejects(new Error("Odos API timeout"));

            await runner.runOnce();

            expect(mockQuotingService.getQuote.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.notCalled).to.be.true;
            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
        });

        it("should handle contract call failures", async function () {
            mockQuotingService.getQuote.rejects(new Error("Contract call reverted"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Contract call reverted");
        });

        it("should handle provider connection issues", async function () {
            mockQuotingService.getQuote.rejects(new Error("Provider connection lost"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Provider connection lost");
        });
    });

    describe("notification failures", function () {
        it("should continue execution even if notifications fail", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.resolves({
                hash: "0xabcdef123456",
                blockNumber: 12345,
                gasUsed: 250000n,
                effectiveGasPrice: 20000000000n
            });

            // Make notification service fail
            mockNotificationService.sendSuccessNotification.rejects(new Error("Slack API error"));

            // Should not throw
            await expect(runner.runOnce()).to.not.be.rejected;

            // Transaction should still have been executed
            expect(mockPeripheryService.executeCompounding.calledOnce).to.be.true;
        });

        it("should handle Slack webhook failures", async function () {
            mockQuotingService.getQuote.rejects(new Error("Network error"));
            mockNotificationService.sendErrorNotification.rejects(new Error("Slack webhook failed"));

            // Should not throw despite notification failure
            await expect(runner.runOnce()).to.not.be.rejected;
        });
    });

    describe("recovery scenarios", function () {
        it("should recover from temporary network issues", async function () {
            // First call fails
            mockQuotingService.getQuote.onFirstCall().rejects(new Error("Temporary network error"));

            // Second call succeeds
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.onSecondCall().resolves(mockQuote);
            mockPeripheryService.executeCompounding.resolves({
                hash: "0xabcdef123456",
                blockNumber: 12345,
                gasUsed: 250000n,
                effectiveGasPrice: 20000000000n
            });

            // First run should fail
            await runner.runOnce();
            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;

            // Second run should succeed
            mockNotificationService.sendErrorNotification.resetHistory();
            await runner.runOnce();
            expect(mockNotificationService.sendSuccessNotification.calledOnce).to.be.true;
        });

        it("should handle flash loan liquidity issues", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.rejects(new Error("Flash loan unavailable"));

            await runner.runOnce();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
            const errorNotification = mockNotificationService.sendErrorNotification.firstCall.args[0];
            expect(errorNotification.error.message).to.include("Flash loan unavailable");
        });
    });

    describe("edge cases", function () {
        it("should handle very low profit scenarios", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("0.001"), // Very low profit
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);
            mockPeripheryService.executeCompounding.resolves({
                hash: "0xabcdef123456",
                blockNumber: 12345,
                gasUsed: 250000n,
                effectiveGasPrice: 20000000000n
            });

            await runner.runOnce();

            expect(mockPeripheryService.executeCompounding.calledOnce).to.be.true;
            expect(mockNotificationService.sendSuccessNotification.calledOnce).to.be.true;
        });

        it("should handle very high gas costs", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("1"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);

            // Mock extremely high gas price
            sinon.stub(ethers, "getDefaultProvider").returns({
                getFeeData: () => Promise.resolve({
                    gasPrice: ethers.parseUnits("1000", "gwei") // Very high
                })
            } as any);

            await runner.runOnce();

            expect(mockPeripheryService.executeCompounding.notCalled).to.be.true;
            expect(mockNotificationService.sendInfoNotification.calledOnce).to.be.true;
        });
    });
});
