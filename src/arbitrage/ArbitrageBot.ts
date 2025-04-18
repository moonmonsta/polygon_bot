// src/arbitrage/ArbitrageBot.ts

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { logger } from '../utils/Logger';
import { config } from '../config/Config';
import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { FlashLoanExecutor } from './FlashLoanExecutor';
import { OpportunityDetector } from './OpportunityDetector';
import { ArbitrageStrategy, FlashLoanProtocol } from '../types/ArbitrageTypes';
import { TokenPair } from '../types/TokenTypes';

export class ArbitrageBot extends EventEmitter {
  private tokenService: TokenService;
  private dexService: DEXService;
  private flashLoanExecutor: FlashLoanExecutor;
  private opportunityDetector: OpportunityDetector;
  private wallet: ethers.Wallet;
  private wsProvider: ethers.WebSocketProvider | null = null;
  private running: boolean = false;
  private detectionInterval: NodeJS.Timeout | null = null;
  private lastDetectionTime: number = 0;

  constructor(
    private readonly flashLoanAddress: string,
    private readonly privateKey: string,
    private readonly rpcUrl: string,
    private readonly wsRpcUrl?: string
  ) {
    super();
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, provider);

    // Initialize services with proper parameters
    this.tokenService = new TokenService(
      provider,
      config.TOKEN_CATEGORIES as Record<string, any> || {}
    );

    this.dexService = new DEXService(
      provider,
      config.QUICKSWAP_ROUTER,
      config.SUSHISWAP_ROUTER,
      config.UNISWAP_V3_ROUTER,
      config.UNISWAP_V3_QUOTER
    );

    this.opportunityDetector = new OpportunityDetector(
      this.dexService,
      this.tokenService,
      {
        minProfitPercentage: config.MIN_PROFIT_PERCENTAGE,
        minProfitUsd: config.MIN_PROFIT_USD,
        maxGasCostRatio: 0.5,
        slippageTolerance: config.SLIPPAGE_TOLERANCE,
        adaptiveBatchSize: true,
        flashLoanProtocol: config.FLASH_LOAN_PROTOCOL as FlashLoanProtocol || FlashLoanProtocol.AAVE
      }
    );

    this.flashLoanExecutor = new FlashLoanExecutor(
      this.flashLoanAddress,
      this.wallet,
      provider,
      this.dexService,  // Added missing DEXService parameter
      config.FLASH_LOAN_PROTOCOL as FlashLoanProtocol || FlashLoanProtocol.AAVE
    );
  }

  public async start(): Promise<void> {
    if (this.running) return;

    try {
      if (this.wsRpcUrl && config.USE_WEBSOCKET) {
        this.wsProvider = new ethers.WebSocketProvider(this.wsRpcUrl);
        this.wsProvider.on('block', (blockNumber: number) => {
          if (!this.isDetectionThrottled()) this.detectOpportunities();
        });
      }

      await this.preloadData();

      if (!this.wsProvider) {
        this.detectionInterval = setInterval(() => {
          if (!this.isDetectionThrottled()) this.detectOpportunities();
        }, config.DETECTION_INTERVAL || 15000);
      }

      this.running = true;
      logger.info('ArbitrageBot started');
    } catch (error) {
      logger.error(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async preloadData(): Promise<void> {
    await this.tokenService.loadTokens(config.TOKENS.map(t => t.address));
    await this.dexService.initialize();
    await this.tokenService.preloadCommonPairs(config.TOKEN_PAIRS);
  }

  private async detectOpportunities(): Promise<void> {
    this.lastDetectionTime = Date.now();
    try {
      const opportunities = await this.opportunityDetector.scanForOpportunities(config.TOKEN_PAIRS);
      if (opportunities.length > 0) {
        const best = opportunities.sort((a: ArbitrageStrategy, b: ArbitrageStrategy) =>
          b.profitUsd - a.profitUsd
        )[0];

        if (best.profitUsd >= config.MIN_PROFIT_USD) {
          await this.executeArbitrage(best);
        }
      }
    } catch (error) {
      logger.error(`Detection error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeArbitrage(strategy: ArbitrageStrategy): Promise<void> {
    try {
      const params = await this.encodeArbitrageParams(strategy);
      const tx = await this.flashLoanExecutor.executeArbitrage(strategy, params);
      logger.info(`Arbitrage executed: ${tx.hash}`);
    } catch (error) {
      logger.error(`Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async encodeArbitrageParams(strategy: ArbitrageStrategy): Promise<string> {
    const fullPath = [...strategy.path1, ...strategy.path2.slice(1)];
    const deadline = Math.floor(Date.now() / 1000) + 300;

    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['address[]', 'uint256', 'uint256', 'bytes32'],
      [fullPath, strategy.minAmountOut, deadline, strategy.strategyHash]
    );
  }

  private isDetectionThrottled(): boolean {
    return Date.now() - this.lastDetectionTime < (config.MIN_TIME_BETWEEN_DETECTIONS || 5000);
  }

  public stop(): void {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    if (this.wsProvider) this.wsProvider.removeAllListeners();
    this.running = false;
    logger.info('ArbitrageBot stopped');
  }
}
