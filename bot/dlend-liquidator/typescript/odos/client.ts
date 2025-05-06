import axios from "axios";
import { ethers } from "ethers";

import {
  AssembleRequest,
  AssembleResponse,
  QuoteRequest,
  QuoteResponse,
} from "./types";

export class OdosClient {
  /**
   * Create a new ODOS client instance
   *
   * @param baseUrl - Base URL for ODOS API
   * @param chainId - Optional chain ID to validate requests
   */
  constructor(
    private readonly baseUrl: string = "https://api.odos.xyz",
    private readonly chainId?: number,
  ) {}

  /**
   * Generate a quote for a swap through ODOS
   *
   * @param request Quote request parameters
   * @returns Quote response with pathId and output amounts
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // Validate chainId if provided
    if (this.chainId && request.chainId !== this.chainId) {
      throw new Error(
        `Chain ID mismatch. Expected ${this.chainId}, got ${request.chainId}`,
      );
    }

    try {
      const response = await axios.post<QuoteResponse>(
        `${this.baseUrl}/sor/quote/v2`,
        request,
        {
          headers: { "Content-Type": "application/json" },
        },
      );

      if (
        !response.data ||
        !response.data.pathId ||
        !response.data.outTokens ||
        !response.data.outAmounts
      ) {
        throw new Error(
          "Invalid response from ODOS API: Missing required fields",
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error("ODOS API Error:", error.response.data);
        throw new Error(
          `Quote failed: ${error.response.data.message || error.message}`,
        );
      }
      console.error("Unexpected error:", error);
      throw error;
    }
  }

  /**
   * Assemble a transaction for executing a swap
   *
   * @param request Assembly request parameters including pathId from quote
   * @returns Assembled transaction data ready for execution
   */
  async assembleTransaction(
    request: AssembleRequest,
  ): Promise<AssembleResponse> {
    try {
      const response = await axios.post<AssembleResponse>(
        `${this.baseUrl}/sor/assemble`,
        request,
        {
          headers: { "Content-Type": "application/json" },
        },
      );

      const data = response.data as any;

      // Safely check if simulation exists and is unsuccessful
      if (data?.simulation && !data.simulation.isSuccess) {
        const simulationError = data.simulation.simulationError;
        throw new Error(
          `Transaction simulation failed: ${simulationError?.type || "Unknown"} - ${simulationError?.errorMessage || "No error message"}`,
        );
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `Assembly failed: ${error.response.data.message || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Helper method to format token amounts according to decimals
   *
   * @param amount Amount in human readable format
   * @param decimals Token decimals
   * @returns Amount formatted as string in token base units
   */
  static formatTokenAmount(amount: string | number, decimals: number): string {
    // Convert scientific notation or decimal to a fixed number
    const num = Number(amount);

    if (isNaN(num)) {
      throw new Error("Invalid amount provided");
    }
    // Use toFixed to get precise decimal representation
    const fixedAmount = num.toFixed(decimals);
    return ethers.parseUnits(fixedAmount, decimals).toString();
  }

  /**
   * Helper method to parse token amounts from base units
   *
   * @param amount Amount in base units
   * @param decimals Token decimals
   * @returns Amount in human readable format
   */
  static parseTokenAmount(amount: string, decimals: number): string {
    return ethers.formatUnits(amount, decimals);
  }

  /**
   * Calculate input amount based on desired output amount using token prices
   *
   * @param outputAmount Desired output amount in human readable format
   * @param outputTokenAddress Output token address
   * @param inputTokenAddress Input token address
   * @param chainId Chain ID for the tokens
   * @param slippagePercentage Percentage to increase input amount by (e.g., 0.1 for 0.1% increase)
   * @returns Calculated input amount in human readable format
   */
  async calculateInputAmount(
    outputAmount: string,
    outputTokenAddress: string,
    inputTokenAddress: string,
    chainId: number,
    slippagePercentage: number,
  ): Promise<string> {
    // Validate chainId if client was initialized with one
    if (this.chainId && chainId !== this.chainId) {
      throw new Error(
        `Chain ID mismatch. Expected ${this.chainId}, got ${chainId}`,
      );
    }

    try {
      // Get prices for both tokens
      const [inputPrice, outputPrice] = await Promise.all([
        this.getTokenPrice(chainId, inputTokenAddress),
        this.getTokenPrice(chainId, outputTokenAddress),
      ]);

      // Calculate input amount based on price ratio
      const outputAmountInUsd = Number(outputAmount) * outputPrice;
      const baseInputAmount = outputAmountInUsd / inputPrice;

      // Apply slippage percentage (e.g., 0.1% = 0.001)
      const slippageMultiplier = 1 + slippagePercentage / 100;
      const inputAmount = (baseInputAmount * slippageMultiplier).toString();

      return inputAmount;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `Price calculation failed: ${error.response.data.message || error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Get token price from ODOS API
   *
   * @param chainId Chain ID for the token
   * @param tokenAddress Token address
   * @returns Token price in USD
   */
  private async getTokenPrice(
    chainId: number,
    tokenAddress: string,
  ): Promise<number> {
    try {
      const response = await axios.get<{
        deprecated: string;
        currencyId: string;
        price: number;
      }>(`${this.baseUrl}/pricing/token/${chainId}/${tokenAddress}`);

      if (typeof response.data.price !== "number") {
        throw new Error("Invalid price data received from API");
      }

      return response.data.price;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(
          `Failed to get token price: ${error.response.data.message || error.message}`,
        );
      }
      throw error;
    }
  }
}
