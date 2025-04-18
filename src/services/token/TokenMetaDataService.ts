// src/services/token/TokenMetadataService.ts

import { ethers } from 'ethers';
import { logger } from '../../utils/Logger';
import { Token, TokenCategory } from '../../types/TokenTypes';

// ABIs
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
];

/**
 * Service for loading and managing token metadata
 */
export class TokenMetadataService {
  private tokenCache: Map<string, Token> = new Map();
  private tokenCategories: Record<string, TokenCategory> = {};

  constructor(
    private provider: ethers.Provider,
    tokenCategories?: Record<string, TokenCategory>
  ) {
    if (tokenCategories) {
      this.tokenCategories = tokenCategories;
    }
    logger.info('TokenMetadataService initialized');
  }

  /**
   * Load token metadata from chain
   */
  public async loadToken(tokenAddress: string): Promise<Token> {
    tokenAddress = tokenAddress.toLowerCase();
    // Check cache first
    if (this.tokenCache.has(tokenAddress)) {
      return this.tokenCache.get(tokenAddress)!;
    }

    try {
      // Create token contract
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      // Load token data in parallel
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name().catch(() => '') // Name is optional
      ]);
      // Create token object
      const token: Token = {
        address: tokenAddress,
        symbol,
        decimals,
        category: this.getTokenCategory(tokenAddress)
      };
      // Cache token
      this.tokenCache.set(tokenAddress, token);
      logger.debug(`Loaded token metadata for ${symbol} (${tokenAddress})`);
      return token;
    } catch (error) {
      logger.error(`Error loading token metadata for ${tokenAddress}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to load token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Bulk load token metadata
   */
  public async loadTokens(tokenAddresses: string[]): Promise<Token[]> {
    const uniqueAddresses = [...new Set(tokenAddresses.map(addr => addr.toLowerCase()))];
    const tokens: Token[] = [];
    // Load tokens in batches to avoid rate limiting
    const batchSize = 20;
    for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
      const batch = uniqueAddresses.slice(i, i + batchSize);
      // Load batch in parallel
      const batchPromises = batch.map(address => this.loadToken(address).catch(error => {
        logger.warn(`Failed to load token ${address}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }));
      const batchResults = await Promise.all(batchPromises);
      // Filter out failed loads and add to result
      tokens.push(...batchResults.filter((token): token is Token => token !== null));
      // Add a small delay between batches
      if (i + batchSize < uniqueAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    logger.info(`Loaded metadata for ${tokens.length}/${uniqueAddresses.length} tokens`);
    return tokens;
  }

  /**
   * Update token category mapping
   */
  public updateTokenCategories(categories: Record<string, TokenCategory>): void {
    this.tokenCategories = { ...this.tokenCategories, ...categories };
  }

  /**
   * Get token category
   */
  private getTokenCategory(tokenAddress: string): TokenCategory {
    const address = tokenAddress.toLowerCase();
    // Check if token has an explicitly assigned category
    if (this.tokenCategories[address]) {
      return this.tokenCategories[address];
    }
    // Default to OTHER
    return TokenCategory.OTHER;
  }

  /**
   * Check if token is a stablecoin
   */
  public isStablecoin(tokenAddress: string): boolean {
    return this.getTokenCategory(tokenAddress) === TokenCategory.STABLECOIN;
  }

  /**
   * Check if token is a major token
   */
  public isMajorToken(tokenAddress: string): boolean {
    return this.getTokenCategory(tokenAddress) === TokenCategory.MAJOR;
  }

  /**
   * Get token by address
   */
  public getTokenByAddress(address: string): Token | undefined {
    return this.tokenCache.get(address.toLowerCase());
  }

  /**
   * Get token symbol
   */
  public getTokenSymbol(address: string): string {
    const token = this.getTokenByAddress(address);
    if (token) {
      return token.symbol;
    }
    // If token not found, return shortened address
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }

  /**
   * Clear token cache
   */
  public clearCache(): void {
    this.tokenCache.clear();
    logger.debug('Token metadata cache cleared');
  }
}
