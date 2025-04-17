// src/bot/ArbitrageBot.ts

import {
  formatUnits,
  parseUnits,
  JsonRpcProvider,
  WebSocketProvider,
  Contract,
  Wallet,
  BigNumber,
  AbiCoder,
  isError
} from "ethers";

import { StackIntegrator } from '../stacks/StackIntegrator';
import { PriceOracle } from '../utils/PriceOracle';
import { DEXQuotes, ArbitrageStrategy, TokenPair } from '../types/ArbitrageTypes';
import { logger } from '../utils/Logger';
import { config } from '../config/Config';
import { MulticallProvider } from '../utils/MulticallProvider';
import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { PerformanceMetrics } from '../utils/PerformanceMetrics';
import { EventEmitter } from 'events';
import { ArbitrageCoreABI } from '../abis/ArbitrageCoreABI';
import { RouterABI } from '../abis/RouterABI';
import { IERC20ABI } from '../abis/IERC20ABI';

/**
 * Event types for ArbitrageBot
 */
interface ArbitrageBotEvents {
  started: void;
  stopped: void;
  error: {operation: string, error: unknown};
}

/**
 * Type for EventEmitter with strongly-typed events
 */
type TypedEventEmitter<T> = Omit<EventEmitter, "on" | "emit"> & {
  on<K extends keyof T>(event: K, listener: (arg: T[K]) => void): this;
  emit<K extends keyof T>(event: K, arg: T[K]): boolean;
};

/**
 * Enhanced ArbitrageBot with quantum-inspired optimization
 * Core component for flash loan arbitrage detection and execution on Polygon
 */
export class ArbitrageBot extends EventEmitter implements TypedEventEmitter<ArbitrageBotEvents> {
  // Stacks and services
  private stackIntegrator: StackIntegrator;
  private priceOracle: PriceOracle;
  private tokenService: TokenService;
  private dexService: DEXService;
  private metrics: PerformanceMetrics;

  // Blockchain connectivity
  private provider: JsonRpcProvider;
  private multicallProvider: MulticallProvider;
  private wallet: Wallet;
  private flashLoanContract: Contract;

  // Runtime state
  private isRunning: boolean = false;
  private cycleDetectionRunning: boolean = false;
  private executionInProgress: boolean = false;
  private lastDetectionTime: number = 0;
  private detectionInterval: NodeJS.Timeout | null = null;
  private blockSubscription: WebSocketProvider | null = null;

  // Performance optimization
  private opportunityCache: Map<string, any> = new Map();
  private pathCache: Map<string, { timestamp: number; paths: string[][] }> = new Map();
  private pairScores: Map<string, number> = new Map();
  private cacheValidityPeriod = 30 * 1000; // 30 seconds
  private explorationRatio = 0.1; // 10% of cycles are random for exploration

  // Configuration
  private readonly parallelismFactor = 3;
  private readonly maxConcurrentOperations = 5;
  private readonly minTimeBetweenDetections = 5000; // 5 seconds
  private activeOperations = 0;

  constructor(
    private readonly flashLoanAddress: string,
    private readonly privateKey: string,
    private readonly rpcUrl: string,
    private readonly wsRpcUrl?: string,
    private options: {
      keystoneActivation?: boolean;
      tiDominantWeight?: number;
      neDominantWeight?: number;
      entropy?: number;
      adaptiveBatchSize?: boolean;
      blockSubscription?: boolean;
    } = {}
  ) {
    super();

    // Apply defaults
    this.options = {
      keystoneActivation: true,
      tiDominantWeight: 0.85,
      neDominantWeight: 0.72,
      entropy: 0.96,
      adaptiveBatchSize: true,
      blockSubscription: !!wsRpcUrl,
      ...options
    };

    // Initialize connections
    this.provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(this.privateKey, this.provider);
    this.multicallProvider = new MulticallProvider(this.provider);

    // Initialize contracts
    this.flashLoanContract = new Contract(
      this.flashLoanAddress,
      ArbitrageCoreABI,
      this.wallet
    );

    // Initialize core services
    this.tokenService = new TokenService(this.multicallProvider);
    this.dexService = new DEXService(this.multicallProvider, config);
    this.priceOracle = new PriceOracle();
    this.metrics = new PerformanceMetrics();

    // Initialize quantum stack integration
    this.stackIntegrator = new StackIntegrator({
      keystoneActivation: this.options.keystoneActivation,
      tiDominantWeight: this.options.tiDominantWeight,
      neDominantWeight: this.options.neDominantWeight,
      entropy: this.options.entropy
    });

    logger.info('ArbitrageBot initialized with quantum-enhanced parameters');
  }

  /**
   * Start the arbitrage bot with continuous monitoring
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ArbitrageBot is already running');
      return;
    }

    try {
      this.isRunning = true;
      // Initialize services
      await this.initializeServices();
      
      // Setup monitoring method based on configuration
      if (this.options.blockSubscription && this.wsRpcUrl) {
        await this.setupBlockSubscription();
      } else {
        this.setupIntervalDetection();
      }

      logger.info('ArbitrageBot is running');
      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      const errorMessage = isError(error) ? error.message : String(error);
      logger.error(`Failed to start ArbitrageBot: ${errorMessage}`);
      this.emit('error', {operation: 'start', error});
      throw error;
    }
  }

  /**
   * Stop the arbitrage bot
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('ArbitrageBot is not running');
      return;
    }

    // Clear interval if using polling
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }

    // Unsubscribe from block events if using websocket
    if (this.blockSubscription) {
      this.blockSubscription.removeAllListeners();
      this.blockSubscription = null;
    }

    this.isRunning = false;
    logger.info('ArbitrageBot stopped');
    this.emit('stopped');
  }

  /**
   * Initialize required services before starting
   */
  private async initializeServices(): Promise<void> {
    // Initialize tokens with parallel loading
    const tokensPromise = this.tokenService.loadTokens(config.TOKENS);
    // Initialize DEX routers with parallel loading
    const dexPromise = this.dexService.initializeDEXs();
    // Initialize price feeds
    const pricePromise = this.priceOracle.initialize();
    
    // Wait for all initializations to complete
    await Promise.all([tokensPromise, dexPromise, pricePromise]);
    // Warm up token pair cache
    await this.tokenService.preloadCommonPairs(config.TOKEN_PAIRS);
    
    logger.info('Services initialized successfully');
  }

  /**
   * Setup websocket subscription for new blocks
   */
  private async setupBlockSubscription(): Promise<void> {
    if (!this.wsRpcUrl) {
      throw new Error('WebSocket RPC URL not provided');
    }

    try {
      const wsProvider = new WebSocketProvider(this.wsRpcUrl);
      // Ensure connection is established
      await wsProvider.waitForReady();
      
      wsProvider.on('block', async (blockNumber: number) => {
        if (this.shouldSkipDetection()) return;
        
        logger.debug(`New block detected: ${blockNumber}`);
        this.lastDetectionTime = Date.now();
        this.checkArbitrageOpportunities(blockNumber)
          .catch(error => this.handleError('block detection', error));
      });
      
      this.blockSubscription = wsProvider;
      logger.info('Block subscription established');
    } catch (error) {
      logger.error(`Failed to setup WebSocket connection: ${isError(error) ? error.message : String(error)}`);
      logger.info('Falling back to interval-based detection');
      this.setupIntervalDetection();
    }
  }

  /**
   * Setup interval-based polling for arbitrage opportunities
   */
  private setupIntervalDetection(): void {
    // Clear any existing interval
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }

    // Create new interval with optimal polling frequency
    this.detectionInterval = setInterval(async () => {
      if (this.shouldSkipDetection()) return;
      
      this.lastDetectionTime = Date.now();
      const blockNumber = await this.provider.getBlockNumber();
      this.checkArbitrageOpportunities(blockNumber)
        .catch(error => this.handleError('interval detection', error));
    }, config.DETECTION_INTERVAL);
    
    logger.info(`Interval-based detection started with ${config.DETECTION_INTERVAL}ms frequency`);
  }

  /**
   * Determines if arbitrage detection should be skipped
   * (based on cooling period and active operations)
   */
  private shouldSkipDetection(): boolean {
    if (this.cycleDetectionRunning) {
      return true;
    }

    if (this.executionInProgress) {
      return true;
    }

    const timeSinceLastDetection = Date.now() - this.lastDetectionTime;
    if (timeSinceLastDetection < this.minTimeBetweenDetections) {
      return true;
    }

    return false;
  }

  /**
   * Main function to check for arbitrage opportunities
   * Uses quantum stack optimization for efficient path discovery
   */
  private async checkArbitrageOpportunities(blockNumber: number): Promise<void> {
    if (this.cycleDetectionRunning) {
      logger.debug('Arbitrage detection already in progress, skipping');
      return;
    }

    try {
      this.cycleDetectionRunning = true;
      this.metrics.startOperation('opportunityDetection');
      logger.info(`Checking arbitrage opportunities at block ${blockNumber}`);
      
      // Phase 1: Generate pairs and paths
      const { pairs, tokens } = await this.generatePairsAndTokens();
      
      // Phase 2: Generate potential arbitrage cycles
      const cycles = this.generateArbitrageCycles(tokens);
      
      // Phase 3: Evaluate cycles for profit potential
      const opportunities = await this.evaluateCycles(cycles, pairs);
      
      // Phase 4: Execute profitable arbitrage if found
      if (opportunities.length > 0) {
        // Sort by profitability
        opportunities.sort((a, b) => {
          if (!a[0]?.profitPercentage || !b[0]?.profitPercentage) return 0;
          return b[0].profitPercentage - a[0].profitPercentage;
        });
        
        // Log top opportunities
        this.logTopOpportunities(opportunities);
        
        // Find best opportunity using quantum stack integration
        const allQuotes = opportunities.flatMap(group => group);
        const best = this.stackIntegrator.evaluate(allQuotes, opportunities);
        
        if (best) {
          await this.executeArbitrage(best);
        } else {
          logger.info('No quantum-approved arbitrage opportunity found');
        }
      } else {
        logger.info('No profitable arbitrage opportunities found');
      }

      this.metrics.endOperation('opportunityDetection');
      this.cycleDetectionRunning = false;
    } catch (error) {
      this.metrics.endOperation('opportunityDetection', false);
      this.cycleDetectionRunning = false;
      this.handleError('opportunity detection', error);
    }
  }

  /**
   * Generate pairs and tokens for analysis
   * Uses adaptive selection based on historical performance
   */
  private async generatePairsAndTokens(): Promise<{
    pairs: TokenPair[];
    tokens: string[];
  }> {
    this.metrics.startOperation('pairGeneration');
    try {
      // Get predefined pairs with adaptive selection
      const allPairs = await this.dexService.getTokenPairs();
      
      // Prioritize pairs based on historical performance
      const prioritizedPairs = this.prioritizePairs(allPairs);
      
      // Limit to configured maximum
      const pairs = prioritizedPairs.slice(0, config.MAX_PAIRS_TO_USE);
      
      // Extract unique tokens from pairs
      const allTokens = Array.from(new Set(
        pairs.flatMap(p => [
          p.baseToken.toLowerCase(),
          p.quoteToken.toLowerCase()
        ])
      ));
      
      // Prioritize tokens
      const tokens = allTokens.slice(0, config.MAX_TOKENS_TO_CONSIDER);
      
      logger.info(`Generated ${pairs.length} pairs with ${tokens.length} unique tokens`);
      this.metrics.endOperation('pairGeneration');
      return { pairs, tokens };
    } catch (error) {
      this.metrics.endOperation('pairGeneration', false);
      throw error;
    }
  }

  /**
   * Prioritize pairs based on historical performance
   * Uses quantum-inspired scoring for optimal selection
   */
  private prioritizePairs(pairs: TokenPair[]): TokenPair[] {
    return pairs.sort((a, b) => {
      const scoreA = this.getPairScore(a);
      const scoreB = this.getPairScore(b);
      return scoreB - scoreA;
    });
  }

  /**
   * Get score for a token pair based on historical performance
   * Incorporates entropy-based value modulation
   */
  private getPairScore(pair: TokenPair): number {
    const pairKey = `${pair.baseToken}-${pair.quoteToken}`;
    // Get cached score or initialize
    let score = this.pairScores.get(pairKey) || 0.5;
    // Apply entropy-based score modulation
    const entropyFactor = Math.sin(Date.now() / 10000) * 0.1 + 0.9;
    score *= entropyFactor;
    // Apply small random fluctuation for exploration
    if (Math.random() < 0.1) {
      score *= 0.8 + Math.random() * 0.4;
    }

    return score;
  }

  /**
   * Update score for a token pair based on detection results
   */
  private updatePairScore(pair: string, profitable: boolean, profitAmount?: number): void {
    const currentScore = this.pairScores.get(pair) || 0.5;
    // Calculate new score
    let newScore: number;
    if (profitable && profitAmount) {
      // Successful arbitrage - increase score
      newScore = currentScore * 0.8 + 0.2 * Math.min(1, profitAmount / 100);
    } else if (profitable) {
      // Profitable but not executed
      newScore = currentScore * 0.9 + 0.1;
    } else {
      // Not profitable - gradually decrease score
      newScore = currentScore * 0.95;
    }

    // Apply bounds
    newScore = Math.max(0.1, Math.min(1.0, newScore));
    // Update score
    this.pairScores.set(pair, newScore);
  }

  /**
   * Generate arbitrage cycles with quantum-inspired optimization
   * Uses probabilistic exploration for efficient path discovery
   */
  private generateArbitrageCycles(tokens: string[]): string[][] {
    this.metrics.startOperation('cycleGeneration');
    try {
      const cyclesByLength: Map<number, string[][]> = new Map();
      // Check cache first
      const cacheKey = tokens.slice(0, 20).join('-');
      const cachedPaths = this.pathCache.get(cacheKey);
      if (cachedPaths && (Date.now() - cachedPaths.timestamp) < this.cacheValidityPeriod) {
        this.metrics.endOperation('cycleGeneration');
        return cachedPaths.paths;
      }

      // Generate cycles for different cycle lengths
      let allCycles: string[][] = [];
      for (const cycleLength of config.CYCLE_LENGTHS) {
        const cycles = this._generateCyclesOfLength(tokens, cycleLength);
        // Store in map
        cyclesByLength.set(cycleLength, cycles);
        // Add to overall list with limit
        allCycles = allCycles.concat(
          cycles.slice(0, config.MAX_CYCLES_PER_LENGTH)
        );
        if (allCycles.length >= config.MAX_CYCLES) {
          break;
        }
      }

      // Randomize a portion of results to encourage exploration
      const explorationCount = Math.floor(allCycles.length * this.explorationRatio);
      if (explorationCount > 0) {
        const explorationIndices = new Set<number>();
        while (explorationIndices.size < explorationCount) {
          explorationIndices.add(Math.floor(Math.random() * allCycles.length));
        }

        // Replace selected indices with random cycles
        for (const index of explorationIndices) {
          const cycleLength = allCycles[index].length;
          const randomCycle = this._generateRandomCycle(tokens, cycleLength);
          allCycles[index] = randomCycle;
        }
      }

      // Cache the results
      this.pathCache.set(cacheKey, {
        timestamp: Date.now(),
        paths: allCycles
      });
      logger.info(`Generated ${allCycles.length} potential arbitrage cycles`);
      this.metrics.endOperation('cycleGeneration');
      return allCycles;
    } catch (error) {
      this.metrics.endOperation('cycleGeneration', false);
      throw error;
    }
  }

  /**
   * Generate cycles of specific length
   * Uses beam search with entropy-guided exploration
   */
  private _generateCyclesOfLength(tokens: string[], cycleLength: number): string[][] {
    if (cycleLength < 3) return [];
    // Setup beam search parameters
    const beamWidth = 25 * cycleLength;
    let beams: { path: string[]; score: number }[] = [{ path: [], score: 0 }];

    // First token selection - prioritize stablecoins and major tokens
    if (beams[0].path.length === 0) {
      beams = [];
      const stablecoins = tokens.filter(t =>
        this.tokenService.isStablecoin(t) || this.tokenService.isMajorToken(t)
      );
      for (const token of stablecoins.length > 0 ? stablecoins : tokens.slice(0, 10)) {
        beams.push({
          path: [token],
          score: this.tokenService.getTokenWeight(token)
        });
      }
    }

    // Main beam search algorithm
    for (let i = 1; i < cycleLength; i++) {
      const candidates: { path: string[]; score: number }[] = [];
      for (const beam of beams) {
        const lastToken = beam.path[beam.path.length - 1];
        // Final position - need to close the cycle
        if (i === cycleLength - 1) {
          // Only option is to return to first token
          const firstToken = beam.path[0];
          // Check for liquidity
          if (this.dexService.hasLiquidity(lastToken, firstToken)) {
            const pathCopy = [...beam.path, firstToken];
            const newScore = beam.score + this.dexService.getPairLiquidityScore(lastToken, firstToken);
            candidates.push({ path: pathCopy, score: newScore });
          }
          continue;
        }

        // Get candidate next tokens with liquidity
        const candidateTokens = tokens.filter(token =>
          !beam.path.includes(token) &&
          this.dexService.hasLiquidity(lastToken, token)
        );
        // Generate next beam candidates
        for (const token of candidateTokens) {
          const pairLiquidityScore = this.dexService.getPairLiquidityScore(lastToken, token);
          const tokenWeight = this.tokenService.getTokenWeight(token);
          const pathCopy = [...beam.path, token];
          // Apply entropy factor for exploration
          const entropyFactor = 0.95 + Math.random() * 0.1;
          const newScore = (beam.score + pairLiquidityScore * tokenWeight) * entropyFactor;
          candidates.push({ path: pathCopy, score: newScore });
        }
      }

      // Sort and prune candidates
      beams = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, beamWidth);
      if (beams.length === 0) break;
    }

    // Convert beams to path arrays and filter invalid cycles
    return beams
      .filter(beam => beam.path.length === cycleLength)
      .map(beam => beam.path);
  }

  /**
   * Generate a random cycle for exploration
   */
  private _generateRandomCycle(tokens: string[], cycleLength: number): string[] {
    const cycle: string[] = [];
    const usedTokens = new Set<string>();
    // First token selection - prioritize stablecoins or random token
    const stablecoins = tokens.filter(token => this.tokenService.isStablecoin(token));
    const firstToken = stablecoins.length > 0
      ? stablecoins[Math.floor(Math.random() * stablecoins.length)]
      : tokens[Math.floor(Math.random() * tokens.length)];
    cycle.push(firstToken);
    usedTokens.add(firstToken);
    // Generate intermediate tokens
    for (let i = 1; i < cycleLength - 1; i++) {
      const lastToken = cycle[cycle.length - 1];
      // Get candidate tokens that haven't been used yet
      const candidates = tokens.filter(token =>
        !usedTokens.has(token) && this.dexService.hasLiquidity(lastToken, token)
      );
      if (candidates.length === 0) {
        // Failed to complete cycle, restart
        return this._generateRandomCycle(tokens, cycleLength);
      }

      // Select random candidate
      const nextToken = candidates[Math.floor(Math.random() * candidates.length)];
      cycle.push(nextToken);
      usedTokens.add(nextToken);
    }

    // Complete cycle by returning to first token
    cycle.push(firstToken);
    // Validate cycle
    if (cycle.length !== cycleLength) {
      return this._generateRandomCycle(tokens, cycleLength);
    }

    return cycle;
  }

  /**
   * Evaluate cycles for profit potential
   * Implements parallel processing with quantum-inspired optimization
   */
  private async evaluateCycles(cycles: string[][], pairs: TokenPair[]): Promise<DEXQuotes[][]> {
    this.metrics.startOperation('cycleEvaluation');
    try {
      // Determine optimal batch size based on cycles length
      const batchSize = this.options.adaptiveBatchSize
        ? Math.min(Math.max(10, Math.floor(cycles.length / 20)), 50)
        : 20;
      logger.debug(`Evaluating ${cycles.length} cycles with batch size ${batchSize}`);
      const profitableCycles: DEXQuotes[][] = [];
      let processedCycles = 0;
      // Process in batches with parallelization
      for (let i = 0; i < cycles.length; i += batchSize) {
        // Check if we should continue or have enough profitable cycles
        if (profitableCycles.length >= config.MAX_PROFITABLE_CYCLES) {
          logger.debug(`Reached maximum profitable cycles (${config.MAX_PROFITABLE_CYCLES}), stopping evaluation`);
          break;
        }

        // Extract batch
        const batch = cycles.slice(i, i + batchSize);
        // Process batch in parallel
        const batchPromises = batch.map(cycle => this.evaluateCycle(cycle));
        const batchResults = await Promise.all(batchPromises);
        // Filter profitable results
        for (const quotes of batchResults) {
          if (quotes.length > 0 && this.isCycleProfitable(quotes)) {
            profitableCycles.push(quotes);
            // Update pair scores for reinforcement learning
            const pairKey = `${quotes[0].from}-${quotes[0].to}`;
            this.updatePairScore(pairKey, true);
          }
        }

        // Update progress
        processedCycles += batch.length;
        if (processedCycles % config.PROGRESS_INTERVAL === 0 || processedCycles === cycles.length) {
          logger.info(`Processed ${processedCycles}/${cycles.length} cycles (${profitableCycles.length} profitable)`);
        }
      }

      logger.info(`Found ${profitableCycles.length} profitable arbitrage opportunities`);
      this.metrics.endOperation('cycleEvaluation');
      return profitableCycles;
    } catch (error) {
      this.metrics.endOperation('cycleEvaluation', false);
      throw error;
    }
  }

  /**
   * Evaluate a single cycle for arbitrage opportunity
   * Applies quantum Ti stack for precision and causal verification
   */
  private async evaluateCycle(cycle: string[]): Promise<DEXQuotes[]> {
    try {
      const quotes: DEXQuotes[] = [];
      // Test with multiple amounts for optimal sizing
      for (const amountInStr of config.TEST_AMOUNTS) {
        const amountIn = BigInt(amountInStr);
        let currentAmount = amountIn;
        const cycleQuotes: DEXQuotes[] = [];
        let cycleBroken = false;
        // Evaluate each hop in the cycle
        for (let i = 0; i < cycle.length - 1; i++) {
          const from = cycle[i];
          const to = cycle[i + 1];
          try {
            // Get quotes from multiple DEXes
            const quoteResult = await this.dexService.getBestQuote(from, to, currentAmount);
            if (!quoteResult || !quoteResult.bestQuote) {
              cycleBroken = true;
              break;
            }

            // Add to cycle quotes
            cycleQuotes.push(quoteResult.bestQuote);
            // Update current amount for next hop
            currentAmount = quoteResult.bestQuote.amountOut;
          } catch (error) {
            cycleBroken = true;
            break;
          }
        }

        // If cycle completed successfully, check profitability
        if (!cycleBroken && cycleQuotes.length === cycle.length - 1) {
          // Calculate total profit
          const initialAmount = cycleQuotes[0].amountIn;
          const finalAmount = cycleQuotes[cycleQuotes.length - 1].amountOut;
          if (finalAmount > initialAmount) {
            // Mark as profitable
            const profit = finalAmount - initialAmount;
            const profitPercentage = Number(formatUnits(
              (profit * BigInt(10000)) / initialAmount, 
              4
            ));
            // Add additional metadata
            cycleQuotes[0].profitPercentage = profitPercentage;
            cycleQuotes[0].entropyFactor = 0.95 + Math.random() * 0.05;
            // Return profitable cycle quotes
            return cycleQuotes;
          }
        }
      }
      // No profitable path found
      return [];
    } catch (error) {
      logger.debug(`Error evaluating cycle: ${isError(error) ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Check if a cycle is profitable above threshold
   */
  private isCycleProfitable(quotes: DEXQuotes[]): boolean {
    if (quotes.length === 0) return false;
    const profitPercentage = quotes[0].profitPercentage;
    if (profitPercentage === undefined) return false;
    return profitPercentage >= config.MIN_PROFIT_PERCENTAGE;
  }

  /**
   * Log top arbitrage opportunities
   */
  private logTopOpportunities(opportunities: DEXQuotes[][]): void {
    logger.info('Top arbitrage opportunities:');
    const topCount = Math.min(3, opportunities.length);
    for (let i = 0; i < topCount; i++) {
      const opportunity = opportunities[i];
      if (opportunity.length === 0 || opportunity[0].profitPercentage === undefined) continue;
      logger.info(` ${i+1}. Profit: ${opportunity[0].profitPercentage.toFixed(4)}% - Path: ${this.formatPath(opportunity)}`);
    }
  }

  /**
   * Format a path for logging
   */
  private formatPath(quotes: DEXQuotes[]): string {
    if (!Array.isArray(quotes) || quotes.length === 0) return "Empty path";
    const path = [this.tokenService.getTokenSymbol(quotes[0].from || '')];
    for (const quote of quotes) {
      path.push(this.tokenService.getTokenSymbol(quote.to || ''));
    }
    return path.join(" → ");
  }

  /**
   * Execute arbitrage transaction
   * Uses quantum Te stack for implementation efficiency
   */
  private async executeArbitrage(quotes: DEXQuotes): Promise<boolean> {
    if (this.executionInProgress) {
      logger.warn('Arbitrage execution already in progress, skipping');
      return false;
    }

    this.executionInProgress = true;
    this.metrics.startOperation('arbitrageExecution');
    try {
      logger.info(`Executing arbitrage: ${quotes.pair} with projected profit ${quotes.profitPercentage}%`);
      // Analyze opportunity with quantum stack
      const strategy = this.stackIntegrator.analyzeOpportunity(quotes);
      if ('profitable' in strategy && !strategy.profitable) {
        logger.info('Opportunity no longer profitable after stack analysis');
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }

      // Make TypeScript happy with a validated strategy
      const validStrategy = strategy as Exclude<typeof strategy, { profitable: false }>;

      // Get USD value of profit
      const profitUsd = await this.getUsdValue(validStrategy.estimatedProfit, validStrategy.baseToken.address);
      logger.info(`Estimated profit: $${profitUsd.toFixed(2)}`);
      // Check if profit meets minimum threshold in USD
      if (profitUsd < config.MIN_PROFIT_USD) {
        logger.info(`Profit $${profitUsd.toFixed(2)} below minimum threshold $${config.MIN_PROFIT_USD.toFixed(2)}`);
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }

      // Get optimal execution parameters with quantum optimization
      const gasParams = this.stackIntegrator.optimizeExecution({
        strategy: validStrategy,
        gasPrice: await this.provider.getFeeData().then(fees => fees.gasPrice || BigInt(0)),
        blockTimestamp: Math.floor(Date.now() / 1000)
      });

      // Encode data for flash loan
      let encodedData: string;
      let routerSequence: string[];
      if (validStrategy.path1.length > 2 || validStrategy.path2.length > 2) {
        // Multi-hop route requires advanced encoding
        encodedData = this.encodeMultiHopData(validStrategy);
        routerSequence = [`Multi-hop route with ${validStrategy.path1.length + validStrategy.path2.length - 2} hops`];
      } else {
        // Standard route
        encodedData = this.encodeStandardData(validStrategy);
        routerSequence = [validStrategy.dex1, validStrategy.dex2];
      }

      // Execute the transaction with optimal gas parameters
      logger.info(`Submitting transaction with gas price ${formatUnits(gasParams.gasPrice, 'gwei')} gwei, gas limit ${gasParams.gasLimit}`);
      const tx = await this.flashLoanContract.executeArbitrage(
        validStrategy.baseToken.address,
        validStrategy.flashLoanAmount,
        encodedData,
        validStrategy.strategyHash,
        {
          gasPrice: gasParams.gasPrice,
          gasLimit: gasParams.gasLimit
        }
      );

      logger.info(`Transaction submitted: ${tx.hash}`);
      // Wait for transaction confirmation
      const receipt = await tx.wait();
      // Process results
      if (receipt?.status === 1) {
        // Transaction successful
        logger.info(`Arbitrage executed successfully in block ${receipt.blockNumber}`);
        // Parse events to get actual profit
        const eventData = receipt.logs?.find(
          log => this.flashLoanContract.interface.parseLog(log)?.name === 'ArbitrageExecuted'
        );
        
        if (eventData) {
          const parsedLog = this.flashLoanContract.interface.parseLog(eventData);
          if (parsedLog && parsedLog.args) {
            const actualProfit = formatUnits(parsedLog.args.profit, validStrategy.baseToken.decimals);
            logger.info(`Actual profit: ${actualProfit} ${validStrategy.baseToken.symbol} ($${(parseFloat(actualProfit) * validStrategy.baseToken.priceUsd).toFixed(2)})`);
            // Update pair scores with actual result
            const pairKey = `${validStrategy.baseToken.address}-${validStrategy.quoteToken.address}`;
            this.updatePairScore(pairKey, true, parseFloat(actualProfit));
            // Update strategy performance metrics
            await this.flashLoanContract.updateStrategyScore(
              validStrategy.strategyHash,
              Math.floor(validStrategy.optimalPathScore * 100)
            ).catch(e => logger.warn(`Failed to update strategy score: ${isError(e) ? e.message : String(e)}`));
          }
        }

        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution');
        return true;
      } else {
        // Transaction failed
        logger.error(`Arbitrage transaction failed`);
        // Update pair scores with failure
        const pairKey = `${validStrategy.baseToken.address}-${validStrategy.quoteToken.address}`;
        this.updatePairScore(pairKey, false);
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }
    } catch (error) {
      this.executionInProgress = false;
      this.metrics.endOperation('arbitrageExecution', false);
      this.handleError('arbitrage execution', error);
      return false;
    }
  }

  /**
   * Encode data for standard two-token arbitrage
   */
  private encodeStandardData(strategy: ArbitrageStrategy): string {
    const path = [...strategy.path1, ...strategy.path2.slice(1)];
    return AbiCoder.defaultAbiCoder.encode(
      ['address[]', 'uint256'],
      [path, strategy.minAmountOut]
    );
  }

  /**
   * Encode data for multi-hop arbitrage
   */
  private encodeMultiHopData(strategy: ArbitrageStrategy): string {
    // Prepare route segments
    const routes: any[] = [];
    // Add path1 segments
    for (let i = 0; i < strategy.path1.length - 1; i++) {
      const from = strategy.path1[i];
      const to = strategy.path1[i + 1];
      // Get router for this segment
      const router = i === 0 ? strategy.dex1 : this.dexService.getBestRouterForPair(from, to);
      // Encode segment
      const segment = {
        dexType: this.getDexType(router),
        path: [from, to],
        router
      };
      routes.push(segment);
    }

    // Add path2 segments
    for (let i = 0; i < strategy.path2.length - 1; i++) {
      const from = strategy.path2[i];
      const to = strategy.path2[i + 1];
      // Get router for this segment
      const router = i === 0 ? strategy.dex2 : this.dexService.getBestRouterForPair(from, to);
      // Encode segment
      const segment = {
        dexType: this.getDexType(router),
        path: [from, to],
        router
      };
      routes.push(segment);
    }

    // Encode routes
    const encodedRoutes = routes.map(route => {
      if (route.dexType === 0) {
        // Standard AMM
        return AbiCoder.defaultAbiCoder.encode(
          ['uint8', 'bytes'],
          [
            0,
            AbiCoder.defaultAbiCoder.encode(
              ['address', 'address[]'],
              [route.router, route.path]
            )
          ]
        );
      } else if (route.dexType === 1) {
        // Uniswap V3
        const path = this.encodeUniswapV3Path(route.path);
        return AbiCoder.defaultAbiCoder.encode(
          ['uint8', 'bytes'],
          [
            1,
            AbiCoder.defaultAbiCoder.encode(
              ['bytes', 'uint256'],
              [path, 0] // Min amount out will be checked at the end
            )
          ]
        );
      }
      // Fallback to standard AMM
      return AbiCoder.defaultAbiCoder.encode(
        ['uint8', 'bytes'],
        [
          0,
          AbiCoder.defaultAbiCoder.encode(
            ['address', 'address[]'],
            [route.router, route.path]
          )
        ]
      );
    });

    // Encode full multi-hop data
    return AbiCoder.defaultAbiCoder.encode(
      ['bytes[]', 'uint256'],
      [encodedRoutes, strategy.minAmountOut]
    );
  }

  /**
   * Encode path for Uniswap V3
   */
  private encodeUniswapV3Path(path: string[]): string {
    if (path.length < 2) return '0x';
    // For each hop, encode token addresses and fees
    let encoded = '';
    for (let i = 0; i < path.length - 1; i++) {
      const tokenA = path[i];
      const tokenB = path[i + 1];
      // Get fee from config or use default
      const fee = config.UNISWAP_V3_FEES[`${tokenA}-${tokenB}`] ||
        config.UNISWAP_V3_FEES[`${tokenB}-${tokenA}`] ||
        3000; // Default fee: 0.3%
      if (i === 0) {
        // First token
        encoded += tokenA.slice(2).toLowerCase();
      }
      // Encode fee and next token
      encoded += fee.toString(16).padStart(6, '0') + tokenB.slice(2).toLowerCase();
    }
    return '0x' + encoded;
  }

  /**
   * Get DEX type for router
   */
  private getDexType(router: string): number {
    if (router.toLowerCase() === config.UNISWAP_V3_ROUTER.toLowerCase()) {
      return 1; // Uniswap V3
    }
    // Default to standard AMM
    return 0;
  }

  /**
   * Get USD value for token amount
   */
  private async getUsdValue(
    amount: bigint,
    tokenAddress: string
  ): Promise<number> {
    try {
      // Get token price
      const priceUsd = await this.priceOracle.getTokenPrice(tokenAddress);
      // Get token decimals
      const token = this.tokenService.getTokenByAddress(tokenAddress);
      const decimals = token?.decimals || 18;
      // Calculate USD value
      const amountFormatted = parseFloat(formatUnits(amount, decimals));
      return amountFormatted * priceUsd;
    } catch (error) {
      logger.warn(`Error getting USD value: ${isError(error) ? error.message : String(error)}`);
      return 0;
    }
  }

  /**
   * Error handling
   */
  private handleError(operation: string, error: unknown): void {
    const errorMessage = isError(error) ? error.message : String(error);
    logger.error(`Error in ${operation}: ${errorMessage}`);
    
    if (isError(error) && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    
    this.emit('error', { operation, error });
  }

  /**
   * Get bot statistics
   */
  public getStatistics(): any {
    return {
      isRunning: this.isRunning,
      totalDetections: this.metrics.getOperationCount('opportunityDetection'),
      successfulDetections: this.metrics.getOperationSuccessCount('opportunityDetection'),
      totalExecutions: this.metrics.getOperationCount('arbitrageExecution'),
      successfulExecutions: this.metrics.getOperationSuccessCount('arbitrageExecution'),
      averageDetectionTime: this.metrics.getAverageOperationTime('opportunityDetection'),
      averageExecutionTime: this.metrics.getAverageOperationTime('arbitrageExecution'),
      activePairs: this.pairScores.size,
      topPairs: Array.from(this.pairScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pair, score]) => ({ pair, score }))
    };
  }
}
