import { ethers } from 'ethers';
import { StackIntegration } from '../stacks/StackIntegration';
import { ArbitrageStrategy, TokenPair, DEXQuotes } from '../types/ArbitrageTypes';
import { ArbitrageCoreABI } from '../abis/ArbitrageCoreABI';
import { RouterABI } from '../abis/RouterABI';
import { IERC20ABI } from '../abis/IERC20ABI';
import { getTokenPrice } from '../utils/PriceOracle';
import { logger } from '../utils/Logger';
import { config } from '../config/Config';

export class ArbitrageBot {
  private provider: ethers.providers.Provider;
  private wallet: ethers.Wallet;
  private flashLoanContract: ethers.Contract;
  private quickswapRouter: ethers.Contract;
  private sushiswapRouter: ethers.Contract;
  private stackIntegration: StackIntegration;
  private isRunning: boolean = false;
  private tokenContracts: Map<string, ethers.Contract> = new Map();
  private ongoingArbitrages: Map<string, ArbitrageStrategy> = new Map();
  
  constructor(
    private readonly flashLoanAddress: string,
    privateKey: string,
    rpcUrl: string
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.flashLoanContract = new ethers.Contract(
      flashLoanAddress,
      ArbitrageCoreABI,
      this.wallet
    );
    this.quickswapRouter = new ethers.Contract(
      config.QUICKSWAP_ROUTER,
      RouterABI,
      this.wallet
    );
    this.sushiswapRouter = new ethers.Contract(
      config.SUSHISWAP_ROUTER,
      RouterABI,
      this.wallet
    );
    
    // Initialize stack integration with quantum optimization
    this.stackIntegration = new StackIntegration({
      keystoneActivation: true,
      tiDominantWeight: 0.85,
      neDominantWeight: 0.72,
      entropy: 0.96
    });
    
    // Initialize token contracts
    this.initializeTokenContracts();
    
    logger.info(`ArbitrageBot initialized with wallet: ${this.wallet.address}`);
  }
  
  private async initializeTokenContracts(): Promise<void> {
    for (const token of config.TOKENS) {
      this.tokenContracts.set(
        token.symbol,
        new ethers.Contract(token.address, IERC20ABI, this.wallet)
      );
      logger.debug(`Initialized token contract: ${token.symbol}`);
    }
  }
  
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ArbitrageBot is already running');
      return;
    }
    
    this.isRunning = true;
    logger.info('ArbitrageBot started');
    
    try {
      // Subscribe to new blocks
      this.provider.on('block', (blockNumber) => {
        this.checkArbitrageOpportunities(blockNumber)
          .catch(error => logger.error(`Error checking arbitrage opportunities: ${error.message}`));
      });
      
      // Run initial check
      const currentBlock = await this.provider.getBlockNumber();
      await this.checkArbitrageOpportunities(currentBlock);
    } catch (error) {
      logger.error(`Error starting ArbitrageBot: ${error.message}`);
      this.isRunning = false;
    }
  }
  
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('ArbitrageBot is not running');
      return;
    }
    
    this.provider.removeAllListeners('block');
    this.isRunning = false;
    logger.info('ArbitrageBot stopped');
  }
  
  private async checkArbitrageOpportunities(blockNumber: number): Promise<void> {
    logger.debug(`Checking arbitrage opportunities at block ${blockNumber}`);
    
    for (const pair of config.TOKEN_PAIRS) {
      try {
        const quotes = await this.getQuotesForPair(pair);
        const strategy = await this.analyzeArbitrageOpportunity(pair, quotes);
        
        if (strategy && strategy.profitPercentage > config.MIN_PROFIT_THRESHOLD) {
          await this.executeArbitrage(strategy);
        }
      } catch (error) {
        logger.error(`Error checking pair ${pair.name}: ${error.message}`);
      }
    }
  }
  
  private async getQuotesForPair(pair: TokenPair): Promise<DEXQuotes> {
    const token0 = config.TOKENS.find(t => t.symbol === pair.baseToken)!;
    const token1 = config.TOKENS.find(t => t.symbol === pair.quoteToken)!;
    
    // Use stack integration for path optimization
    const { optimizedAmount, entropyFactor } = this.stackIntegration.optimizeInputAmount({
      pair: pair.name,
      baseTokenLiquidity: await this.getTokenLiquidity(token0.address),
      quoteTokenLiquidity: await this.getTokenLiquidity(token1.address),
      historicalVolatility: pair.volatility || 0.05
    });
    
    const amountIn = ethers.utils.parseUnits(
      optimizedAmount.toString(),
      token0.decimals
    );
    
    const path1 = [token0.address, token1.address];
    const path2 = [token1.address, token0.address];
    
    // Get quotes from QuickSwap and SushiSwap
    const [quickswapAmounts, sushiswapAmounts] = await Promise.all([
      this.quickswapRouter.getAmountsOut(amountIn, path1),
      this.sushiswapRouter.getAmountsOut(amountIn, path1)
    ]);
    
    const quickswapOut = quickswapAmounts[1];
    const sushiswapOut = sushiswapAmounts[1];
    
    // Check reverse quotes
    const [quickswapReverseAmounts, sushiswapReverseAmounts] = await Promise.all([
      this.quickswapRouter.getAmountsOut(quickswapOut, path2),
      this.sushiswapRouter.getAmountsOut(sushiswapOut, path2)
    ]);
    
    const quickswapReverseOut = quickswapReverseAmounts[1];
    const sushiswapReverseOut = sushiswapReverseAmounts[1];
    
    return {
      pair: pair.name,
      baseToken: token0,
      quoteToken: token1,
      amountIn,
      quickswap: {
        forwardOut: quickswapOut,
        reverseOut: quickswapReverseOut
      },
      sushiswap: {
        forwardOut: sushiswapOut,
        reverseOut: sushiswapReverseOut
      },
      entropyFactor
    };
  }
  
  private async analyzeArbitrageOpportunity(
    pair: TokenPair,
    quotes: DEXQuotes
  ): Promise<ArbitrageStrategy | null> {
    // Apply Ti stack cognitive analysis to determine best path
    const analysis = this.stackIntegration.analyzeOpportunity(quotes);
    
    if (!analysis.profitable) {
      return null;
    }
    
    // Calculate optimal flash loan amount based on stack recommendation
    const flashLoanAmount = ethers.utils.parseUnits(
      analysis.optimalLoanAmount.toString(),
      quotes.baseToken.decimals
    );
    
    // Generate strategy hash for on-chain tracking
    const strategyHash = ethers.utils.id(
      `${quotes.pair}-${analysis.dex1}-${analysis.dex2}-${Date.now()}`
    );
    
    // Calculate minimum output amount with slippage protection
    const minAmountOut = quotes.amountIn.mul(
      ethers.BigNumber.from(10000 + Math.floor(analysis.profitPercentage * 100))
    ).div(
      ethers.BigNumber.from(10000 + config.SLIPPAGE_TOLERANCE)
    );
    
    const usdValue = await this.getUsdValue(
      quotes.baseToken.address,
      analysis.estimatedProfit
    );
    
    return {
      pair: quotes.pair,
      baseToken: quotes.baseToken,
      quoteToken: quotes.quoteToken,
      dex1: analysis.dex1,
      dex2: analysis.dex2,
      path1: analysis.path1,
      path2: analysis.path2,
      amountIn: quotes.amountIn,
      flashLoanAmount,
      minAmountOut,
      estimatedProfit: analysis.estimatedProfit,
      profitPercentage: analysis.profitPercentage,
      profitUsd: usdValue,
      optimalPathScore: analysis.optimalPathScore,
      strategyHash,
      entropyFactor: quotes.entropyFactor
    };
  }
  
  private async executeArbitrage(strategy: ArbitrageStrategy): Promise<void> {
    try {
      logger.info(`Executing arbitrage for ${strategy.pair} with expected profit: $${strategy.profitUsd.toFixed(2)}`);
      
      // Apply Ne stack for creative execution timing
      const executionParams = this.stackIntegration.optimizeExecution({
        strategy,
        gasPrice: await this.provider.getGasPrice(),
        blockTimestamp: (await this.provider.getBlock('latest')).timestamp
      });
      
      // Encode parameters for flash loan
      const routingData = ethers.utils.defaultAbiCoder.encode(
        ['address[]', 'address[]', 'uint256'],
        [strategy.path1, strategy.path2, strategy.minAmountOut]
      );
      
      // Record ongoing arbitrage
      this.ongoingArbitrages.set(strategy.strategyHash, strategy);
      
      // Execute flash loan transaction
      const tx = await this.flashLoanContract.executeArbitrage(
        strategy.baseToken.address,
        strategy.flashLoanAmount,
        routingData,
        strategy.strategyHash,
        {
          gasLimit: executionParams.gasLimit,
          gasPrice: executionParams.gasPrice
        }
      );
      
      logger.info(`Arbitrage transaction sent: ${tx.hash}`);
      
      // Wait for transaction to be mined
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        logger.info(`Arbitrage executed successfully in block ${receipt.blockNumber}`);
        
        // Update strategy score on-chain for future optimizations
        await this.flashLoanContract.updateStrategyScore(
          strategy.strategyHash,
          strategy.optimalPathScore
        );
      } else {
        logger.error(`Arbitrage transaction failed`);
      }
      
      // Remove from ongoing arbitrages
      this.ongoingArbitrages.delete(strategy.strategyHash);
    } catch (error) {
      logger.error(`Error executing arbitrage: ${error.message}`);
      this.ongoingArbitrages.delete(strategy.strategyHash);
    }
  }
  
  private async getTokenLiquidity(tokenAddress: string): Promise<number> {
    try {
      // This is a simplified implementation - in production you would
      // check actual liquidity in the pools you're trading with
      const tokenContract = new ethers.Contract(
        tokenAddress,
        IERC20ABI,
        this.provider
      );
      
      const balance = await tokenContract.balanceOf(config.QUICKSWAP_ROUTER);
      return parseFloat(ethers.utils.formatUnits(balance, 18));
    } catch (error) {
      logger.error(`Error getting token liquidity: ${error.message}`);
      return 0;
    }
  }
  
  private async getUsdValue(tokenAddress: string, amount: ethers.BigNumber): Promise<number> {
    try {
      const priceUsd = await getTokenPrice(tokenAddress);
      const formattedAmount = parseFloat(ethers.utils.formatEther(amount));
      return formattedAmount * priceUsd;
    } catch (error) {
      logger.error(`Error getting USD value: ${error.message}`);
      return 0;
    }
  }
}
