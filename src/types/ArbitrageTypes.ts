// src/types/ArbitrageTypes.ts (Update for BigNumber changes)
import { ethers } from 'ethers';

export interface Token {
  symbol: string;
  address: string;
  decimals: number;
  priceUsd?: number;
}

export interface TokenPair {
  name: string;
  baseToken: string;
  quoteToken: string;
  volatility?: number;
}

export interface DEXQuotes {
  pair: string;
  baseToken: Token;
  quoteToken: Token;
  amountIn: bigint; // Changed from ethers.BigNumber
  quickswap: { forwardOut: bigint; reverseOut: bigint; }; // Changed
  sushiswap: { forwardOut: bigint; reverseOut: bigint; }; // Changed
  entropyFactor: number;
  projectedProfit?: number; 
}

export interface ArbitrageStrategy {
  pair: string;
  baseToken: Token;
  quoteToken: Token;
  dex1: string;
  dex2: string;
  path1: string[];
  path2: string[];
  amountIn: bigint; // Changed from ethers.BigNumber
  flashLoanAmount: bigint; // Changed from ethers.BigNumber
  minAmountOut: bigint; // Changed from ethers.BigNumber
  estimatedProfit: bigint; // Changed from ethers.BigNumber
  profitPercentage: number;
  profitUsd: number;
  optimalPathScore: number;
  strategyHash: string;
  entropyFactor: number;
}