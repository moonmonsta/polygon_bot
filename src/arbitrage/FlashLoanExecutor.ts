// src/arbitrage/FlashLoanExecutor.ts

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { DEXService } from '../services/DEXService';
import { ArbitrageStrategy } from '../types/ArbitrageTypes';
import { FlashLoanProtocol } from '../types/ArbitrageTypes';

// ABIs for flash loan contracts
const FLASH_LOAN_ABI = [
  "function executeFlashLoan(address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, bytes calldata params) external",
  "function executeBalancerFlashLoan(address[] calldata tokens, uint256[] calldata amounts, bytes calldata userData) external",
  "function executeArbitrage(address token, uint256 amount, bytes calldata params, bytes32 strategyHash) external"
];

/**
 * Executor for flash loan arbitrage operations
 */
export class FlashLoanExecutor {
  private flashLoanContract: ethers.Contract;
  private gasLimit: number = 2000000;

  // Statistics tracking
  private executedStrategies: number = 0;
  private successfulExecutions: number = 0;
  private failedExecutions: number = 0;
  private totalGasUsed: bigint = BigInt(0);
  private totalProfitUsd: number = 0;

  constructor(
    private readonly flashLoanAddress: string,
    private readonly wallet: ethers.Wallet,
    private readonly provider: ethers.Provider,
    private readonly dexService: DEXService,
    private readonly protocol: FlashLoanProtocol = FlashLoanProtocol.AAVE
  ) {
    this.flashLoanContract = new ethers.Contract(
      this.flashLoanAddress,
      FLASH_LOAN_ABI,
      this.wallet
    );
    logger.info(`FlashLoanExecutor initialized with protocol: ${protocol}`);
  }

  /**
   * Execute arbitrage using flash loan
   */
  public async executeArbitrage(
    strategy: ArbitrageStrategy,
    params: string
  ): Promise<ethers.TransactionResponse> {
    this.validateStrategy(strategy);
    this.executedStrategies++;

    try {
      let tx;
      switch (this.protocol) {
        case FlashLoanProtocol.AAVE:
          tx = await this.executeAaveFlashLoan(strategy, params);
          break;
        case FlashLoanProtocol.BALANCER:
          tx = await this.executeBalancerFlashLoan(strategy, params);
          break;
        case FlashLoanProtocol.CUSTOM:
          tx = await this.executeCustomFlashLoan(strategy, params);
          break;
        default:
          throw new Error(`Unsupported flash loan protocol: ${this.protocol}`);
      }

      this.successfulExecutions++;
      this.totalProfitUsd += strategy.profitUsd;

      // Log transaction information
      logger.info(`Executed arbitrage for pair ${strategy.pair} with expected profit of $${strategy.profitUsd}`);

      return tx;
    } catch (error) {
      this.failedExecutions++;
      logger.error(`Error executing flash loan: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Flash loan execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate arbitrage strategy
   */
  private validateStrategy(strategy: ArbitrageStrategy): void {
    if (!strategy.baseToken || !strategy.baseToken.address) {
      throw new Error('Strategy missing base token information');
    }

    if (!strategy.flashLoanAmount || strategy.flashLoanAmount <= BigInt(0)) {
      throw new Error('Invalid flash loan amount');
    }

    if (!strategy.path1 || !strategy.path2 || strategy.path1.length < 2 || strategy.path2.length < 2) {
      throw new Error('Invalid arbitrage paths');
    }

    if (!strategy.strategyHash) {
      throw new Error('Missing strategy hash identifier');
    }
  }

  /**
   * Execute flash loan using Aave protocol
   */
  private async executeAaveFlashLoan(
    strategy: ArbitrageStrategy,
    params: string
  ): Promise<ethers.TransactionResponse> {
    try {
      // Prepare flash loan parameters
      const assets = [strategy.baseToken.address];
      const amounts = [strategy.flashLoanAmount];
      const modes = [0]; // No debt, repay in same transaction

      const tx = await this.flashLoanContract.executeFlashLoan(
        assets,
        amounts,
        modes,
        params,
        {
          gasLimit: this.gasLimit
        }
      );

      logger.info(`Aave flash loan arbitrage executed: ${tx.hash}`);
      return tx;
    } catch (error) {
      logger.error(`Error executing Aave flash loan: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Aave flash loan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute flash loan using Balancer protocol
   */
  private async executeBalancerFlashLoan(
    strategy: ArbitrageStrategy,
    params: string
  ): Promise<ethers.TransactionResponse> {
    try {
      // Prepare flash loan parameters
      const tokens = [strategy.baseToken.address];
      const amounts = [strategy.flashLoanAmount];

      const tx = await this.flashLoanContract.executeBalancerFlashLoan(
        tokens,
        amounts,
        params,
        {
          gasLimit: this.gasLimit
        }
      );

      logger.info(`Balancer flash loan arbitrage executed: ${tx.hash}`);
      return tx;
    } catch (error) {
      logger.error(`Error executing Balancer flash loan: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Balancer flash loan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute flash loan using custom protocol
   */
  private async executeCustomFlashLoan(
    strategy: ArbitrageStrategy,
    params: string
  ): Promise<ethers.TransactionResponse> {
    try {
      const tx = await this.flashLoanContract.executeArbitrage(
        strategy.baseToken.address,
        strategy.flashLoanAmount,
        params,
        strategy.strategyHash,
        {
          gasLimit: this.gasLimit
        }
      );

      logger.info(`Custom flash loan arbitrage executed: ${tx.hash}`);
      return tx;
    } catch (error) {
      logger.error(`Error executing custom flash loan: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Custom flash loan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Calculate and encode swap parameters for DEX
   */
  public async calculateSwapParams(
    strategy: ArbitrageStrategy
  ): Promise<string> {
    // Get the best routes for both paths using the dexService
    const path1Quote = await this.dexService.getQuoteForPath(strategy.path1, strategy.amountIn);
    const path2Quote = path1Quote ?
      await this.dexService.getQuoteForPath(strategy.path2, path1Quote.amountOut) :
      null;

    if (!path1Quote || !path2Quote) {
      throw new Error('Failed to get quotes for arbitrage paths');
    }

    // Calculate min amount out with slippage protection
    const minAmountOut = strategy.minAmountOut;

    // Calculate deadline (5 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 300;

    // Encode parameters for flash loan
    return ethers.AbiCoder.defaultAbiCoder.encode(
      ['address[]', 'address[]', 'uint256', 'uint256', 'bytes32'],
      [strategy.path1, strategy.path2, minAmountOut, deadline, strategy.strategyHash]
    );
  }

  /**
   * Get statistics about flash loan executions
   */
  public getStatistics(): object {
    return {
      executedStrategies: this.executedStrategies,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      successRate: this.executedStrategies > 0
        ? (this.successfulExecutions / this.executedStrategies) * 100
        : 0,
      totalProfitUsd: this.totalProfitUsd,
      averageProfitUsd: this.successfulExecutions > 0
        ? this.totalProfitUsd / this.successfulExecutions
        : 0
    };
  }

  /**
   * Get gas estimate for flash loan execution
   */
  public getGasEstimate(): bigint {
    return BigInt(this.gasLimit);
  }

  /**
   * Set gas limit for flash loan executions
   */
  public setGasLimit(limit: number): void {
    this.gasLimit = limit;
    logger.debug(`Flash loan gas limit set to ${limit}`);
  }
}
