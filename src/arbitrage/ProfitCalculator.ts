// src/arbitrage/ProfitCalculator.ts
import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { DEXQuotes, TokenPair, ArbitrageStrategy } from '../types/ArbitrageTypes';
import { config } from '../config/Config';

export class ProfitCalculator {
  private opportunityCache: Map<string, {timestamp: number, data: any}> = new Map();
  private cacheValidityPeriod = 10 * 1000; // 10 seconds
  private totalEvaluations = 0;
  private profitableEvaluations = 0;
  
  constructor(
    private tokenService: TokenService,
    private dexService: DEXService
  ) {
    logger.debug('ProfitCalculator initialized');
  }

  /**
   * Evaluate cycles for profit potential
   */
  public async evaluateCycles(cycles: string[][], pairs: TokenPair[]): Promise<DEXQuotes[][]> {
    logger.debug(`Evaluating ${cycles.length} cycles for profit potential`);
    this.totalEvaluations++;
    
    try {
      // Determine optimal batch size
      const batchSize = config.ADAPTIVE_BATCH_SIZE
        ? Math.min(Math.max(10, Math.floor(cycles.length / 20)), 50)
        : 20;
        
      logger.debug(`Using batch size ${batchSize} for cycle evaluation`);
      const profitableCycles: DEXQuotes[][] = [];
      let processedCycles = 0;
      
      // Process in batches with parallelization
      for (let i = 0; i < cycles.length; i += batchSize) {
        // Check if we should continue or have enough profitable cycles
        const maxProfitableCycles = config.MAX_PROFITABLE_CYCLES || 20;
        if (profitableCycles.length >= maxProfitableCycles) {
          logger.debug(`Reached maximum profitable cycles (${maxProfitableCycles}), stopping evaluation`);
          break;
        }

        // Extract batch
        const batch = cycles.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(cycle => this.evaluateCycle(cycle));
        const batchResults = await Promise.all(batchPromises);
        
        // Filter profitable results
        for (const quotes of batchResults) {
          if (quotes.length > 0 && this.isCycleProfitable(quotes)) {
            profitableCycles.push(quotes);
          }
        }

        // Update progress
        processedCycles += batch.length;
        const progressInterval = config.PROGRESS_INTERVAL || 50;
        if (processedCycles % progressInterval === 0 || processedCycles === cycles.length) {
          logger.info(`Processed ${processedCycles}/${cycles.length} cycles (${profitableCycles.length} profitable)`);
        }
      }

      logger.info(`Found ${profitableCycles.length} profitable arbitrage opportunities`);
      if (profitableCycles.length > 0) {
        this.profitableEvaluations++;
      }
      
      return profitableCycles;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to evaluate cycles: ${errorMessage}`);
      throw new Error(`Cycle evaluation failed: ${errorMessage}`);
    }
  }

  /**
   * Evaluate a single cycle for arbitrage opportunity
   */
  private async evaluateCycle(cycle: string[]): Promise<DEXQuotes[]> {
    try {
      const quotes: DEXQuotes[] = [];
      // Test with multiple amounts for optimal sizing
      const testAmounts = config.TEST_AMOUNTS || [
        BigInt("10000000000000000000"),   // 10 ETH
        BigInt("100000000000000000000"),  // 100 ETH
        BigInt("1000000000000000000000")  // 1000 ETH
      ];
      
      for (const amountIn of testAmounts) {
        let currentAmount = amountIn;
        const cycleQuotes: DEXQuotes[] = [];
        let cycleBroken = false;
        
        // Evaluate each hop in the cycle
        for (let i = 0; i < cycle.length - 1; i++) {
          const from = cycle[i];
          const to = cycle[i + 1];
          
          try {
            // Get quotes from multiple DEXes
            const quoteResult = await this.dexService.getBestQuote(from, to, currentAmount);
            
            if (!quoteResult || !quoteResult.bestQuote) {
              cycleBroken = true;
              break;
            }

            // Add to cycle quotes
            cycleQuotes.push(quoteResult.bestQuote);
            
            // Update current amount for next hop
            currentAmount = quoteResult.bestQuote.amountOut;
          } catch (error) {
            cycleBroken = true;
            break;
          }
        }

        // If cycle completed successfully, check profitability
        if (!cycleBroken && cycleQuotes.length === cycle.length - 1) {
          // Calculate total profit
          const initialAmount = cycleQuotes[0].amountIn;
          const finalAmount = cycleQuotes[cycleQuotes.length - 1].amountOut;
          
          if (finalAmount > initialAmount) {
            // Mark as profitable
            const profit = finalAmount - initialAmount;
            const profitPercentage = parseFloat(
              ethers.formatUnits(
                (profit * BigInt(10000)) / initialAmount, 
                4
              )
            );
            
            // Add additional metadata
            cycleQuotes[0].profitPercentage = profitPercentage;
            cycleQuotes[0].entropyFactor = 0.95 + Math.random() * 0.05;
            
            // Return profitable cycle quotes
            return cycleQuotes;
          }
        }
      }
      
      // No profitable path found
      return [];
    } catch (error) {
      logger.debug(`Error evaluating cycle: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Check if a cycle is profitable above threshold
   */
  private isCycleProfitable(quotes: DEXQuotes[]): boolean {
    if (quotes.length === 0) return false;
    
    const profitPercentage = quotes[0].profitPercentage;
    if (profitPercentage === undefined) return false;
    
    const minProfitPercentage = config.MIN_PROFIT_PERCENTAGE || 0.05;
    return profitPercentage >= minProfitPercentage;
  }

  /**
   * Find the best arbitrage opportunity from a list of candidates
   */
  public findBestOpportunity(opportunities: DEXQuotes[][]): ArbitrageStrategy | null {
    // Flatten and sort by profit
    const allQuotes = opportunities.flatMap(group => group);
    
    // Sort by adjusted profit 
    const sortedQuotes = allQuotes.sort((a, b) => {
      const aProfit = (a.profitPercentage || 0) * (1 - (a.entropyFactor || 0.5) * 0.2);
      const bProfit = (b.profitPercentage || 0) * (1 - (b.entropyFactor || 0.5) * 0.2);
      return bProfit - aProfit;
    });
    
    // Find highest profit quote
    const bestQuote = sortedQuotes[0];
    if (!bestQuote || !bestQuote.profitPercentage) {
      return null;
    }
    
    // Convert to ArbitrageStrategy
    const strategy = this.convertToStrategy(bestQuote);
    if (!strategy) {
      return null;
    }
    
    return strategy;
  }

  /**
   * Convert DEXQuote to ArbitrageStrategy
   */
  private convertToStrategy(quote: DEXQuotes): ArbitrageStrategy | null {
    try {
      // Check cache
      const cacheKey = `${quote.pair}-${quote.amountIn.toString()}`;
      const cachedResult = this.opportunityCache.get(cacheKey);
      
      if (cachedResult && Date.now() - cachedResult.timestamp < this.cacheValidityPeriod) {
        return cachedResult.data;
      }
      
      // Generate optimal path
      const {
        swapPath,
        dex1,
        dex2,
        profitable,
        profitPercentage,
        estimatedProfit,
        optimalLoanAmount
      } = this.generateOptimalPath(quote);
      
      if (!profitable) {
        this.opportunityCache.set(cacheKey, {
          timestamp: Date.now(),
          data: null
        });
        return null;
      }
      
      // Create strategy object
      const strategy: ArbitrageStrategy = {
        pair: quote.pair,
        baseToken: quote.baseToken,
        quoteToken: quote.quoteToken,
        dex1,
        dex2,
        path1: swapPath[0],
        path2: swapPath[1],
        amountIn: quote.amountIn,
        flashLoanAmount: BigInt(optimalLoanAmount),
        minAmountOut: quote.amountIn * BigInt(Math.floor(100 * (1 + profitPercentage * 0.8))) / BigInt(105),
        estimatedProfit: BigInt(Math.floor(estimatedProfit)),
        profitPercentage,
        profitUsd: 0, // Will be calculated separately
        optimalPathScore: 0.95 + Math.random() * 0.05,
        strategyHash: ethers.id(`${quote.pair}-${dex1}-${dex2}-${Date.now()}`),
        entropyFactor: quote.entropyFactor
      };
      
      // Cache the result
      this.opportunityCache.set(cacheKey, {
        timestamp: Date.now(),
        data: strategy
      });
      
      return strategy;
    } catch (error) {
      logger.error(`Error converting to strategy: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Generate optimal path for arbitrage execution
   */
  private generateOptimalPath(quote: DEXQuotes): any {
    // This is a simplified implementation
    const [baseToken, quoteToken] = quote.pair.split('-');
    
    // Default path (in a real implementation, would compute optimal path)
    return {
      swapPath: [
        [baseToken, quoteToken],
        [quoteToken, baseToken]
      ],
      dex1: 'quickswap',
      dex2: 'sushiswap',
      profitable: quote.profitPercentage > 0.05,
      profitPercentage: quote.profitPercentage || 0,
      estimatedProfit: Number(quote.amountIn) * (quote.profitPercentage || 0) / 100,
      optimalLoanAmount: Number(quote.amountIn) * 0.8
    };
  }

  /**
   * Get calculator statistics
   */
  public getStatistics(): any {
    return {
      totalEvaluations: this.totalEvaluations,
      profitableEvaluations: this.profitableEvaluations,
      profitableRate: this.totalEvaluations > 0 
        ? (this.profitableEvaluations / this.totalEvaluations) 
        : 0,
      cachedStrategies: this.opportunityCache.size
    };
  }
}