import { expect } from "chai";
import sinon from "sinon";
import { ethers } from "ethers";
import { QuotingService } from "../../typescript/bot/quoting";
import { Config } from "../../typescript/bot/config";

describe("QuotingService", function () {
    let quotingService: QuotingService;
    let mockConfig: Config;
    let mockProvider: ethers.JsonRpcProvider;
    let mockCoreContract: any;
    let mockRewardHelper: any;

    beforeEach(function () {
        // Create mocks
        mockConfig = {
            networks: {
                sonic_mainnet: {
                    coreAddress: ethers.Wallet.createRandom().address,
                    rewardHelperAddress: ethers.Wallet.createRandom().address,
                    dusdAddress: ethers.Wallet.createRandom().address,
                    collateralAddress: ethers.Wallet.createRandom().address,
                    flashLenderAddress: ethers.Wallet.createRandom().address,
                    odosRouterAddress: ethers.Wallet.createRandom().address
                }
            },
            constants: {
                SLIPPAGE_BPS: 50,
                MIN_PROFIT_BPS: 10,
                TREASURY_FEE_BPS: 500
            }
        } as any;

        mockProvider = new ethers.JsonRpcProvider();
        mockCoreContract = {
            exchangeThreshold: sinon.stub(),
            previewMint: sinon.stub(),
            maxDeposit: sinon.stub()
        };

        mockRewardHelper = {
            getUserAccruedRewards: sinon.stub(),
            getUserTotalRewards: sinon.stub()
        };

        quotingService = new QuotingService(mockConfig, mockProvider);
    });

    afterEach(function () {
        sinon.restore();
    });

    describe("getQuote", function () {
        it("should return profitable quote when conditions are met", async function () {
            // Setup mocks
            mockCoreContract.exchangeThreshold.resolves(ethers.parseEther("1"));
            mockCoreContract.previewMint.resolves(ethers.parseEther("300"));
            mockCoreContract.maxDeposit.resolves(ethers.parseEther("1000"));

            mockRewardHelper.getUserAccruedRewards.resolves(ethers.parseEther("110"));

            // Mock Odos API response
            const mockOdosQuote = {
                amountOut: ethers.parseEther("300"),
                maxInput: ethers.parseEther("295"),
                calldata: "0x123456"
            };

            // Mock external API call
            sinon.stub(quotingService as any, "getOdosQuote").resolves(mockOdosQuote);

            const quote = await (quotingService as any).getQuote();

            expect(quote).to.not.be.null;
            expect(quote!.isProfitable).to.be.true;
            expect(quote!.flashAmount).to.equal(ethers.parseEther("295"));
            expect(quote!.expectedCollateral).to.equal(ethers.parseEther("300"));
            expect(quote!.expectedProfit).to.be.gt(0);
        });

        it("should return unprofitable quote when profit is negative", async function () {
            // Setup mocks with high costs
            mockCoreContract.exchangeThreshold.resolves(ethers.parseEther("1"));
            mockCoreContract.previewMint.resolves(ethers.parseEther("300"));
            mockCoreContract.maxDeposit.resolves(ethers.parseEther("1000"));

            mockRewardHelper.getUserAccruedRewards.resolves(ethers.parseEther("10")); // Low rewards

            const mockOdosQuote = {
                amountOut: ethers.parseEther("300"),
                maxInput: ethers.parseEther("305"), // High input cost
                calldata: "0x123456"
            };

            sinon.stub(quotingService as any, "getOdosQuote").resolves(mockOdosQuote);

            const quote = await (quotingService as any).getQuote();

            expect(quote).to.not.be.null;
            expect(quote!.isProfitable).to.be.false;
            expect(quote!.expectedProfit).to.be.lte(0);
        });

        it("should return null when exchange threshold is zero", async function () {
            mockCoreContract.exchangeThreshold.resolves(ethers.parseEther("0"));

            const quote = await (quotingService as any).getQuote();

            expect(quote).to.be.null;
        });

        it("should handle Odos API failures gracefully", async function () {
            mockCoreContract.exchangeThreshold.resolves(ethers.parseEther("1"));
            mockCoreContract.previewMint.resolves(ethers.parseEther("300"));

            sinon.stub(quotingService as any, "getOdosQuote").rejects(new Error("API Error"));

            const quote = await (quotingService as any).getQuote();

            expect(quote).to.be.null;
        });
    });

    describe("calculateBreakEven", function () {
        it("should calculate correct break-even conditions", async function () {
            const S = ethers.parseEther("1");
            const requiredCollateral = ethers.parseEther("300");
            const netRewards = ethers.parseEther("104.5"); // After 5% treasury fee
            const flashFeeBps = 9;

            const result = await (quotingService as any).calculateBreakEven(S, requiredCollateral, netRewards, flashFeeBps);

            expect(result).to.not.be.null;
            expect(result!.isProfitable).to.be.true;
            expect(result!.flashAmount).to.be.gt(0);
            expect(result!.expectedProfit).to.be.gt(0);
        });

        it("should return unprofitable when rewards don't cover costs", async function () {
            const S = ethers.parseEther("1");
            const requiredCollateral = ethers.parseEther("300");
            const netRewards = ethers.parseEther("10"); // Low rewards
            const flashFeeBps = 9;

            const result = await (quotingService as any).calculateBreakEven(S, requiredCollateral, netRewards, flashFeeBps);

            expect(result).to.not.be.null;
            expect(result!.isProfitable).to.be.false;
        });
    });

    describe("getOdosQuote", function () {
        it("should construct correct API request", async function () {
            const requiredCollateral = ethers.parseEther("300");
            const maxInput = ethers.parseEther("295");

            // Mock fetch response
            const mockResponse = {
                amountOut: requiredCollateral.toString(),
                maxInput: maxInput.toString(),
                calldata: "0xabcdef"
            };

            const fetchStub = sinon.stub(global, "fetch").resolves({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            } as any);

            const result = await (quotingService as any).getOdosQuote(requiredCollateral, maxInput);

            expect(result).to.not.be.null;
            expect(result!.amountOut).to.equal(requiredCollateral);
            expect(result!.maxInput).to.equal(maxInput);

            expect(fetchStub.calledOnce).to.be.true;
            const callArgs = fetchStub.firstCall.args[1];
            expect(callArgs.method).to.equal("POST");
            expect(callArgs.headers["Content-Type"]).to.equal("application/json");

            fetchStub.restore();
        });

        it("should handle API errors", async function () {
            const fetchStub = sinon.stub(global, "fetch").resolves({
                ok: false,
                status: 500,
                statusText: "Internal Server Error"
            } as any);

            await expect(
                (quotingService as any).getOdosQuote(ethers.parseEther("300"), ethers.parseEther("295"))
            ).to.be.rejectedWith("Odos API error: 500 Internal Server Error");

            fetchStub.restore();
        });
    });
});
