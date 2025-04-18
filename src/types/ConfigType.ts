// src/types/ConfigTypes.ts
import { DEXConfig } from './DEXTypes';
import { TokenPair } from './TokenTypes';
import { ArbitrageOptions } from './ArbitrageTypes';

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  wsRpcUrl?: string;
  nativeToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  blockTime: number;
}

export interface DetectionConfig {
  interval: number;
  minTimeBetweenDetections: number;
  maxPairsToUse: number;
  maxTokensToConsider: number;
  cycleLengths: number[];
  maxCycles: number;
  maxCyclesPerLength: number;
  maxProfitableCycles: number;
  progressInterval: number;
  testAmounts: string[];
  useBlockSubscription: boolean;
}

export interface GasConfig {
  maxGasPriceGwei: number;
  baseGasLimit: number;
  gasLimitPerStep: number;
  maxExecutionTimeMs: number;
  dynamicGasPricing: boolean;
}

export interface SecurityConfig {
  maxFlashLoanRatio: number;
  maxSlippagePercent: number;
  transactionTimeout: number;
  rateLimit: {
    maxExecutionsPerMinute: number;
    maxDetectionsPerMinute: number;
  };
  circuitBreakers: {
    consecutiveFailures: number;
    profitThreshold: number;
    gasPriceThreshold: number;
  };
}

export interface AppConfig {
  network: NetworkConfig;
  dexes: DEXConfig[];
  tokens: any[];
  tokenPairs: TokenPair[];
  detection: DetectionConfig;
  arbitrage: ArbitrageOptions;
  gas: GasConfig;
  security: SecurityConfig;
  performanceConfig: {
    cacheValidityPeriod: number;
    adaptiveBatchSize: boolean;
  };
}