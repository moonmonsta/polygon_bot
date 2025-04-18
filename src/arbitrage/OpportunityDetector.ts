// src/arbitrage/OpportunityDetector.ts

import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { TokenPair } from '../types/TokenTypes';
import { ArbitrageStrategy, ArbitrageOptions } from '../types/ArbitrageTypes';
import { logger } from '../utils/Logger';

export class OpportunityDetector {
  private detectionStats = {
    totalDetections: 0,
    successfulDetections: 0,
    failedDetections: 0,
    averageDetectionTimeMs: 0,
    totalOpportunities: 0
  };

  constructor(
    private readonly tokenService: TokenService,
    private readonly dexService: DEXService,
    private readonly options: ArbitrageOptions
  ) {
    logger.info('OpportunityDetector initialized');
  }

  /**
   * Scan for arbitrage opportunities across token pairs
   */
  public async scanForOpportunities(tokenPairs: TokenPair[]): Promise<ArbitrageStrategy[]> {
    const startTime = Date.now();
    this.detectionStats.totalDetections++;

    try {
      logger.debug(`Scanning ${tokenPairs.length} token pairs for arbitrage opportunities`);
      const strategies: ArbitrageStrategy[] = [];

      // Iterate through token pairs
      for (const pair of tokenPairs) {
        try {
          // Load token information
          const baseToken = await this.tokenService.loadToken(pair.baseToken);
          const quoteToken = await this.tokenService.loadToken(pair.quoteToken);

          // Get all DEXs
          const dexes = this.dexService.getAllDEXs();

          // Compare prices across DEXs to find arbitrage opportunities
          for (let i = 0; i < dexes.length; i++) {
            for (let j = i + 1; j < dexes.length; j++) {
              const dex1 = dexes[i];
              const dex2 = dexes[j];

              // Test amount (could be configurable)
              const testAmount = BigInt('1000000000000000000'); // 1 token with 18 decimals

              // Get quotes from both DEXs
              const quote1 = await dex1.getQuote(pair.baseToken, pair.quoteToken, testAmount);
              const quote2 = await dex2.getQuote(pair.baseToken, pair.quoteToken, testAmount);

              // Check reverse direction
              const reverseAmount = quote1.amountOut;
              const reverseQuote = await dex2.getQuote(pair.quoteToken, pair.baseToken, reverseAmount);

              // Calculate if profitable
              if (reverseQuote.amountOut > testAmount) {
                const profit = reverseQuote.amountOut - testAmount;
                const profitPercentage = Number(profit * BigInt(10000) / testAmount) / 100;

                // Calculate profit in USD
                const profitUsd = this.tokenService.isStablecoin(pair.baseToken) ?
                  Number(ethers.formatUnits(profit, baseToken.decimals)) :
                  Number(ethers.formatUnits(profit, baseToken.decimals)) * (baseToken.priceUsd || 0);

                // Check if meets minimum profit requirements
                if (profitPercentage >= this.options.minProfitPercentage &&
                    profitUsd >= this.options.minProfitUsd) {

                  // Create arbitrage strategy
                  const strategy: ArbitrageStrategy = {
                    pair: `${baseToken.symbol}-${quoteToken.symbol}`,
                    baseToken,
                    quoteToken,
                    dex1: dex1.name,
                    dex2: dex2.name,
                    path1: [pair.baseToken, pair.quoteToken],
                    path2: [pair.quoteToken, pair.baseToken],
                    amountIn: testAmount,
                    flashLoanAmount: testAmount,
                    minAmountOut: reverseQuote.amountOut * BigInt(10000 - this.options.slippageTolerance) / BigInt(10000),
                    estimatedProfit: profit,
                    profitPercentage,
                    profitUsd,
                    optimalPathScore: 1.0,
                    strategyHash: this.generateStrategyHash(dex1.name, dex2.name, pair.baseToken, pair.quoteToken),
                    entropyFactor: Math.random() // Random factor for diversification
                  };

                  strategies.push(strategy);
                }
              }
            }
          }
        } catch (error) {
          logger.warn(`Error scanning pair ${pair.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Update statistics
      const detectionTime = Date.now() - startTime;
      this.detectionStats.successfulDetections++;
      this.detectionStats.totalOpportunities += strategies.length;
      this.detectionStats.averageDetectionTimeMs =
        ((this.detectionStats.averageDetectionTimeMs * (this.detectionStats.totalDetections - 1)) +
        detectionTime) / this.detectionStats.totalDetections;

      return strategies;
    } catch (error) {
      this.detectionStats.failedDetections++;
      logger.error(`Error scanning for opportunities: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get detection statistics
   */
  public getDetectionStats(): object {
    return { ...this.detectionStats };
  }

  /**
   * Generate a unique hash for a strategy
   */
  private generateStrategyHash(dex1: string, dex2: string, baseToken: string, quoteToken: string): string {
    const data = `${dex1}-${dex2}-${baseToken}-${quoteToken}-${Date.now()}`;
    return ethers.id(data);
  }
}
