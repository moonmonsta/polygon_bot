// src/types/TokenTypes.ts

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  priceUsd?: number;
  category?: string;
}

export interface TokenPair {
  name: string;
  baseToken: string;
  quoteToken: string;
  volatility?: number;
}

export interface TokenBalance {
  token: Token;
  balance: bigint;
  balanceUsd?: number;
}

export interface TokenPrice {
  address: string;
  priceUsd: number;
  timestamp: number;
  source: string;
}

export enum TokenCategory {
  STABLECOIN = 'stablecoin',
  MAJOR = 'major',
  DEFI = 'defi',
  NFT_GAMING = 'nft_gaming',
  OTHER = 'other'
}
