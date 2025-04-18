// src/types/DEXTypes.ts

export enum DEXType {
  STANDARD_AMM = 'standard_amm',
  UNISWAP_V3 = 'uniswap_v3'
}

export interface DEXQuote {
  dex: string;
  path: string[];
  amountIn: bigint;
  amountOut: bigint;
  gasEstimate: bigint;
}

export interface ExecuteSwapOptions {
  slippageTolerance: number;
  deadline: number;
  recipient?: string;
  gasLimit?: number;
  gasPriceGwei?: number;
}
