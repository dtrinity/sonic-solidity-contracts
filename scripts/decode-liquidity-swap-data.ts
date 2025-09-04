import { ethers, Interface } from "ethers";

/**
 * @title SwapLiquidityDataDecoder
 * @notice Comprehensive decoder for OdosLiquiditySwapAdapterV2 transaction data
 * @dev Supports decoding swapLiquidity function parameters and detailed Odos swap data
 */
export class SwapLiquidityDataDecoder {
    private swapLiquidityInterface: Interface;
    private odosRouterInterface: Interface;

    constructor() {
        // OdosLiquiditySwapAdapterV2.swapLiquidity function signature
        this.swapLiquidityInterface = new Interface([
            `function swapLiquidity(
                tuple(
                    address collateralAsset,
                    uint256 collateralAmountToSwap, 
                    address newCollateralAsset,
                    uint256 newCollateralAmount,
                    address user,
                    bool withFlashLoan,
                    bytes swapData,
                    uint256 allBalanceOffset
                ) liquiditySwapParams,
                tuple(
                    address aToken,
                    uint256 value,
                    uint256 deadline,
                    uint8 v,
                    bytes32 r,
                    bytes32 s
                ) collateralATokenPermit
            ) external`
        ]);

        // Comprehensive OdosRouterV2 interface for swap data decoding
        this.odosRouterInterface = new Interface([
            // Main swap functions
            `function swap(
                tuple(
                    address inputToken,
                    uint256 inputAmount,
                    address inputReceiver,
                    address outputToken,
                    uint256 outputQuote,
                    uint256 outputMin,
                    address outputReceiver
                ) tokenInfo,
                bytes pathDefinition,
                address executor,
                uint32 referralCode
            ) external payable returns (uint256)`,
            
            `function swapMulti(
                tuple(address tokenAddress, uint256 amountIn, address receiver)[] inputs,
                tuple(address tokenAddress, uint256 relativeValue, address receiver)[] outputs,
                uint256 valueOutMin,
                bytes pathDefinition,
                address executor,
                uint32 referralCode
            ) external payable returns (uint256[])`,

            `function swapPermit2(
                tuple(
                    address contractAddress,
                    uint256 nonce,
                    uint256 deadline,
                    bytes signature
                ) permit2,
                tuple(
                    address inputToken,
                    uint256 inputAmount,
                    address inputReceiver,
                    address outputToken,
                    uint256 outputQuote,
                    uint256 outputMin,
                    address outputReceiver
                ) tokenInfo,
                bytes pathDefinition,
                address executor,
                uint32 referralCode
            ) external returns (uint256)`,

            `function swapMultiPermit2(
                tuple(
                    address contractAddress,
                    uint256 nonce,
                    uint256 deadline,
                    bytes signature
                ) permit2,
                tuple(address tokenAddress, uint256 amountIn, address receiver)[] inputs,
                tuple(address tokenAddress, uint256 relativeValue, address receiver)[] outputs,
                uint256 valueOutMin,
                bytes pathDefinition,
                address executor,
                uint32 referralCode
            ) external payable returns (uint256[])`,

            `function swapRouterFunds(
                tuple(address tokenAddress, uint256 amountIn, address receiver)[] inputs,
                tuple(address tokenAddress, uint256 relativeValue, address receiver)[] outputs,
                uint256 valueOutMin,
                bytes pathDefinition,
                address executor
            ) external returns (uint256[])`,

            `function swapCompact() external payable returns (uint256)`
        ]);
    }

    /**
     * @notice Decode swapLiquidity transaction data
     * @param calldata The transaction input data
     * @returns Decoded parameters and swap data details
     */
    public decodeSwapLiquidity(calldata: string): any {
        try {
            const decoded = this.swapLiquidityInterface.parseTransaction({ data: calldata });
            if (!decoded) {
                throw new Error("Failed to decode swapLiquidity calldata");
            }

            const [liquiditySwapParams, collateralATokenPermit] = decoded.args;

            // Decode the inner swap data
            const swapDataDecoded = this.decodeSwapData(liquiditySwapParams.swapData);

            return {
                function: "swapLiquidity",
                liquiditySwapParams: {
                    collateralAsset: liquiditySwapParams.collateralAsset,
                    collateralAmountToSwap: liquiditySwapParams.collateralAmountToSwap,
                    newCollateralAsset: liquiditySwapParams.newCollateralAsset,
                    newCollateralAmount: liquiditySwapParams.newCollateralAmount,
                    user: liquiditySwapParams.user,
                    withFlashLoan: liquiditySwapParams.withFlashLoan,
                    swapData: liquiditySwapParams.swapData,
                    allBalanceOffset: liquiditySwapParams.allBalanceOffset,
                    swapDataDecoded: swapDataDecoded
                },
                collateralATokenPermit: {
                    aToken: collateralATokenPermit.aToken,
                    value: collateralATokenPermit.value,
                    deadline: collateralATokenPermit.deadline,
                    v: collateralATokenPermit.v,
                    r: collateralATokenPermit.r,
                    s: collateralATokenPermit.s
                }
            };
        } catch (error) {
            throw new Error(`Failed to decode swapLiquidity: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * @notice Auto-detect swap data type and decode appropriately
     * @param swapData The swap data bytes to decode
     * @returns Decoded swap data with type detection
     */
    public decodeSwapData(swapData: string): any {
        try {
            // First, try to decode as PTSwapDataV2 (for PT token swaps)
            const ptSwapData = this.tryDecodePTSwapData(swapData);
            if (ptSwapData) {
                return {
                    type: "PT_SWAP",
                    data: ptSwapData
                };
            }

            // If not PT data, try to decode as regular Odos calldata
            const odosCalldata = this.tryDecodeOdosCalldata(swapData);
            if (odosCalldata) {
                return {
                    type: "REGULAR_ODOS",
                    data: odosCalldata
                };
            }

            return {
                type: "UNKNOWN",
                raw: swapData,
                note: "Could not decode as PT swap data or Odos calldata"
            };
        } catch (error) {
            return {
                type: "ERROR",
                error: error instanceof Error ? error.message : String(error),
                raw: swapData
            };
        }
    }

    /**
     * @notice Try to decode swap data as PTSwapDataV2
     * @param swapData The swap data to decode
     * @returns Decoded PT swap data or null
     */
    public tryDecodePTSwapData(swapData: string): any | null {
        try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                ["tuple(bool isComposed, address underlyingAsset, bytes pendleCalldata, bytes odosCalldata)"],
                swapData
            );

            const [ptSwapDataStruct] = decoded;
            
            // Decode nested Odos calldata if present
            let odosCalldataDecoded = null;
            if (ptSwapDataStruct.odosCalldata && ptSwapDataStruct.odosCalldata !== "0x") {
                odosCalldataDecoded = this.tryDecodeOdosCalldata(ptSwapDataStruct.odosCalldata);
            }

            return {
                isComposed: ptSwapDataStruct.isComposed,
                underlyingAsset: ptSwapDataStruct.underlyingAsset,
                pendleCalldata: ptSwapDataStruct.pendleCalldata,
                odosCalldata: ptSwapDataStruct.odosCalldata,
                odosCalldataDecoded: odosCalldataDecoded
            };
        } catch {
            return null;
        }
    }

    /**
     * @notice Try to decode calldata using Odos router functions
     * @param calldata The calldata to decode
     * @returns Decoded Odos function call or null
     */
    public tryDecodeOdosCalldata(calldata: string): any | null {
        try {
            const decoded = this.odosRouterInterface.parseTransaction({ data: calldata });
            if (!decoded) return null;

            switch (decoded.name) {
                case "swap":
                    return this.parseOdosSwap(decoded.args);
                case "swapMulti":
                    return this.parseOdosSwapMulti(decoded.args);
                case "swapPermit2":
                    return this.parseOdosSwapPermit2(decoded.args);
                case "swapMultiPermit2":
                    return this.parseOdosSwapMultiPermit2(decoded.args);
                case "swapRouterFunds":
                    return this.parseOdosSwapRouterFunds(decoded.args);
                case "swapCompact":
                    return this.parseOdosCompact(calldata);
                default:
                    return {
                        function: decoded.name,
                        args: decoded.args,
                        note: "Function recognized but not specifically handled"
                    };
            }
        } catch {
            return null;
        }
    }

    private parseOdosSwap(args: any): any {
        const [tokenInfo, pathDefinition, executor, referralCode] = args;
        return {
            function: "swap",
            tokenInfo: {
                inputToken: tokenInfo.inputToken,
                inputAmount: tokenInfo.inputAmount,
                inputReceiver: tokenInfo.inputReceiver,
                outputToken: tokenInfo.outputToken,
                outputQuote: tokenInfo.outputQuote,
                outputMin: tokenInfo.outputMin,
                outputReceiver: tokenInfo.outputReceiver
            },
            pathDefinition,
            executor,
            referralCode
        };
    }

    private parseOdosSwapMulti(args: any): any {
        const [inputs, outputs, valueOutMin, pathDefinition, executor, referralCode] = args;
        return {
            function: "swapMulti",
            inputs: inputs.map((input: any) => ({
                tokenAddress: input.tokenAddress,
                amountIn: input.amountIn,
                receiver: input.receiver
            })),
            outputs: outputs.map((output: any) => ({
                tokenAddress: output.tokenAddress,
                relativeValue: output.relativeValue,
                receiver: output.receiver
            })),
            valueOutMin,
            pathDefinition,
            executor,
            referralCode
        };
    }

    private parseOdosSwapPermit2(args: any): any {
        const [permit2, tokenInfo, pathDefinition, executor, referralCode] = args;
        return {
            function: "swapPermit2",
            permit2: {
                contractAddress: permit2.contractAddress,
                nonce: permit2.nonce,
                deadline: permit2.deadline,
                signature: permit2.signature
            },
            tokenInfo: {
                inputToken: tokenInfo.inputToken,
                inputAmount: tokenInfo.inputAmount,
                inputReceiver: tokenInfo.inputReceiver,
                outputToken: tokenInfo.outputToken,
                outputQuote: tokenInfo.outputQuote,
                outputMin: tokenInfo.outputMin,
                outputReceiver: tokenInfo.outputReceiver
            },
            pathDefinition,
            executor,
            referralCode
        };
    }

    private parseOdosSwapMultiPermit2(args: any): any {
        const [permit2, inputs, outputs, valueOutMin, pathDefinition, executor, referralCode] = args;
        return {
            function: "swapMultiPermit2",
            permit2: {
                contractAddress: permit2.contractAddress,
                nonce: permit2.nonce,
                deadline: permit2.deadline,
                signature: permit2.signature
            },
            inputs: inputs.map((input: any) => ({
                tokenAddress: input.tokenAddress,
                amountIn: input.amountIn,
                receiver: input.receiver
            })),
            outputs: outputs.map((output: any) => ({
                tokenAddress: output.tokenAddress,
                relativeValue: output.relativeValue,
                receiver: output.receiver
            })),
            valueOutMin,
            pathDefinition,
            executor,
            referralCode
        };
    }

    private parseOdosSwapRouterFunds(args: any): any {
        const [inputs, outputs, valueOutMin, pathDefinition, executor] = args;
        return {
            function: "swapRouterFunds",
            inputs: inputs.map((input: any) => ({
                tokenAddress: input.tokenAddress,
                amountIn: input.amountIn,
                receiver: input.receiver
            })),
            outputs: outputs.map((output: any) => ({
                tokenAddress: output.tokenAddress,
                relativeValue: output.relativeValue,
                receiver: output.receiver
            })),
            valueOutMin,
            pathDefinition,
            executor
        };
    }

    /**
     * @notice Parse swapCompact calldata using assembly logic from OdosRouterV2
     * @param calldata The full calldata including function selector
     * @returns Decoded compact swap data
     */
    private parseOdosCompact(calldata: string): any {
        try {
            const compactData = this.decodeCompactSwapData(calldata);
            return {
                function: "swapCompact",
                ...compactData,
                note: "Compact swap data decoded based on OdosRouterV2 assembly logic"
            };
        } catch (error) {
            return {
                function: "swapCompact",
                error: error instanceof Error ? error.message : String(error),
                raw: calldata
            };
        }
    }

    /**
     * @notice Decode Odos compact swap data based on OdosRouterV2 assembly code
     * @param calldata The full calldata (including selector)
     * @param collateralAmountToSwap Expected input amount for verification
     * @returns Decoded compact swap data
     */
    public decodeCompactSwapData(calldata: string, collateralAmountToSwap?: bigint): any {
        const data = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
        
        // Remove function selector (first 4 bytes = 8 hex chars)
        const payload = data.slice(8);
        
        try {
            let pos = 0;

            // Parse input token address
            const [inputToken, newPos1] = this.parseCompactAddress(payload, pos);
            pos = newPos1;

            // Parse output token address  
            const [outputToken, newPos2] = this.parseCompactAddress(payload, pos);
            pos = newPos2;

            // Parse input amount
            let inputAmount = 0n;
            const inputAmountLength = parseInt(payload.slice(pos, pos + 2), 16);
            pos += 2;
            
            if (inputAmountLength > 0) {
                const inputAmountHex = payload.slice(pos, pos + inputAmountLength * 2);
                inputAmount = BigInt("0x" + inputAmountHex);
                pos += inputAmountLength * 2;
            }

            // Parse quoted output amount
            const quoteAmountLength = parseInt(payload.slice(pos, pos + 2), 16);
            pos += 2;
            const outputQuoteHex = payload.slice(pos, pos + quoteAmountLength * 2);
            const outputQuote = BigInt("0x" + outputQuoteHex);
            pos += quoteAmountLength * 2;

            // Parse slippage tolerance (3 bytes)
            const slippageHex = payload.slice(pos, pos + 6);
            const slippageTolerance = parseInt(slippageHex, 16);
            const outputMin = (outputQuote * BigInt(0xFFFFFF - slippageTolerance)) / BigInt(0xFFFFFF);
            pos += 6;

            // Parse executor address
            const [executor, newPos3] = this.parseCompactAddress(payload, pos);
            pos = newPos3;

            // Parse input receiver address
            const [inputReceiver, newPos4] = this.parseCompactAddress(payload, pos);
            pos = newPos4;

            // Parse output receiver address
            const [outputReceiver, newPos5] = this.parseCompactAddress(payload, pos);
            pos = newPos5;

            // Parse referral code (4 bytes)
            const referralCodeHex = payload.slice(pos, pos + 8);
            const referralCode = parseInt(referralCodeHex, 16);
            pos += 8;

            // Parse path definition length
            const pathDefinitionLengthMultiplier = parseInt(payload.slice(pos, pos + 2), 16);
            const pathDefinitionLength = pathDefinitionLengthMultiplier * 32;
            pos += 2;

            const pathDefinition = "0x" + payload.slice(pos, pos + pathDefinitionLength * 2);

            // Check if expected input amount matches what we found
            let inputAmountMatch = false;
            if (collateralAmountToSwap !== undefined) {
                inputAmountMatch = inputAmount === collateralAmountToSwap;
                
                // If no exact match, check if the amount appears anywhere in the calldata
                if (!inputAmountMatch) {
                    const expectedHex = collateralAmountToSwap.toString(16).padStart(64, '0');
                    inputAmountMatch = payload.toLowerCase().includes(expectedHex.toLowerCase());
                }
            }

            return {
                inputToken,
                inputAmount,
                inputReceiver: inputReceiver === "0x0000000000000000000000000000000000000000" ? executor : inputReceiver,
                outputToken,
                outputQuote,
                outputMin,
                outputReceiver: outputReceiver === "0x0000000000000000000000000000000000000000" ? "msg.sender" : outputReceiver,
                executor,
                referralCode,
                slippageTolerance,
                slippageToleranceBps: Math.round((slippageTolerance / 0xFFFFFF) * 10000),
                pathDefinition,
                pathDefinitionLength: pathDefinitionLength,
                inputAmountMatch: collateralAmountToSwap !== undefined ? inputAmountMatch : undefined,
                expectedInputAmount: collateralAmountToSwap
            };
        } catch (error) {
            throw new Error(`Failed to decode compact swap data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * @notice Parse compact address encoding
     * @param data The hex data
     * @param pos Current position
     * @returns [address, newPosition]
     */
    private parseCompactAddress(data: string, pos: number): [string, number] {
        const inputPos = parseInt(data.slice(pos, pos + 4), 16);
        
        switch (inputPos) {
            case 0x0000:
                // Null address special case
                return ["0x0000000000000000000000000000000000000000", pos + 4];
            case 0x0001:
                // Address encoded directly in calldata
                const addressHex = data.slice(pos + 4, pos + 44);
                const address = "0x" + addressHex;
                return [address, pos + 44];
            default:
                // Address from cached list (not supported in this decoder)
                return [`0x[CACHED_${inputPos - 2}]`, pos + 4];
        }
    }

    /**
     * @notice Get the swapLiquidity function selector
     * @returns The function selector for swapLiquidity
     */
    public getSwapLiquiditySelector(): string {
        const func = this.swapLiquidityInterface.getFunction("swapLiquidity");
        return func ? "0x" + func.selector.slice(2) : "";
    }

    /**
     * @notice Format decoded data for display
     * @param decodedData The decoded data object
     * @returns Formatted string representation
     */
    public formatDecodedData(decodedData: any): string {
        return JSON.stringify(decodedData, (key, value) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            if (key === 'deadline' && typeof value === 'string') {
                const deadlineNum = parseInt(value);
                if (deadlineNum > 0) {
                    const date = new Date(deadlineNum * 1000);
                    return `${value} (${date.toISOString()})`;
                }
            }
            return value;
        }, 2);
    }
}

/**
 * @title TransactionAnalyzer
 * @notice Fetch and analyze transactions from RPC
 */
export class TransactionAnalyzer {
    private provider: ethers.JsonRpcProvider;
    private decoder: SwapLiquidityDataDecoder;

    constructor(rpcUrl: string) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.decoder = new SwapLiquidityDataDecoder();
    }

    /**
     * @notice Analyze a transaction by hash
     * @param txHash The transaction hash
     * @returns Analysis results
     */
    public async analyzeTransaction(txHash: string): Promise<any> {
        try {
            const tx = await this.provider.getTransaction(txHash);
            if (!tx) {
                throw new Error("Transaction not found");
            }

            console.log(`\nAnalyzing transaction: ${txHash}`);
            console.log(`To: ${tx.to}`);
            console.log(`Data length: ${tx.data.length} characters`);

            // Check if this looks like a swapLiquidity call
            const swapLiquiditySelector = this.decoder.getSwapLiquiditySelector();
            
            if (tx.data.startsWith(swapLiquiditySelector)) {
                console.log("✓ Detected swapLiquidity function call");
                const decoded = this.decoder.decodeSwapLiquidity(tx.data);
                console.log("\nDecoded Data:");
                console.log(this.decoder.formatDecodedData(decoded));
                return decoded;
            } else {
                console.log("⚠ Not a swapLiquidity function call");
                console.log(`Expected selector: ${swapLiquiditySelector}`);
                console.log(`Actual selector: ${tx.data.slice(0, 10)}`);
                return { error: "Not a swapLiquidity transaction" };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error("Error analyzing transaction:", errorMsg);
            return { error: errorMsg };
        }
    }
}
