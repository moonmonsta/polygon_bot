// src/services/TokenService.ts

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { Token, TokenCategory, TokenBalance, TokenPair } from '../types/TokenTypes';
import { TokenMetadataService } from './token/TokenMetadataService';
import { TokenPriceService } from './token/TokenPriceService';

/**
 * Service for managing tokens, combining metadata and pricing
 */
export class TokenService {
  private tokenMetadataService: TokenMetadataService;
  private tokenPriceService: TokenPriceService;

  constructor(
    private provider: ethers.Provider,
    tokenCategories: Record<string, TokenCategory> = {}
  ) {
    this.tokenMetadataService = new TokenMetadataService(provider, tokenCategories);
    this.tokenPriceService = new TokenPriceService(provider);
    logger.info('TokenService initialized');
  }

  /**
   * Load token data including price
   */
  public async loadToken(tokenAddress: string): Promise<Token> {
    const token = await this.tokenMetadataService.loadToken(tokenAddress);
    token.priceUsd = await this.tokenPriceService.getTokenPrice(tokenAddress);
    return token;
  }

  /**
   * Load multiple tokens
   */
  public async loadTokens(tokenAddresses: string[]): Promise<Token[]> {
    // First load token metadata
    const tokens = await this.tokenMetadataService.loadTokens(tokenAddresses);

    // Then enrich with price data
    const addresses = tokens.map(token => token.address);
    const prices = await this.tokenPriceService.getTokenPrices(addresses);

    // Update price information
    return tokens.map(token => {
      token.priceUsd = prices[token.address.toLowerCase()] || 0;
      return token;
    });
  }

  /**
   * Preload common token pairs
   */
  public async preloadCommonPairs(tokenPairs: TokenPair[]): Promise<void> {
    // Extract unique token addresses from the pairs
    const tokenAddresses = new Set<string>();
    for (const pair of tokenPairs) {
      tokenAddresses.add(pair.baseToken);
      tokenAddresses.add(pair.quoteToken);
    }

    // Load all tokens
    await this.loadTokens(Array.from(tokenAddresses));

    logger.info(`Preloaded ${tokenPairs.length} token pairs`);
  }

  /**
   * Get token balance for address
   */
  public async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<TokenBalance> {
    const token = await this.loadToken(tokenAddress);

    // Create token contract
    const abi = [
      "function balanceOf(address owner) view returns (uint256)"
    ];
    const tokenContract = new ethers.Contract(tokenAddress, abi, this.provider);

    // Get balance
    const balance = await tokenContract.balanceOf(walletAddress);
    const balanceUsd = token.priceUsd ?
      parseFloat(ethers.formatUnits(balance, token.decimals)) * token.priceUsd :
      undefined;

    return {
      token,
      balance,
      balanceUsd
    };
  }

  /**
   * Get multiple token balances
   */
  public async getTokenBalances(tokenAddresses: string[], walletAddress: string): Promise<TokenBalance[]> {
    const promises = tokenAddresses.map(address =>
      this.getTokenBalance(address, walletAddress).catch(error => {
        logger.warn(`Failed to get balance for token ${address}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      })
    );

    const results = await Promise.all(promises);
    return results.filter((balance): balance is TokenBalance => balance !== null);
  }

  /**
   * Get token by address
   */
  public getTokenByAddress(address: string): Token | undefined {
    return this.tokenMetadataService.getTokenByAddress(address);
  }

  /**
   * Check if token is a stablecoin
   */
  public isStablecoin(tokenAddress: string): boolean {
    return this.tokenMetadataService.isStablecoin(tokenAddress);
  }

  /**
   * Check if token is a major token
   */
  public isMajorToken(tokenAddress: string): boolean {
    return this.tokenMetadataService.isMajorToken(tokenAddress);
  }

  /**
   * Get token metadata service
   */
  public getMetadataService(): TokenMetadataService {
    return this.tokenMetadataService;
  }

  /**
   * Get token price service
   */
  public getPriceService(): TokenPriceService {
    return this.tokenPriceService;
  }

  /**
   * Get token symbol
   */
  public getTokenSymbol(address: string): string {
    return this.tokenMetadataService.getTokenSymbol(address);
  }

  /**
   * Update token categories
   */
  public updateTokenCategories(categories: Record<string, TokenCategory>): void {
    this.tokenMetadataService.updateTokenCategories(categories);
  }

  /**
   * Get the current token statistics
   */
  public getStatistics(): object {
    // Get token cache size from metadata service
    const cachedTokens = this.tokenMetadataService.getTokenByAddress ?
      Array.from(this.tokenMetadataService.getTokenByAddress).length :
      'N/A';

    return {
      cachedTokensCount: cachedTokens,
      priceSourcesAvailable: ['coingecko', 'defillama', 'hardcoded'],
      stablecoinsTracked: this.tokenPriceService.getStablecoinAddresses?.length || 'N/A'
    };
  }
}
