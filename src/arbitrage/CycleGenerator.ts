// src/arbitrage/CycleGenerator.ts
import { logger } from '../utils/Logger';
import { TokenService } from '../services/TokenService';
import { DEXService } from '../services/DEXService';
import { config } from '../config/Config';

export class CycleGenerator {
  private pathCache: Map<string, { timestamp: number; paths: string[][] }> = new Map();
  private cacheValidityPeriod = 30 * 1000; // 30 seconds
  private totalCyclesGenerated = 0;
  private cacheHits = 0;
  
  constructor(
    private tokenService: TokenService,
    private dexService: DEXService
  ) {
    logger.debug('CycleGenerator initialized');
  }

  /**
   * Generate potential arbitrage cycles from token list
   */
  public generateCycles(tokens: string[]): string[][] {
    logger.debug(`Generating arbitrage cycles from ${tokens.length} tokens`);
    this.totalCyclesGenerated++;
    
    try {
      // Check cache first
      const cacheKey = tokens.slice(0, 20).join('-');
      const cachedPaths = this.pathCache.get(cacheKey);
      
      if (cachedPaths && (Date.now() - cachedPaths.timestamp) < this.cacheValidityPeriod) {
        this.cacheHits++;
        logger.debug(`Using cached cycles (${cachedPaths.paths.length} cycles)`);
        return cachedPaths.paths;
      }

      // Generate cycles for different cycle lengths
      let allCycles: string[][] = [];
      const cycleLengths = config.CYCLE_LENGTHS || [3, 4];
      
      for (const cycleLength of cycleLengths) {
        const cycles = this.generateCyclesOfLength(tokens, cycleLength);
        
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

      // Randomize a portion of results for exploration
      const explorationRatio = config.EXPLORATION_RATIO || 0.1;
      const explorationCount = Math.floor(allCycles.length * explorationRatio);
      
      if (explorationCount > 0) {
        const explorationIndices = new Set<number>();
        while (explorationIndices.size < explorationCount) {
          explorationIndices.add(Math.floor(Math.random() * allCycles.length));
        }

        // Replace selected indices with random cycles
        for (const index of explorationIndices) {
          const cycleLength = allCycles[index].length;
          const randomCycle = this.generateRandomCycle(tokens, cycleLength);
          allCycles[index] = randomCycle;
        }
      }

      // Cache the results
      this.pathCache.set(cacheKey, {
        timestamp: Date.now(),
        paths: allCycles
      });
      
      logger.info(`Generated ${allCycles.length} potential arbitrage cycles`);
      return allCycles;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate arbitrage cycles: ${errorMessage}`);
      // Return empty array rather than throwing to allow the algorithm to continue
      return [];
    }
  }

  /**
   * Generate cycles of specific length using beam search
   */
  private generateCyclesOfLength(tokens: string[], cycleLength: number): string[][] {
    if (cycleLength < 3) return [];
    
    // Setup beam search parameters
    const beamWidth = 25 * cycleLength;
    let beams: { path: string[]; score: number }[] = [];

    // First token selection - prioritize stablecoins and major tokens
    const stablecoins = tokens.filter(t =>
      this.tokenService.isStablecoin(t) || this.tokenService.isMajorToken(t)
    );
    
    const startTokens = stablecoins.length > 0 ? stablecoins : tokens.slice(0, 10);
    for (const token of startTokens) {
      beams.push({
        path: [token],
        score: this.tokenService.getTokenWeight(token)
      });
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
          
          // Apply market conditions factor
          const marketFactor = 0.95 + Math.random() * 0.1;
          const newScore = (beam.score + pairLiquidityScore * tokenWeight) * marketFactor;
          
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
  private generateRandomCycle(tokens: string[], cycleLength: number): string[] {
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
        return this.generateRandomCycle(tokens, cycleLength);
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
      return this.generateRandomCycle(tokens, cycleLength);
    }

    return cycle;
  }

  /**
   * Get generator statistics
   */
  public getStatistics(): any {
    return {
      totalCyclesGenerated: this.totalCyclesGenerated,
      cacheHits: this.cacheHits,
      cacheHitRate: this.totalCyclesGenerated > 0 
        ? (this.cacheHits / this.totalCyclesGenerated) 
        : 0,
      cachedPaths: this.pathCache.size
    };
  }
}