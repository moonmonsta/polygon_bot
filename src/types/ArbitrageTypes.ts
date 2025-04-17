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
  amountIn: ethers.BigNumber;
  quickswap: { forwardOut: ethers.BigNumber; reverseOut: ethers.BigNumber; };
  sushiswap: { forwardOut: ethers.BigNumber; reverseOut: ethers.BigNumber; };
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
  amountIn: ethers.BigNumber;
  flashLoanAmount: ethers.BigNumber;
  minAmountOut: ethers.BigNumber;
  estimatedProfit: ethers.BigNumber;
  profitPercentage: number;
  profitUsd: number;
  optimalPathScore: number;
  strategyHash: string;
  entropyFactor: number;
}
