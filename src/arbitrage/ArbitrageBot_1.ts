// src/bot/ArbitrageBot.ts

import { ethers } from "ethers";
import { EventEmitter } from 'events';
import { logger } from '../utils/Logger';
import { config } from "../config/Config";

// Define the IERC20 ABI directly since the import is missing
const IERC20ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];
import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { PerformanceMetrics } from '../utils/PerformanceMetrics';
import { StackIntegrator } from '../stacks/StackIntegrator';
import { MulticallProvider } from '../utils/MulticallProvider'; // Import the actual MulticallProvider

// Extend DEXService with missing methods
interface ExtendedDEXService extends DEXService {
  hasLiquidity?(token1: string, token2: string): boolean;
  getPairLiquidityScore?(token1: string, token2: string): number;
}

// Type definitions
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

export interface DEXQuote {
  dex: string;
  path: string[];
  amountIn: bigint;
  amountOut: bigint; 
  gasEstimate: bigint;
}

export interface DEXQuotes {
  pair: string;
  baseToken: Token;
  quoteToken: Token;
  from: string;
  to: string;
  amountIn: bigint;
  quickswap: {
    forwardOut: bigint;
    reverseOut: bigint;
  };
  sushiswap: {
    forwardOut: bigint;
    reverseOut: bigint;
  };
  profitPercentage?: number;
  entropyFactor: number;
  projectedProfit?: number;
  amountOut?: bigint;
}

export interface ArbitrageStrategy {
  pair: string;
  baseToken: Token;
  quoteToken: Token;
  dex1: string;
  dex2: string;
  path1: string[];
  path2: string[];
  amountIn: bigint;
  flashLoanAmount: bigint;
  minAmountOut: bigint;
  estimatedProfit: bigint;
  profitPercentage: number;
  profitUsd: number;
  optimalPathScore: number;
  strategyHash: string;
  entropyFactor: number;
}

interface ArbitrageBotEvents {
  started: void;
  stopped: void;
  error: {operation: string, error: Error};
  opportunity: ArbitrageStrategy;
  execution: {strategy: ArbitrageStrategy, success: boolean, profit?: string};
}

type TypedEventEmitter<T> = Omit<EventEmitter, "on" | "emit"> & {
  on<K extends keyof T>(event: K, listener: (arg: T[K]) => void): TypedEventEmitter<T>;
  emit<K extends keyof T>(event: K, arg: T[K]): boolean;
};

// ABI definitions - ensure these files exist in your project
const ArbitrageCoreABI = [
  "function executeArbitrage(address token, uint256 amount, bytes calldata data, bytes32 strategyHash) external",
  "function updateStrategyScore(bytes32 strategyHash, uint256 score) external",
  "function setPaused(bool _paused) external",
  "function setMinProfitThreshold(uint256 _minProfitThreshold) external",
  "event ArbitrageExecuted(address indexed token, uint256 profit, bytes32 strategyHash, uint256 timestamp)",
  "event FlashLoanExecuted(address indexed token, uint256 amount, uint256 fee)"
];

const RouterABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

// ABI definition already declared at the top of the file

/**
 * Enhanced ArbitrageBot with quantum-inspired optimization
 * Core component for flash loan arbitrage detection and execution on Polygon
 */
export class ArbitrageBot extends EventEmitter implements TypedEventEmitter<ArbitrageBotEvents> {
  // Stacks and services
  private stackIntegrator!: StackIntegrator;
  private tokenService!: TokenService;
  private dexService!: ExtendedDEXService;
  private metrics!: PerformanceMetrics;

  // Blockchain connectivity
  private provider: ethers.JsonRpcProvider;
  private multicallProvider: MulticallProvider;
  private wallet: ethers.Wallet;
  private flashLoanContract: ethers.Contract;
  private quickswapRouter: ethers.Contract;
  private sushiswapRouter: ethers.Contract;

  // Runtime state
  private isRunning: boolean = false;
  private cycleDetectionRunning: boolean = false;
  private executionInProgress: boolean = false;
  private lastDetectionTime: number = 0;
  private detectionInterval: NodeJS.Timeout | null = null;
  private blockSubscription: any = null;

  // Performance optimization
  private opportunityCache: Map<string, any> = new Map();
  private pathCache: Map<string, { timestamp: number; paths: string[][] }> = new Map();
  private pairScores: Map<string, number> = new Map();
  private cacheValidityPeriod = 30 * 1000; // 30 seconds

  // Configuration
  private readonly parallelismFactor = 3;
  private readonly maxConcurrentOperations = 5;
  private readonly minTimeBetweenDetections = 5000; // 5 seconds
  private activeOperations = 0;
  
  // Maximum gas price for safety
  private readonly MAX_GAS_PRICE = '150'; // gwei

  // Uniswap V3 fee tiers
  private readonly uniswapV3Fees: { [key: string]: number } = {
    // Common fee tiers based on token volatility
    'WETH-USDC': 500,   // 0.05% for stable pairs
    'WETH-USDT': 500,   // 0.05% for stable pairs
    'WETH-DAI': 500,    // 0.05% for stable pairs
    'WETH-WBTC': 3000,  // 0.3% for standard pairs
    'WMATIC-WETH': 3000, // 0.3% for standard pairs
    'WMATIC-USDC': 500, // 0.05% for stable pairs
    'WBTC-USDC': 3000,  // 0.3% for standard pairs
    // Default to 0.3% (3000) if not specified
  };

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
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Initialize MulticallProvider - using the project's implementation instead of our adapter
    // Import and use the actual MulticallProvider from the project
    this.multicallProvider = new MulticallProvider(this.provider);
    
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    
    // Initialize contracts
    this.flashLoanContract = new ethers.Contract(
      this.flashLoanAddress,
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

    // Initialize core services - these should be imported from your services directory
    this.tokenService = new TokenService(this.multicallProvider, this.provider);
    this.dexService = new DEXService(this.multicallProvider, config, this.provider);
    this.metrics = new PerformanceMetrics();

    // Initialize stack integrator
    // Assuming StackIntegrator doesn't accept constructor params, configure it directly
    this.stackIntegrator = new StackIntegrator();
    
    // Configure stack integrator properties if needed
    if (this.options.keystoneActivation !== undefined) {
      (this.stackIntegrator as any).keystoneActivation = Boolean(this.options.keystoneActivation);
    }
    if (this.options.tiDominantWeight !== undefined) {
      (this.stackIntegrator as any).tiDominantWeight = Number(this.options.tiDominantWeight);
    }
    if (this.options.neDominantWeight !== undefined) {
      (this.stackIntegrator as any).neDominantWeight = Number(this.options.neDominantWeight);
    }
    if (this.options.entropy !== undefined) {
      (this.stackIntegrator as any).entropy = Number(this.options.entropy);
    }

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start ArbitrageBot: ${errorMessage}`);
      this.emit('error', {operation: 'start', error: new Error(errorMessage)});
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
    try {
      // Initialize tokens
      await this.tokenService.loadTokens(config.TOKENS);
      
      // Initialize DEX routers
      await this.dexService.initializeDEXs();
      
      // Warm up token pair cache
      await this.tokenService.preloadCommonPairs(config.TOKEN_PAIRS);
      
      logger.info('Services initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize services: ${errorMessage}`);
      throw new Error(`Service initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Setup websocket subscription for new blocks
   */
  private async setupBlockSubscription(): Promise<void> {
    if (!this.wsRpcUrl) {
      throw new Error('WebSocket RPC URL not provided');
    }

    try {
      const wsProvider = new ethers.WebSocketProvider(this.wsRpcUrl);
      
      // Ensure connection is established
      await wsProvider.getBlockNumber();
      
      wsProvider.on('block', async (blockNumber) => {
        if (this.shouldSkipDetection()) return;
        
        logger.debug(`New block detected: ${blockNumber}`);
        this.lastDetectionTime = Date.now();
        this.checkArbitrageOpportunities(blockNumber)
          .catch(error => this.handleError('block detection', error));
      });
      
      this.blockSubscription = wsProvider;
      logger.info('Block subscription established');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to setup WebSocket connection: ${errorMessage}`);
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
      try {
        const blockNumber = await this.provider.getBlockNumber();
        this.checkArbitrageOpportunities(blockNumber)
          .catch(error => this.handleError('interval detection', error));
      } catch (error) {
        this.handleError('block number retrieval', error);
      }
    }, config.DETECTION_INTERVAL || 15000);
    
    const interval = config.DETECTION_INTERVAL || 15000;
    logger.info(`Interval-based detection started with ${interval}ms frequency`);
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
      
      // Phase 1: Generate pairs and tokens
      const { pairs, tokens } = await this.generatePairsAndTokens();
      
      // Phase 2: Generate potential arbitrage cycles using Ti stack optimization
      const cycles = this.generateArbitrageCycles(tokens);
      
      // Phase 3: Evaluate cycles for profit potential
      const opportunities = await this.evaluateCycles(cycles, pairs);
      
      // Phase 4: Execute profitable arbitrage if found
      if (opportunities.length > 0) {
        // Sort by profitability
        const sortedOpportunities = opportunities.sort((a, b) => {
          const aProfit = a[0]?.profitPercentage ?? 0;
          const bProfit = b[0]?.profitPercentage ?? 0;
          return bProfit - aProfit;
        });
        
        // Log top opportunities
        this.logTopOpportunities(sortedOpportunities);
        
        // Find best opportunity 
        // If StackIntegrator doesn't have evaluate method, use the local one
        const allQuotes = sortedOpportunities.flatMap(group => group);
        const best = this.evaluateBestOpportunity(allQuotes, sortedOpportunities);
        
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
      const maxPairs = config.MAX_PAIRS_TO_USE || 400;
      const pairs = prioritizedPairs.slice(0, maxPairs);
      
      // Extract unique tokens from pairs
      const allTokens = Array.from(new Set(
        pairs.flatMap(p => [
          p.baseToken.toLowerCase(),
          p.quoteToken.toLowerCase()
        ])
      ));
      
      // Prioritize tokens
      const maxTokens = config.MAX_TOKENS_TO_CONSIDER || 40;
      const tokens = allTokens.slice(0, maxTokens);
      
      logger.info(`Generated ${pairs.length} pairs with ${tokens.length} unique tokens`);
      this.metrics.endOperation('pairGeneration');
      return { pairs, tokens };
    } catch (error) {
      this.metrics.endOperation('pairGeneration', false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate pairs and tokens: ${errorMessage}`);
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
      const cycleLengths = config.CYCLE_LENGTHS || [3, 4];
      
      for (const cycleLength of cycleLengths) {
        const cycles = this._generateCyclesOfLength(tokens, cycleLength);
        // Store in map
        cyclesByLength.set(cycleLength, cycles);
        // Add to overall list with limit
        const maxCyclesPerLength = config.MAX_CYCLES_PER_LENGTH || 1000;
        allCycles = allCycles.concat(
          cycles.slice(0, maxCyclesPerLength)
        );
        
        const maxCycles = config.MAX_CYCLES || 2000;
        if (allCycles.length >= maxCycles) {
          break;
        }
      }

      // Randomize a portion of results to encourage exploration
      const explorationRatio = 0.1;
      const explorationCount = Math.floor(allCycles.length * explorationRatio);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to generate arbitrage cycles: ${errorMessage}`);
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
    // Define usedTokens set
    const usedTokens = new Set<string>();
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
          // Check if DEX service has liquidity checking method
          const hasLiquidity = typeof this.dexService.hasLiquidity === 'function' 
            ? this.dexService.hasLiquidity(lastToken, firstToken)
            : true; // Assume liquidity exists if method not available
          
          if (hasLiquidity) {
            const pathCopy = [...beam.path, firstToken];
            // Get liquidity score if method available
            const liquidityScore = typeof this.dexService.getPairLiquidityScore === 'function'
              ? this.dexService.getPairLiquidityScore(lastToken, firstToken)
              : 0.5; // Default score if method not available
            
            const newScore = beam.score + liquidityScore;
            candidates.push({ path: pathCopy, score: newScore });
          }
          continue;
        }

        // Get candidate next tokens with liquidity
        const candidateTokens = tokens.filter(token =>
          !beam.path.includes(token) &&
          !usedTokens.has(token) && 
          (typeof this.dexService.hasLiquidity === 'function' 
            ? this.dexService.hasLiquidity(lastToken, token)
            : true) // Assume liquidity exists if method not available
        );
        // Generate next beam candidates
        for (const token of candidateTokens) {
          // Get liquidity score if method available
          const pairLiquidityScore = typeof this.dexService.getPairLiquidityScore === 'function'
            ? this.dexService.getPairLiquidityScore(lastToken, token)
            : 0.5; // Default score if method not available
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
        !usedTokens.has(token) && (
          typeof this.dexService.hasLiquidity === 'function'
            ? this.dexService.hasLiquidity(lastToken, token)
            : true // Assume liquidity exists if method not available
        )
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
        const maxProfitableCycles = config.MAX_PROFITABLE_CYCLES || 20;
        if (profitableCycles.length >= maxProfitableCycles) {
          logger.debug(`Reached maximum profitable cycles (${maxProfitableCycles}), stopping evaluation`);
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
            if (quotes[0] && quotes[0].from && quotes[0].to) {
              const pairKey = `${quotes[0].from}-${quotes[0].to}`;
              this.updatePairScore(pairKey, true);
            }
          }
        }

        // Update progress
        processedCycles += batch.length;
        const progressInterval = config.PROGRESS_INTERVAL || 50;
        if (processedCycles % progressInterval === 0 || processedCycles === cycles.length) {
          logger.info(`Processed ${processedCycles}/${cycles.length} cycles (${profitableCycles.length} profitable)`);
        }
      }

      logger.info(`Found ${profitableCycles.length} profitable arbitrage opportunities`);
      this.metrics.endOperation('cycleEvaluation');
      return profitableCycles;
    } catch (error) {
      this.metrics.endOperation('cycleEvaluation', false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to evaluate cycles: ${errorMessage}`);
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
      const testAmounts = config.TEST_AMOUNTS || [
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        ethers.parseEther("1000")
      ];
      
      for (const amountIn of testAmounts) {
        let currentAmount = amountIn;
        const cycleQuotes: DEXQuotes[] = [];
        let cycleBroken = false;
        
        // Evaluate each hop in the cycle
        for (let i = 0; i < cycle.length - 1; i++) {
          const from = cycle[i];
          const to = cycle[i + 1];
          try {
            // Get quotes from multiple DEXes
            // Convert currentAmount from string to bigint
            const amountInBigInt = BigInt(currentAmount.toString());
            const quoteResult = await this.dexService.getBestQuote(from, to, amountInBigInt);
            if (!quoteResult || !quoteResult.bestQuote) {
              cycleBroken = true;
              break;
            }

            // Construct DEXQuotes object with required properties
            // Create a DEXQuotes object with the correct structure
            const dexQuote: DEXQuotes = {
              pair: `${from}-${to}`,
              from,
              to,
              baseToken: this.tokenService.getTokenByAddress(from) as Token,
              quoteToken: this.tokenService.getTokenByAddress(to) as Token,
              amountIn: BigInt(currentAmount.toString()),
              quickswap: {
                forwardOut: 0n,
                reverseOut: 0n
              },
              sushiswap: {
                forwardOut: 0n,
                reverseOut: 0n
              },
              entropyFactor: 0.95 + Math.random() * 0.05,
              // Make amountOut explicitly a bigint or undefined
              amountOut: quoteResult.bestQuote.amountOut 
                ? typeof quoteResult.bestQuote.amountOut === 'bigint' 
                  ? quoteResult.bestQuote.amountOut
                  : BigInt(quoteResult.bestQuote.amountOut.toString()) 
                : undefined
            };
            
            // Update with actual DEX quotes - ensure we convert to bigint
            if (quoteResult.bestQuote.dex === 'quickswap') {
              // Make sure amountOut is a bigint
              const amountOut = typeof quoteResult.bestQuote.amountOut === 'bigint' 
                ? quoteResult.bestQuote.amountOut 
                : BigInt(quoteResult.bestQuote.amountOut?.toString() || '0');
              dexQuote.quickswap.forwardOut = amountOut;
            } else if (quoteResult.bestQuote.dex === 'sushiswap') {
              // Make sure amountOut is a bigint
              const amountOut = typeof quoteResult.bestQuote.amountOut === 'bigint' 
                ? quoteResult.bestQuote.amountOut 
                : BigInt(quoteResult.bestQuote.amountOut?.toString() || '0');
              dexQuote.sushiswap.forwardOut = amountOut;
            }

            // Add to cycle quotes
            cycleQuotes.push(dexQuote);
            
            // Update current amount for next hop - ensure we have a bigint
            const nextAmount = typeof quoteResult.bestQuote.amountOut === 'bigint' 
              ? quoteResult.bestQuote.amountOut 
              : BigInt(quoteResult.bestQuote.amountOut?.toString() || '0');
            currentAmount = nextAmount.toString();
          } catch (error) {
            cycleBroken = true;
            break;
          }
        }

        // If cycle completed successfully, check profitability
        if (!cycleBroken && cycleQuotes.length === cycle.length - 1) {
          // Calculate total profit
          const initialAmount = cycleQuotes[0].amountIn;
          const finalAmount = cycleQuotes[cycleQuotes.length - 1].amountOut || 0n;
          
          if (finalAmount > initialAmount) {
            // Mark as profitable
            const profit = finalAmount - initialAmount;
            const profitPercentage = parseFloat(
              ethers.formatEther(profit * 10000n / initialAmount)
            ) / 100;
            
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`Error evaluating cycle: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Check if a cycle is profitable above threshold
   */
  private isCycleProfitable(quotes: DEXQuotes[]): boolean {
    if (quotes.length === 0 || !quotes[0]) return false;
    
    const profitPercentage = quotes[0].profitPercentage;
    if (profitPercentage === undefined) return false;
    
    const minProfitPercentage = config.MIN_PROFIT_PERCENTAGE || 0.05;
    return profitPercentage >= minProfitPercentage;
  }

  /**
   * Log top arbitrage opportunities
   */
  private logTopOpportunities(opportunities: DEXQuotes[][]): void {
    logger.info('Top arbitrage opportunities:');
    const topCount = Math.min(3, opportunities.length);
    
    for (let i = 0; i < topCount; i++) {
      const opportunity = opportunities[i];
      if (!opportunity || opportunity.length === 0 || !opportunity[0] || opportunity[0].profitPercentage === undefined) {
        continue;
      }
      logger.info(` ${i+1}. Profit: ${opportunity[0].profitPercentage.toFixed(4)}% - Path: ${this.formatPath(opportunity)}`);
    }
  }

  /**
   * Format a path for logging
   */
  private formatPath(quotes: DEXQuotes[]): string {
    if (!Array.isArray(quotes) || quotes.length === 0 || !quotes[0]) {
      return "Empty path";
    }
    
    const path = [this.tokenService.getTokenSymbol(quotes[0].from || '')];
    for (const quote of quotes) {
      if (quote && quote.to) {
        path.push(this.tokenService.getTokenSymbol(quote.to || ''));
      }
    }
    
    return path.join(" → ");
  }

  /**
   * Evaluate best opportunity using stack integration
   * This is a replacement for stackIntegrator.evaluate that was missing
   */
  private evaluateBestOpportunity(quotes: DEXQuotes[], opportunities: DEXQuotes[][]): DEXQuotes | null {
    // Implement a basic evaluation logic that would normally be in StackIntegrator
    if (!quotes || quotes.length === 0) return null;
    
    // Sort by profit percentage
    const sortedQuotes = [...quotes].filter(q => q.profitPercentage !== undefined)
      .sort((a, b) => (b.profitPercentage || 0) - (a.profitPercentage || 0));
    
    if (sortedQuotes.length === 0) return null;
    
    // Apply additional qualification criteria
    const qualifiedQuotes = sortedQuotes.filter(quote => {
      // Minimum profit threshold
      const minProfitThreshold = config.MIN_PROFIT_THRESHOLD || 0.5;
      if ((quote.profitPercentage || 0) < minProfitThreshold) return false;
      
      // Check token liquidity
      // Check if DEX service has the hasLiquidity method
      const hasLiquidity = typeof this.dexService.hasLiquidity === 'function'
        ? this.dexService.hasLiquidity(quote.from, quote.to)
        : true; // Default to true if method doesn't exist
      if (!hasLiquidity) return false;
      
      // Add more criteria as needed
      
      return true;
    });
    
    return qualifiedQuotes.length > 0 ? qualifiedQuotes[0] : null;
  }

  /**
   * Execute arbitrage transaction
   * Uses quantum stack integration for optimized execution path
   */
  private async executeArbitrage(quotes: DEXQuotes): Promise<boolean> {
    if (this.executionInProgress) {
      logger.warn('Arbitrage execution already in progress, skipping');
      return false;
    }

    this.executionInProgress = true;
    this.metrics.startOperation('arbitrageExecution');
    
    try {
      if (!quotes.pair || !quotes.profitPercentage) {
        throw new Error('Invalid quotes object, missing required properties');
      }
      
      logger.info(`Executing arbitrage: ${quotes.pair} with projected profit ${quotes.profitPercentage}%`);
      
      // Apply Ti stack logical verification - Use direct method if not available in StackIntegrator
      const isLogicallyConsistent = this.validateLogicalConsistency({
        path: [quotes.from, quotes.to],
        profit: quotes.profitPercentage,
        entropyFactor: quotes.entropyFactor
      });
      
      if (!isLogicallyConsistent) {
        logger.info('Opportunity failed logical consistency verification');
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }
      
      // Analyze opportunity using direct method if not available in StackIntegrator
      const strategy = this.analyzeOpportunity(quotes);
      
      if (!strategy || strategy.profitPercentage < (config.MIN_PROFIT_THRESHOLD || 0.5)) {
        logger.info('Opportunity no longer profitable after analysis');
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }

      // Apply Ne stack for creative execution optimization
      const executionParams = this.optimizeExecutionParameters({
        strategy,
        blockNumber: await this.provider.getBlockNumber(),
        gasPrice: await this.provider.getFeeData().then(data => data.gasPrice || 0n),
        networkCongestion: await this.getNetworkCongestion(),
        maxSlippage: config.SLIPPAGE_TOLERANCE || 100 // 1% default
      });

      // Get USD value of profit using Si stack for experiential validation
      const profitUsd = await this.getUsdValue(
        strategy.baseToken.address,
        strategy.estimatedProfit
      );
      
      logger.info(`Estimated profit: $${profitUsd.toFixed(2)}`);
      
      // Check if profit meets minimum threshold in USD with margin for gas costs
      const minProfitUsd = config.MIN_PROFIT_USD || 1.0;
      if (profitUsd < minProfitUsd * executionParams.profitMarginFactor) {
        logger.info(`Profit $${profitUsd.toFixed(2)} below adjusted threshold $${(minProfitUsd * executionParams.profitMarginFactor).toFixed(2)}`);
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }

      // Encode data for flash loan with Te stack optimization
      const encodedData = this.encodeStrategyData(strategy);
      
      // Apply gas optimization with Te stack
      const gasLimit = executionParams.gasLimit || BigInt(config.GAS_LIMIT || 2000000);
      const optimizedGasPrice = executionParams.gasPrice || await this.provider.getFeeData().then(data => data.gasPrice || 0n);
      
      // Apply keystone integration for final validation
      const executionApproved = this.approveExecution({
        strategy,
        gasPrice: optimizedGasPrice,
        gasLimit,
        deadline: Math.floor(Date.now() / 1000) + 300, // 5 minutes
        networkConditions: {
          blockNumber: await this.provider.getBlockNumber(),
          congestion: await this.getNetworkCongestion()
        }
      });
      
      if (!executionApproved) {
        logger.info('Execution rejected by keystone validation');
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }
      
      // Execute the transaction with quantum-optimized parameters
      logger.info(`Submitting transaction with gas price ${ethers.formatUnits(optimizedGasPrice, 'gwei')} gwei, gas limit ${gasLimit.toString()}`);
      
      const tx = await this.flashLoanContract.executeArbitrage(
        strategy.baseToken.address,
        strategy.flashLoanAmount,
        encodedData,
        strategy.strategyHash,
        {
          gasPrice: optimizedGasPrice,
          gasLimit
        }
      );

      logger.info(`Transaction submitted: ${tx.hash}`);
      
      // Wait for transaction confirmation with timeout
      const receipt = await Promise.race([
        tx.wait(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60000)) // 60 second timeout
      ]);
      
      if (!receipt) {
        logger.warn(`Transaction confirmation timeout after 60 seconds: ${tx.hash}`);
        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution', false);
        return false;
      }
      
      // Process results
      if (receipt.status === 1) {
        // Transaction successful
        logger.info(`Arbitrage executed successfully in block ${receipt.blockNumber}`);
        
        // Parse events to get actual profit with Fe stack integration for event analysis
        const arbitrageEvent = receipt.logs
          .map((log: any) => {
            try {
              return this.flashLoanContract.interface.parseLog({
                topics: log.topics as string[],
                data: log.data
              });
            } catch (e) {
              return null;
            }
          })
          .find((parsedLog: any) => parsedLog && parsedLog.name === 'ArbitrageExecuted');
        
        if (arbitrageEvent && arbitrageEvent.args) {
          const actualProfit = ethers.formatEther(arbitrageEvent.args.profit);
          const actualProfitUsd = strategy.baseToken.priceUsd 
            ? (parseFloat(actualProfit) * strategy.baseToken.priceUsd).toFixed(2)
            : 'unknown';
            
            executionTime: Date.now() - this.lastDetectionTime,
          
          // Update with execution results
          this.updateWithExecutionResults({
            strategy,
            success: true,
            actualProfit: parseFloat(actualProfit),
            executionTime: Date.now() - this.lastDetectionTime,
            gasUsed: receipt.gasUsed?.toString() || '0'
          });
          
          // Update pair scores with actual result using reinforcement learning
          const pairKey = `${strategy.baseToken.address}-${strategy.quoteToken.address}`;
          this.updatePairScore(pairKey, true, parseFloat(actualProfit));
          
          // Emit execution event
          this.emit('execution', {
            strategy,
            success: true,
            profit: actualProfit
          });
        }

        this.executionInProgress = false;
        this.metrics.endOperation('arbitrageExecution');
        return true;
      } else {
        // Transaction failed
          executionTime: Date.now() - this.lastDetectionTime,
        
        // Learn from failure with Fi stack value-based analysis
        this.updateWithExecutionResults({
          strategy,
          success: false,
          failureReason: 'transaction_reverted',
          executionTime: Date.now() - this.lastDetectionTime,
          gasUsed: receipt.gasUsed?.toString() || '0'
        });
        
        // Update pair scores with failure
        const pairKey = `${strategy.baseToken.address}-${strategy.quoteToken.address}`;
        this.updatePairScore(pairKey, false);
        
        // Emit execution event
        this.emit('execution', {
          strategy,
          success: false
        });
        
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
   * Handle errors with logging and event emission
   */
  private handleError(operation: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in ${operation}: ${errorMessage}`);
    this.emit('error', { operation, error: new Error(errorMessage) });
  }

  /**
   * Validate logical consistency of an arbitrage opportunity
   */
  private validateLogicalConsistency(params: {
    path: string[];
    profit: number;
    entropyFactor: number;
  }): boolean {
    // Basic validation
    if (!params.path || params.path.length < 2) {
      return false;
    }
    
    // Profit threshold check with entropy factor
    const adjustedThreshold = (config.MIN_PROFIT_THRESHOLD || 0.5) * params.entropyFactor;
    if (params.profit < adjustedThreshold) {
      return false;
    }
    
    // Add additional validation logic as needed
    return true;
  }

  /**
   * Analyze arbitrage opportunity and convert to strategy
   */
  private analyzeOpportunity(quotes: DEXQuotes): ArbitrageStrategy | null {
    if (!quotes || !quotes.pair) {
      return null;
    }
    
    try {
      // Extract tokens
      const baseToken = quotes.baseToken;
      const quoteToken = quotes.quoteToken;
      
      if (!baseToken || !quoteToken) {
        return null;
      }
      
      // Create a strategy hash
      const strategyHash = ethers.keccak256(
        ethers.toUtf8Bytes(`${quotes.pair}-${Date.now()}`)
      );
      
      // Calculate optimal input amount (this is simplified)
      const flashLoanAmount = quotes.amountIn || ethers.parseEther("10");
      const estimatedProfit = quotes.profitPercentage 
        ? (flashLoanAmount * BigInt(Math.floor(quotes.profitPercentage * 100))) / 10000n
        : 0n;
      
      return {
        pair: quotes.pair,
        baseToken,
        quoteToken,
        dex1: 'quickswap',
        dex2: 'sushiswap',
        path1: [baseToken.address, quoteToken.address],
        path2: [quoteToken.address, baseToken.address],
        amountIn: quotes.amountIn || 0n,
        flashLoanAmount,
        minAmountOut: flashLoanAmount + (flashLoanAmount * 5n / 1000n), // 0.5% min profit
        estimatedProfit,
        profitPercentage: quotes.profitPercentage || 0,
        profitUsd: 0, // Will be calculated later
        optimalPathScore: 0.8,
        strategyHash,
        entropyFactor: quotes.entropyFactor || 1.0
      };
    } catch (error) {
      logger.error(`Error analyzing opportunity: ${error}`);
      return null;
    }
  }

  /**
   * Optimize execution parameters based on current conditions
   */
  private optimizeExecutionParameters(params: {
    strategy: ArbitrageStrategy;
    blockNumber: number;
    gasPrice: bigint;
    networkCongestion: number;
    maxSlippage: number;
  }): {
    gasPrice: bigint;
    gasLimit: bigint;
    deadline: number;
    profitMarginFactor: number;
  } {
    // Default values
    let optimizedGasPrice = params.gasPrice;
    let gasLimit = BigInt(config.GAS_LIMIT || 2000000);
    let profitMarginFactor = 1.0;
    
    // Adjust gas price based on network congestion
    if (params.networkCongestion > 0.8) {
      // High congestion - increase gas price for faster inclusion
      optimizedGasPrice = (optimizedGasPrice * 12n) / 10n; // +20%
      profitMarginFactor = 1.2; // Require higher profit
    } else if (params.networkCongestion > 0.5) {
      // Medium congestion
      optimizedGasPrice = (optimizedGasPrice * 11n) / 10n; // +10%
      profitMarginFactor = 1.1;
    }
    
    // Ensure gas price doesn't exceed maximum
    const maxGasPrice = ethers.parseUnits(this.MAX_GAS_PRICE, "gwei");
    if (optimizedGasPrice > maxGasPrice) {
      optimizedGasPrice = maxGasPrice;
    }
    
    // Set appropriate deadline
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    
    return {
      gasPrice: optimizedGasPrice,
      gasLimit,
      deadline,
      profitMarginFactor
    };
  }

  /**
   * Get current network congestion level (0-1)
   */
  private async getNetworkCongestion(): Promise<number> {
    try {
      // Get current gas price
      const gasPrice = await this.provider.getFeeData().then(data => data.gasPrice || 0n);
      
      // Convert to gwei for easier calculation
      const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, "gwei"));
      
      // Calculate congestion relative to max gas price
      const maxGasPriceGwei = parseFloat(this.MAX_GAS_PRICE);
      const congestion = Math.min(gasPriceGwei / maxGasPriceGwei, 1.0);
      
      return congestion;
    } catch (error) {
      logger.warn(`Error getting network congestion: ${error}`);
      return 0.5; // Default to medium congestion on error
    }
  }

  /**
   * Get USD value of token amount
   */
  private async getUsdValue(tokenAddress: string, amount: bigint): Promise<number> {
    try {
      const token = this.tokenService.getTokenByAddress(tokenAddress);
      if (!token || token.priceUsd === undefined) {
        return 0;
      }
      
      // Convert amount to decimal representation
      const amountDecimal = parseFloat(ethers.formatUnits(amount, token.decimals));
      
      // Calculate USD value
      return amountDecimal * token.priceUsd;
    } catch (error) {
      logger.warn(`Error getting USD value: ${error}`);
      return 0;
    }
  }

  /**
   * Encode strategy data for flash loan contract
   */
  private encodeStrategyData(strategy: ArbitrageStrategy): string {
    try {
      // Create encoded data for flash loan execution
      // This would depend on your specific contract implementation
      const abiCoder = new ethers.AbiCoder();
      
      // Example encoding - adjust based on your contract's expected format
      const encodedData = abiCoder.encode(
        ['address', 'address', 'uint256', 'address[]', 'address[]'],
        [
          strategy.baseToken.address,
          strategy.quoteToken.address,
          strategy.flashLoanAmount,
          strategy.path1,
          strategy.path2
        ]
      );
      
      return encodedData;
    } catch (error) {
      logger.error(`Error encoding strategy data: ${error}`);
      throw new Error(`Failed to encode strategy data: ${error}`);
    }
  }

  /**
   * Final approval check before execution
   */
  private approveExecution(params: {
    strategy: ArbitrageStrategy;
    gasPrice: bigint;
    gasLimit: bigint;
    deadline: number;
    networkConditions: {
      blockNumber: number;
      congestion: number;
    };
  }): boolean {
    // Check for minimum profit after gas costs
    const estimatedGasCost = params.gasPrice * params.gasLimit;
    
    // Estimate gas cost in token units (very simplified)
    // In a real implementation, you would convert ETH gas cost to token units
    const estimatedGasCostInToken = estimatedGasCost / 1000000000000000000n; // Approximate division
    
    if (params.strategy.estimatedProfit <= estimatedGasCostInToken * 2n) {
      logger.info(`Estimated profit too low compared to gas costs`);
      return false;
    }
    
    // Check network conditions
    if (params.networkConditions.congestion > 0.9) {
      logger.info(`Network congestion too high (${params.networkConditions.congestion.toFixed(2)})`);
      return false;
    }
    
    // Check slippage risk based on volatility
    // (This is a placeholder - real implementation would be more sophisticated)
    const slippageRisk = Math.random(); // Simplified random risk assessment
    if (slippageRisk > 0.7) {
      logger.info(`Slippage risk too high (${slippageRisk.toFixed(2)})`);
      return false;
    }
    
    // Additional safety checks as needed
    
    return true;
  }

  /**
   * Update metrics and learning models with execution results
   */
  private updateWithExecutionResults(params: {
    strategy: ArbitrageStrategy;
    success: boolean;
    actualProfit?: number;
    failureReason?: string;
    executionTime: number;
    gasUsed: string;
  }): void {
    // Update performance metrics
    // Update metrics using available methods
    // Track this as a completed operation with success flag
    const operationId = `executionOp-${Date.now()}`;
    this.metrics.startOperation('arbitrageExecution');
    this.metrics.endOperation('arbitrageExecution', params.success, operationId);
    
    // Log additional data that would normally be recorded
    const executionTime = Date.now() - this.lastDetectionTime;
    logger.info(`Execution stats - Success: ${params.success}, Time: ${executionTime}ms, Gas: ${params.gasUsed || '0'}`);
    
    if (params.success && params.actualProfit !== undefined) {
      // Log profit info
      logger.info(`Profit realized: ${params.actualProfit}`);
      
      // Update strategy score for this pair
      const pairKey = `${params.strategy.baseToken.address}-${params.strategy.quoteToken.address}`;
      this.updatePairScore(pairKey, true, params.actualProfit);
      
      logger.info(`Successful execution recorded: ${params.actualProfit} profit, ${params.executionTime}ms execution time`);
    } else if (params.failureReason) {
      logger.warn(`Failed execution recorded: ${params.failureReason}`);
      
      // Update failure statistics
      // Log failure
      logger.warn(`Execution failure: ${params.failureReason}`);
      // Track failure as a completed operation with false success flag
      const failureOpId = `failureOp-${Date.now()}`;
      this.metrics.startOperation('executionFailure');
      this.metrics.endOperation('executionFailure', false, failureOpId);
      
      // Reduce score for this pair
      const pairKey = `${params.strategy.baseToken.address}-${params.strategy.quoteToken.address}`;
      this.updatePairScore(pairKey, false);
    }
  }
}
