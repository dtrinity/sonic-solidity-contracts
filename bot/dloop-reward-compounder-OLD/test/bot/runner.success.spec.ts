import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "ethers";
import { RunnerService } from "../../typescript/bot/runner";
import { Config } from "../../typescript/bot/config";
import { QuotingService } from "../../typescript/bot/quoting";
import { PeripheryService } from "../../typescript/bot/periphery";
import { NotificationService } from "../../typescript/bot/notification";

describe("RunnerService - Success Cases", function () {
    let runner: RunnerService;
    let mockConfig: Config;
    let mockQuotingService: sinon.SinonStubbedInstance<QuotingService>;
    let mockPeripheryService: sinon.SinonStubbedInstance<PeripheryService>;
    let mockNotificationService: sinon.SinonStubbedInstance<NotificationService>;
    let clock: sinon.SinonFakeTimers;

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

        clock = sinon.useFakeTimers();
    });

    afterEach(function () {
        sinon.restore();
        clock.restore();
    });

    describe("runOnce", function () {
        it("should execute successful compounding cycle", async function () {
            // Setup profitable quote
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);

            // Setup successful transaction
            const mockTxResult = {
                hash: "0xabcdef123456",
                blockNumber: 12345,
                gasUsed: 250000n,
                effectiveGasPrice: 20000000000n
            };

            mockPeripheryService.executeCompounding.resolves(mockTxResult);

            // Execute
            await runner.runOnce();

            // Verify interactions
            expect(mockQuotingService.getQuote.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.calledWith(mockQuote)).to.be.true;
            expect(mockNotificationService.sendSuccessNotification.calledOnce).to.be.true;

            const notificationArgs = mockNotificationService.sendSuccessNotification.firstCall.args[0];
            expect(notificationArgs.hash).to.equal(mockTxResult.hash);
            expect(notificationArgs.profit).to.equal(mockQuote.expectedProfit);
            expect(notificationArgs.flashAmount).to.equal(mockQuote.flashAmount);
        });

        it("should skip execution when quote is not profitable", async function () {
            const mockQuote = {
                isProfitable: false,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("-1"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);

            await runner.runOnce();

            expect(mockQuotingService.getQuote.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.notCalled).to.be.true;
            expect(mockNotificationService.sendSuccessNotification.notCalled).to.be.true;
            expect(mockNotificationService.sendInfoNotification.calledOnce).to.be.true;
        });

        it("should handle null quote", async function () {
            mockQuotingService.getQuote.resolves(null);

            await runner.runOnce();

            expect(mockQuotingService.getQuote.calledOnce).to.be.true;
            expect(mockPeripheryService.executeCompounding.notCalled).to.be.true;
            expect(mockNotificationService.sendSuccessNotification.notCalled).to.be.true;
            expect(mockNotificationService.sendInfoNotification.calledOnce).to.be.true;
        });
    });

    describe("start", function () {
        it("should run periodic cycles successfully", async function () {
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

            // Start runner
            runner.start();

            // Advance time to trigger multiple cycles
            await clock.tick(1000);
            await clock.tick(1000);

            // Stop runner
            (runner as any).stop();

            expect(mockQuotingService.getQuote.called).to.be.true;
            expect(mockPeripheryService.executeCompounding.called).to.be.true;
        });

        it("should handle errors gracefully", async function () {
            mockQuotingService.getQuote.rejects(new Error("Network error"));

            runner.start();

            // Advance time
            await clock.tick(1000);

            // Stop runner
            (runner as any).stop();

            expect(mockNotificationService.sendErrorNotification.calledOnce).to.be.true;
        });
    });

    describe("gas price validation", function () {
        it("should skip execution when gas price is too high", async function () {
            const mockQuote = {
                isProfitable: true,
                flashAmount: ethers.parseEther("1000"),
                expectedCollateral: ethers.parseEther("300"),
                expectedProfit: ethers.parseEther("5"),
                swapCalldata: "0x123456",
                slippageBps: 50
            };

            mockQuotingService.getQuote.resolves(mockQuote);

            // Mock high gas price
            sinon.stub(ethers, "getDefaultProvider").returns({
                getFeeData: () => Promise.resolve({
                    gasPrice: ethers.parseUnits("200", "gwei") // Above MAX_GAS_PRICE_GWEI
                })
            } as any);

            await runner.runOnce();

            expect(mockPeripheryService.executeCompounding.notCalled).to.be.true;
            expect(mockNotificationService.sendInfoNotification.calledOnce).to.be.true;
        });

        it("should proceed when gas price is acceptable", async function () {
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

            // Mock acceptable gas price
            sinon.stub(ethers, "getDefaultProvider").returns({
                getFeeData: () => Promise.resolve({
                    gasPrice: ethers.parseUnits("50", "gwei") // Below MAX_GAS_PRICE_GWEI
                })
            } as any);

            await runner.runOnce();

            expect(mockPeripheryService.executeCompounding.calledOnce).to.be.true;
            expect(mockNotificationService.sendSuccessNotification.calledOnce).to.be.true;
        });
    });
});
