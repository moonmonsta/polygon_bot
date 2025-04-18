// src/services/execution/TransactionService.ts

import { ethers } from 'ethers';
import { logger } from '../../utils/Logger';

/**
 * Service for managing transactions and gas optimization
 */
export class TransactionService {
  private pendingTransactions: Map<string, { 
    hash: string; 
    timestamp: number; 
    gasPriceGwei: number; 
    timeoutMs: number; 
    onTimeout?: () => void; 
  }> = new Map();
  private transactionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private gasPriceHistory: { timestamp: number; gasPriceGwei: number }[] = [];
  private gasPriceUpdateInterval: NodeJS.Timeout | null = null;

  constructor(
    private provider: ethers.Provider,
    private gasPriceUpdateFrequencyMs: number = 30000 // 30 seconds
  ) {
    // Start gas price monitoring
    this.startGasPriceMonitoring();
    logger.info('TransactionService initialized');
  }

  /**
   * Submit transaction with gas price optimization
   */
  public async submitTransaction(
    txRequest: ethers.TransactionRequest,
    maxGasPriceGwei: number,
    timeoutMs: number = 60000,
    onTimeout?: () => void
  ): Promise<ethers.TransactionResponse> {
    // Get optimal gas price
    const gasPriceGwei = await this.getOptimalGasPrice(maxGasPriceGwei);
    // Set gas price if not already set
    if (!txRequest.gasPrice) {
      txRequest.gasPrice = ethers.parseUnits(gasPriceGwei.toString(), 'gwei');
    }

    // Submit transaction
    const tx = await this.provider.broadcastTransaction(
      await this.prepareTransaction(txRequest)
    );
    // Register pending transaction
    this.registerPendingTransaction(tx.hash, gasPriceGwei, timeoutMs, onTimeout);
    logger.info(`Transaction submitted: ${tx.hash} with gas price ${gasPriceGwei} gwei`);
    return tx;
  }

  /**
   * Prepare transaction before sending
   */
  private async prepareTransaction(txRequest: ethers.TransactionRequest): Promise<string> {
    // Ensure all required fields are present
    if (!txRequest.to) {
      throw new Error('Transaction missing to address');
    }

    if (!txRequest.gasPrice && !txRequest.maxFeePerGas) {
      // Get current gas price if not provided
      const feeData = await this.provider.getFeeData();
      txRequest.gasPrice = feeData.gasPrice;
    }

    // Set gas limit if not provided
    if (!txRequest.gasLimit) {
      try {
        txRequest.gasLimit = await this.provider.estimateGas(txRequest);
        // Add a 20% buffer
        txRequest.gasLimit = txRequest.gasLimit * BigInt(120) / BigInt(100);
      } catch (error) {
        logger.warn(`Error estimating gas, using default: ${error instanceof Error ? error.message : String(error)}`);
        txRequest.gasLimit = BigInt(500000); // Default gas limit
      }
    }

    // If this is a wallet instance, we can sign directly
    if ('signTransaction' in this.provider) {
      return await (this.provider as unknown as ethers.Wallet).signTransaction(txRequest);
    }

    // Otherwise, transaction must be signed elsewhere
    throw new Error('Provider cannot sign transactions. Use a Wallet instead.');
  }

  /**
   * Register a pending transaction and set timeout
   */
  private registerPendingTransaction(
    txHash: string,
    gasPriceGwei: number,
    timeoutMs: number,
    onTimeout?: () => void
  ): void {
    // Register transaction
    this.pendingTransactions.set(txHash, {
      hash: txHash,
      timestamp: Date.now(),
      gasPriceGwei,
      timeoutMs,
      onTimeout
    });
    // Set timeout for transaction
    const timeout = setTimeout(() => {
      this.handleTransactionTimeout(txHash);
    }, timeoutMs);
    this.transactionTimeouts.set(txHash, timeout);
    // Start monitoring transaction
    this.monitorTransaction(txHash);
  }

  /**
   * Monitor transaction for confirmation
   */
  private async monitorTransaction(txHash: string): Promise<void> {
    try {
      // Wait for transaction receipt
      const receipt = await this.provider.waitForTransaction(txHash);
      // Clear timeout
      this.clearTransactionTimeout(txHash);
      // Log result
      if (receipt.status === 1) {
        logger.info(`Transaction ${txHash} confirmed successfully in block ${receipt.blockNumber}`);
      } else {
        logger.error(`Transaction ${txHash} failed with status ${receipt.status}`);
      }
    } catch (error) {
      logger.error(`Error monitoring transaction ${txHash}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Handle transaction timeout
   */
  private handleTransactionTimeout(txHash: string): void {
    // Get transaction details
    const txDetails = this.pendingTransactions.get(txHash);
    if (!txDetails) return;
    logger.warn(`Transaction ${txHash} timed out after ${txDetails.timeoutMs}ms`);
    // Remove from pending transactions
    this.pendingTransactions.delete(txHash);
    this.transactionTimeouts.delete(txHash);
    // Execute timeout callback if provided
    if (txDetails.onTimeout) {
      txDetails.onTimeout();
    }
  }

  /**
   * Clear transaction timeout
   */
  private clearTransactionTimeout(txHash: string): void {
    // Clear timeout
    const timeout = this.transactionTimeouts.get(txHash);
    if (timeout) {
      clearTimeout(timeout);
      this.transactionTimeouts.delete(txHash);
    }
    // Remove from pending transactions
    this.pendingTransactions.delete(txHash);
  }

  /**
   * Get optimal gas price based on network conditions
   */
  private async getOptimalGasPrice(maxGasPriceGwei: number): Promise<number> {
    try {
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const currentGasPrice = feeData.gasPrice || ethers.parseUnits('50', 'gwei');
      const currentGasPriceGwei = parseFloat(ethers.formatUnits(currentGasPrice, 'gwei'));
      // Cap at maximum
      const cappedGasPrice = Math.min(currentGasPriceGwei, maxGasPriceGwei);
      // Add to history
      this.gasPriceHistory.push({
        timestamp: Date.now(),
        gasPriceGwei: cappedGasPrice
      });
      // Trim history (keep last 20 entries)
      if (this.gasPriceHistory.length > 20) {
        this.gasPriceHistory = this.gasPriceHistory.slice(-20);
      }
      return cappedGasPrice;
    } catch (error) {
      logger.warn(`Error getting gas price: ${error instanceof Error ? error.message : String(error)}`);
      return Math.min(50, maxGasPriceGwei); // Default to 50 gwei or max
    }
  }

  /**
   * Start gas price monitoring
   */
  private startGasPriceMonitoring(): void {
    // Clear existing interval if any
    if (this.gasPriceUpdateInterval) {
      clearInterval(this.gasPriceUpdateInterval);
    }
    // Set up new interval
    this.gasPriceUpdateInterval = setInterval(async () => {
      try {
        // Get latest gas price (ignore max for monitoring)
        await this.getOptimalGasPrice(10000);
      } catch (error) {
        logger.debug(`Error in gas price monitoring: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, this.gasPriceUpdateFrequencyMs);
  }

  /**
   * Get network congestion level (0-1)
   */
  public getNetworkCongestion(): number {
    if (this.gasPriceHistory.length === 0) {
      return 0.5; // Default to medium congestion if no data
    }
    // Calculate average gas price
    const sum = this.gasPriceHistory.reduce((acc, entry) => acc + entry.gasPriceGwei, 0);
    const avgGasPrice = sum / this.gasPriceHistory.length;
    // Map to congestion level (0-1)
    // Below 20 gwei: low congestion
    // Above 100 gwei: high congestion
    const congestionLevel = Math.min(1, Math.max(0, (avgGasPrice - 20) / 80));
    return congestionLevel;
  }

  /**
   * Check if transaction is pending
   */
  public isTransactionPending(txHash: string): boolean {
    return this.pendingTransactions.has(txHash);
  }

  /**
   * Get pending transactions count
   */
  public getPendingTransactionsCount(): number {
    return this.pendingTransactions.size;
  }

  /**
   * Get current gas price in gwei
   */
  public getCurrentGasPrice(): number {
    if (this.gasPriceHistory.length === 0) {
      return 50; // Default if no data
    }
    return this.gasPriceHistory[this.gasPriceHistory.length - 1].gasPriceGwei;
  }

  /**
   * Stop gas price monitoring
   */
  public stop(): void {
    if (this.gasPriceUpdateInterval) {
      clearInterval(this.gasPriceUpdateInterval);
      this.gasPriceUpdateInterval = null;
    }
    // Clear all transaction timeouts
    for (const [txHash, timeout] of this.transactionTimeouts.entries()) {
      clearTimeout(timeout);
    }
    this.transactionTimeouts.clear();
    this.pendingTransactions.clear();
    logger.info('TransactionService stopped');
  }
}
