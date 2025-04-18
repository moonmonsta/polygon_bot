// src/services/DEXService.ts

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { DEXQuote, ExecuteSwapOptions, DEXType, PathFindingOptions } from '../types/DEXTypes';
import { QuickswapService } from './dex/QuickswapService';
import { SushiswapService } from './dex/SushiswapService';
import { UniswapV3Service } from './dex/UniswapV3Service';
import { BaseDEXService } from './dex/BaseDEXService';

/**
 * Service for interacting with decentralized exchanges
 */
export class DEXService {
  private dexServices: Map<string, BaseDEXService> = new Map();

  constructor(
    private provider: ethers.Provider,
    quickswapRouterAddress?: string,
    sushiswapRouterAddress?: string,
    uniswapV3RouterAddress?: string,
    uniswapV3QuoterAddress?: string
  ) {
    // Initialize individual DEX services
    this.dexServices.set('quickswap', new QuickswapService(provider, quickswapRouterAddress));
    this.dexServices.set('sushiswap', new SushiswapService(provider, sushiswapRouterAddress));
    this.dexServices.set('uniswap_v3', new UniswapV3Service(provider, uniswapV3RouterAddress, uniswapV3QuoterAddress));
    
    logger.info('DEXService initialized with multiple DEX providers');
  }

  /**
   * Initialize DEX services (can be used for async initialization tasks)
   */
  public async initialize(): Promise<void> {
    logger.info('DEX services initialized');
  }

  // Methods to interact with DEXs
  public getAllDEXs(): BaseDEXService[] {
    return Array.from(this.dexServices.values());
  }

  public getDEX(name: string): BaseDEXService | undefined {
    return this.dexServices.get(name.toLowerCase());
  }

  public async getAllQuotes(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DEXQuote[]> {
    const quotes: DEXQuote[] = [];
    const promises: Promise<void>[] = [];

    for (const dex of this.dexServices.values()) {
      promises.push(
        dex.getQuote(tokenIn, tokenOut, amountIn)
          .then(quote => { quotes.push(quote); })
          .catch(error => { 
            logger.debug(`Failed to get quote from ${dex.name}: ${error instanceof Error ? error.message : String(error)}`);
          })
      );
    }

    await Promise.all(promises);
    return quotes;
  }

  public async getBestQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DEXQuote | null> {
    const quotes = await this.getAllQuotes(tokenIn, tokenOut, amountIn);
    
    if (quotes.length === 0) {
      return null;
    }

    // Find the quote with the most output tokens
    return quotes.reduce((best, current) => {
      return current.amountOut > best.amountOut ? current : best;
    }, quotes[0]);
  }

  public async getQuoteForPath(path: string[], amountIn: bigint, dexName?: string): Promise<DEXQuote | null> {
    if (path.length < 2) {
      throw new Error('Path must contain at least 2 tokens');
    }

    // If dex name specified, use that specific DEX
    if (dexName) {
      const dex = this.getDEX(dexName);
      if (!dex) {
        throw new Error(`DEX ${dexName} not found`);
      }
      return dex.getQuoteForPath(path, amountIn);
    }

    // Otherwise try all DEXs and find the best quote
    const quotes: DEXQuote[] = [];
    const promises: Promise<void>[] = [];

    for (const dex of this.dexServices.values()) {
      promises.push(
        dex.getQuoteForPath(path, amountIn)
          .then(quote => { quotes.push(quote); })
          .catch(error => { 
            logger.debug(`Failed to get path quote from ${dex.name}: ${error instanceof Error ? error.message : String(error)}`);
          })
      );
    }

    await Promise.all(promises);
    
    if (quotes.length === 0) {
      return null;
    }

    // Find the quote with the most output tokens
    return quotes.reduce((best, current) => {
      return current.amountOut > best.amountOut ? current : best;
    }, quotes[0]);
  }

  public async executeSwap(
    dexName: string,
    path: string[],
    amountIn: bigint,
    options: ExecuteSwapOptions,
    wallet: ethers.Wallet
  ): Promise<ethers.TransactionResponse> {
    const dex = this.getDEX(dexName);
    if (!dex) {
      throw new Error(`DEX ${dexName} not found`);
    }

    return dex.executeSwap(path, amountIn, options, wallet);
  }

  public async findOptimalPath(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    options: PathFindingOptions = {
      maxHops: 3,
      maxPaths: 5,
      prioritizeByLiquidity: true,
      timeout: 10000
    }
  ): Promise<{path: string[], dex: string, amountOut: bigint, amountIn: bigint} | null> {
    const startTime = Date.now();
    
    // Try direct path first
    const directQuote = await this.getBestQuote(tokenIn, tokenOut, amountIn);
    let bestQuote = directQuote;

    if (options.maxHops <= 1 || !options.maxHops) {
      return directQuote ? {
        path: directQuote.path,
        dex: directQuote.dex,
        amountOut: directQuote.amountOut,
        amountIn: directQuote.amountIn
      } : null;
    }

    // Get common intermediate tokens
    const commonTokens = await this.getCommonIntermediateTokens();
    
    // Try 2-hop paths
    for (const intermediateToken of commonTokens) {
      // Skip if timeout reached
      if (options.timeout && Date.now() - startTime > options.timeout) {
        logger.debug('Path finding timeout reached');
        break;
      }

      if (intermediateToken === tokenIn || intermediateToken === tokenOut) {
        continue;
      }

      // Try to find best DEX for each hop
      const firstHopQuote = await this.getBestQuote(tokenIn, intermediateToken, amountIn);
      if (!firstHopQuote) continue;

      const secondHopQuote = await this.getBestQuote(
        intermediateToken, 
        tokenOut, 
        firstHopQuote.amountOut
      );
      if (!secondHopQuote) continue;

      // If both hops are on the same DEX, check if multi-hop path is better
      if (firstHopQuote.dex === secondHopQuote.dex) {
        const dex = this.getDEX(firstHopQuote.dex);
        if (dex) {
          try {
            const multiHopQuote = await dex.getQuoteForPath(
              [tokenIn, intermediateToken, tokenOut],
              amountIn
            );
            
            if (multiHopQuote && (!bestQuote || multiHopQuote.amountOut > bestQuote.amountOut)) {
              bestQuote = multiHopQuote;
            }
          } catch (error) {
            logger.debug(`Failed to get multi-hop quote: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        // Different DEXs, so we'll need to simulate the two-hop swap manually
        // This is just a rough estimate since it doesn't account for slippage between hops
        if (!bestQuote || secondHopQuote.amountOut > bestQuote.amountOut) {
          // Create a custom quote combining both hops
          bestQuote = {
            dex: `${firstHopQuote.dex}+${secondHopQuote.dex}`,
            path: [tokenIn, intermediateToken, tokenOut],
            amountIn: amountIn,
            amountOut: secondHopQuote.amountOut,
            gasEstimate: firstHopQuote.gasEstimate + secondHopQuote.gasEstimate
          };
        }
      }
    }

    // Try 3-hop paths if requested and time permits
    if (options.maxHops >= 3 && (!options.timeout || Date.now() - startTime <= options.timeout)) {
      // Implementation for 3-hop paths would go here
      // This becomes significantly more complex and computationally expensive
      logger.debug('3-hop path finding not fully implemented in this version');
    }

    if (!bestQuote) {
      return null;
    }

    return {
      path: bestQuote.path,
      dex: bestQuote.dex,
      amountOut: bestQuote.amountOut,
      amountIn: bestQuote.amountIn
    };
  }

  // Helper method to get common intermediate tokens used for multi-hop swaps
  private async getCommonIntermediateTokens(): Promise<string[]> {
    // This would typically return tokens with high liquidity across DEXs
    return [
      '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
      '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
      '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'  // DAI
    ];
  }
}
