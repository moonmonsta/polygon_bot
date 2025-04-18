// src/services/dex/BaseDEXService.ts

import { ethers } from 'ethers';
import { DEXQuote, ExecuteSwapOptions, DEXType } from '../types/DEXTypes';
import { logger } from '../../utils/Logger';

/**
 * Base class for DEX services
 */
export abstract class BaseDEXService {
  abstract name: string;
  abstract type: DEXType;

  constructor(
    protected readonly provider: ethers.Provider,
    public readonly routerAddress: string
  ) {}

  /**
   * Get quote for token swap
   */
  public abstract getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DEXQuote>;

  /**
   * Get quote for multi-hop path
   */
  public abstract getQuoteForPath(
    path: string[],
    amountIn: bigint
  ): Promise<DEXQuote>;

  /**
   * Execute token swap
   */
  public abstract executeSwap(
    path: string[],
    amountIn: bigint,
    options: ExecuteSwapOptions,
    wallet: ethers.Wallet
  ): Promise<ethers.TransactionResponse>;

  /**
   * Get all supported DEXs
   */
  public getAllDEXs(): BaseDEXService[] {
    return [this]; // Override in composite services
  }

  protected handleError(error: unknown, operation: string): never {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`DEX Error (${this.name}): ${operation} - ${message}`);
    throw new Error(`${this.name} ${operation} failed: ${message}`);
  }
}
