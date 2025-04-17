import { ethers } from "ethers";
import fetch from "node-fetch";
import { StackIntegrator } from '../stacks/StackIntegrator';
import { logger } from '../utils/Logger';

const ROUTER_ABI = require('../../abis/RouterABI.json');
const QUICKSWAP_ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';
const SUSHISWAP_ROUTER = '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506';
const UNISWAP_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';

// Extended token addresses on Polygon
const TOKEN_ADDRESSES = {
  // Stablecoins
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  DAI: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  FRAX: '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89',
  BUSD: '0xdAb529f40E671A1D4bF91361c21bf9f0C9712ab7',
  TUSD: '0x2e1AD108fF1D8C782fcBbB89AAd783aC49586756',
  MAI: '0xa3Fa99A148fA48D14Ed51d610c367C61876997F1',
  
  // Major tokens
  WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  WBTC: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  WAVAX: '0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b',
  WSOL: '0x7DfF46370e9eA5f0Bad3C4E29711aD50062EA7A4',
  
  // DeFi tokens
  QUICK: '0xB5C064F955D8e7F38fE0460C556a72987494eE17',
  SUSHI: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a',
  AAVE: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B',
  BAL: '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3',
  CRV: '0x172370d5Cd63279eFa6d502DAB29171933a610AF',
  LINK: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39',
  UNI: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f',
  SNX: '0x50B728D8D964fd00C2d0AAD81718b71311feF68a',
  AXL: '0x6e4e624106cb12e168e6533f8ec7c82263358940',
  COMP: '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c',

  // NFT/Gaming tokens
  SAND: '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683',
  MANA: '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4',
  AXS: '0x61BDD9C7d4dF4Bf47A4508c0c8245505F2Af5b7b',
  ENJ: '0x7eC26842F195c852Fa843bB9f6D8B583a274a157',
  GHST: '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7',
  
  // Additional tokens on Polygon
  RNDR: '0x61299774020dA444Af134c82fa83E3810b309991',
  GRT: '0x5fe2B58c013d7601147DcdD68C143A77499f5531',
  LDO: '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756',
  RPL: '0x7205705771547cF79201111B4761134BD6Deb1dd',
  MKR: '0x6f7C932e7684666C9fd1d44527765433e01fF61d',
  FXS: '0x1a3acf6D19267E2d3e7f898f42803e90C9219062',
  CVX: '0x4257EA7637c355F81616050CbB6a9b709c0f2006',
  DYDX: '0x4c3bF0a3DE9524aF68327d1D2558a3B70d17D42a',
};

export class ArbitrageBot {
  private stackIntegrator = new StackIntegrator();
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private quickswap: ethers.Contract;
  private sushiswap: ethers.Contract;
  
  // Configuration for cycle limits and performance
  private config = {
    maxCycles: 2000,        // Increased maximum cycles
    maxTokensToConsider: 40, // Increased token consideration
    maxPairsToUse: 400,     // Increased pairs to consider
    cycleLengths: [3, 4],   // Try both 3-token and 4-token cycles
    progressInterval: 50,   // Log progress every 50 cycles
    testAmounts: [          // Test multiple amounts
      ethers.parseUnits('10', 18),
      ethers.parseUnits('100', 18),
      ethers.parseUnits('1000', 18)
    ],
    minProfitPercentage: 0.05 // 0.05% minimum profit to consider
  };
  
  constructor(
    private flashLoanAddress: string,
    private privateKey: string,
    private rpcUrl: string
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);
    this.quickswap = new ethers.Contract(QUICKSWAP_ROUTER, ROUTER_ABI, this.wallet);
    this.sushiswap = new ethers.Contract(SUSHISWAP_ROUTER, ROUTER_ABI, this.wallet);
  }

  async start() {
    try {
      // Generate predefined pairs
      const pairs = this.generatePredefinedPairs();
      logger.info(`Using ${pairs.length} predefined pairs for arbitrage opportunities`);

      // Extract unique tokens from pairs
      const allTokens = Array.from(new Set(pairs.flatMap(p => [p.baseToken.address, p.quoteToken.address])));
      // Prioritize the most important tokens but include more
      const tokens = allTokens.slice(0, this.config.maxTokensToConsider);
      logger.info(`Found ${tokens.length} unique tokens to consider`);

      // Try different cycle lengths
      let allCycleQuotes: any[] = [];
      
      for (const cycleLength of this.config.cycleLengths) {
        // Generate potential arbitrage cycles for this length
        logger.info(`Generating cycles of length ${cycleLength}...`);
        const cycles = this.generateCycles(tokens, cycleLength);
        
        // Limit the number of cycles to check
        const limitedCycles = cycles.slice(0, this.config.maxCycles);
        logger.info(`Checking ${limitedCycles.length} potential arbitrage paths of length ${cycleLength}`);

        // Process in parallel batches for better performance
        const batchSize = 20;
        const cycleQuotes: any[] = [];
        let processedCycles = 0;
        
        for (let i = 0; i < limitedCycles.length; i += batchSize) {
          const batch = limitedCycles.slice(i, i + batchSize);
          const batchPromises = batch.map(cycle => this.getCycleQuotes(cycle));
          const batchResults = await Promise.all(batchPromises);
          
          for (const quotes of batchResults) {
            if (quotes.length && quotes.every(q => q && q.profit > 0)) {
              // Calculate profit percentage
              const totalInput = quotes[0].amountIn;
              const totalProfit = quotes.reduce((acc, q) => acc + q.profit, 0);
              const profitPercentage = (totalProfit / totalInput) * 100;
              
              // Only add if profit percentage is above threshold
              if (profitPercentage >= this.config.minProfitPercentage) {
                quotes[0].profitPercentage = profitPercentage;
                cycleQuotes.push(quotes);
              }
            }
          }
          
          processedCycles += batch.length;
          if (processedCycles % this.config.progressInterval === 0 || processedCycles === limitedCycles.length) {
            logger.info(`Processed ${processedCycles}/${limitedCycles.length} cycles of length ${cycleLength}`);
          }
        }
        
        logger.info(`Found ${cycleQuotes.length} potentially profitable cycles of length ${cycleLength}`);
        allCycleQuotes = allCycleQuotes.concat(cycleQuotes);
      }

      if (allCycleQuotes.length === 0) {
        logger.info('No profitable arbitrage opportunities found this round');
        return;
      }
      
      // Sort by profit percentage
      allCycleQuotes.sort((a, b) => b[0].profitPercentage - a[0].profitPercentage);
      
      // Log top opportunities
      logger.info(`Top opportunities:`);
      for (let i = 0; i < Math.min(3, allCycleQuotes.length); i++) {
        const opportunity = allCycleQuotes[i];
        logger.info(`  ${i+1}. Profit: ${opportunity[0].profitPercentage.toFixed(4)}% - Path: ${this.formatPath(opportunity)}`);
      }

      // Evaluate best arbitrage opportunity
      const allQuotes = allCycleQuotes.flat();
      const best = this.stackIntegrator.evaluate(allQuotes, allCycleQuotes);

      if (best) {
        logger.info(`Executing arbitrage: ${best.pair} with projected profit ${best.projectedProfit}`);
        
        // Execute the arbitrage trade
        const flashLoanContract = new ethers.Contract(
          this.flashLoanAddress,
          [
            'function executeArbitrage(address[] calldata path, uint amountIn) external',
            'function withdraw() external'
          ],
          this.wallet
        );
        
        // Extract path from best quote
        const path = this.constructPathFromQuotes(best);
        const amountIn = ethers.parseUnits((best.amountIn || 100).toString(), 18);
        
        // Execute the transaction
        const tx = await flashLoanContract.executeArbitrage(path, amountIn);
        logger.info(`Transaction submitted: ${tx.hash}`);
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);
        
        // Check if transaction was successful
        if (receipt.status === 1) {
          logger.info('Arbitrage executed successfully');
        } else {
          logger.error('Arbitrage transaction failed');
        }
      } else {
        logger.info('No stack-approved arbitrage found');
      }
    } catch (error: any) {
      logger.error(`Error in arbitrage execution: ${error?.message || 'Unknown error'}`);
    }
  }

  // Format a path for logging
  formatPath(quotes: any[]): string {
    if (!Array.isArray(quotes) || quotes.length === 0) return "Empty path";
    
    const path = [this.getTokenSymbol(quotes[0].from)];
    for (const quote of quotes) {
      path.push(this.getTokenSymbol(quote.to));
    }
    
    return path.join(" → ");
  }
  
  // Get token symbol from address
  getTokenSymbol(address: string): string {
    const addressLower = address.toLowerCase();
    for (const [symbol, addr] of Object.entries(TOKEN_ADDRESSES)) {
      if (addr.toLowerCase() === addressLower) {
        return symbol;
      }
    }
    return address.substring(0, 6) + "...";
  }

  // Extract path from quotes
  constructPathFromQuotes(bestQuote: any): string[] {
    // If it's a cycle quote, construct the full path
    if (Array.isArray(bestQuote) && bestQuote.length > 0) {
      const path = [bestQuote[0].from];
      for (const quote of bestQuote) {
        path.push(quote.to);
      }
      return path;
    }
    
    // If it's a single quote
    return [bestQuote.from, bestQuote.to];
  }

  // Generate predefined pairs based on popular stablecoins and tokens
  generatePredefinedPairs(): any[] {
    const pairs: any[] = [];
    
    // Group tokens by category
    const stablecoins = [
      TOKEN_ADDRESSES.USDC, TOKEN_ADDRESSES.USDT, TOKEN_ADDRESSES.DAI, 
      TOKEN_ADDRESSES.FRAX, TOKEN_ADDRESSES.BUSD, TOKEN_ADDRESSES.TUSD,
      TOKEN_ADDRESSES.MAI
    ];
    
    const majorTokens = [
      TOKEN_ADDRESSES.WMATIC, TOKEN_ADDRESSES.WETH, TOKEN_ADDRESSES.WBTC,
      TOKEN_ADDRESSES.WAVAX, TOKEN_ADDRESSES.WSOL
    ];
    
    const defiTokens = [
      TOKEN_ADDRESSES.QUICK, TOKEN_ADDRESSES.SUSHI, TOKEN_ADDRESSES.AAVE, 
      TOKEN_ADDRESSES.BAL, TOKEN_ADDRESSES.CRV, TOKEN_ADDRESSES.LINK,
      TOKEN_ADDRESSES.UNI, TOKEN_ADDRESSES.SNX, TOKEN_ADDRESSES.AXL,
      TOKEN_ADDRESSES.COMP, TOKEN_ADDRESSES.MKR, TOKEN_ADDRESSES.LDO,
      TOKEN_ADDRESSES.CVX, TOKEN_ADDRESSES.RPL, TOKEN_ADDRESSES.FXS
    ];
    
    const nftGameTokens = [
      TOKEN_ADDRESSES.SAND, TOKEN_ADDRESSES.MANA, TOKEN_ADDRESSES.AXS,
      TOKEN_ADDRESSES.ENJ, TOKEN_ADDRESSES.GHST
    ];
    
    const otherTokens = [
      TOKEN_ADDRESSES.RNDR, TOKEN_ADDRESSES.GRT
    ];
    
    // Generate all possible pairs between categories
    
    // Stablecoin pairs
    for (let i = 0; i < stablecoins.length; i++) {
      for (let j = i + 1; j < stablecoins.length; j++) {
        pairs.push(this.createPairObject(stablecoins[i], stablecoins[j]));
      }
    }
    
    // Major tokens with stablecoins
    for (const token of majorTokens) {
      for (const stablecoin of stablecoins) {
        pairs.push(this.createPairObject(token, stablecoin));
      }
    }
    
    // Major tokens with each other
    for (let i = 0; i < majorTokens.length; i++) {
      for (let j = i + 1; j < majorTokens.length; j++) {
        pairs.push(this.createPairObject(majorTokens[i], majorTokens[j]));
      }
    }
    
    // DeFi tokens with stablecoins and major tokens
    for (const defiToken of defiTokens) {
      for (const stablecoin of stablecoins) {
        pairs.push(this.createPairObject(defiToken, stablecoin));
      }
      
      for (const majorToken of majorTokens) {
        pairs.push(this.createPairObject(defiToken, majorToken));
      }
    }
    
    // NFT/Game tokens with stablecoins and major tokens
    for (const nftToken of nftGameTokens) {
      for (const stablecoin of stablecoins) {
        pairs.push(this.createPairObject(nftToken, stablecoin));
      }
      
      for (const majorToken of majorTokens) {
        pairs.push(this.createPairObject(nftToken, majorToken));
      }
    }
    
    // Other tokens with stablecoins and major tokens
    for (const otherToken of otherTokens) {
      for (const stablecoin of stablecoins) {
        pairs.push(this.createPairObject(otherToken, stablecoin));
      }
      
      for (const majorToken of majorTokens) {
        pairs.push(this.createPairObject(otherToken, majorToken));
      }
    }
    
    // Some DeFi tokens with each other (selected combinations)
    const popularDefiPairs = [
      [TOKEN_ADDRESSES.AAVE, TOKEN_ADDRESSES.SUSHI],
      [TOKEN_ADDRESSES.AAVE, TOKEN_ADDRESSES.CRV],
      [TOKEN_ADDRESSES.QUICK, TOKEN_ADDRESSES.SUSHI],
      [TOKEN_ADDRESSES.LINK, TOKEN_ADDRESSES.UNI],
      [TOKEN_ADDRESSES.BAL, TOKEN_ADDRESSES.AAVE],
      [TOKEN_ADDRESSES.MKR, TOKEN_ADDRESSES.AAVE],
      [TOKEN_ADDRESSES.CRV, TOKEN_ADDRESSES.CVX],
      [TOKEN_ADDRESSES.LDO, TOKEN_ADDRESSES.RPL]
    ];
    
    for (const [token1, token2] of popularDefiPairs) {
      pairs.push(this.createPairObject(token1, token2));
    }
    
    return pairs;
  }
  
  // Create a pair object with base and quote tokens
  createPairObject(address1: string, address2: string): any {
    // Sort addresses to maintain consistency
    const [baseAddress, quoteAddress] = [address1, address2].sort();
    return {
      baseToken: { address: baseAddress },
      quoteToken: { address: quoteAddress }
    };
  }
  
  // Create a unique key for a pair
  getPairKey(address1: string, address2: string): string {
    const [addr1, addr2] = [address1.toLowerCase(), address2.toLowerCase()].sort();
    return `${addr1}_${addr2}`;
  }

  generateCycles(tokens: string[], cycleLength: number): string[][] {
    const pairExists = new Map<string, boolean>();
    const self = this; // Store reference to 'this' for use in inner function
    
    function permute(path: string[], used: boolean[], depth: number): string[][] {
      // Base case: we've completed a cycle
      if (path.length === cycleLength) {
        if (path[0] === path[path.length - 1]) return [path.slice()];
        return [];
      }
      
      // Early termination: if we've generated enough cycles
      if (depth > 3 && path.length < 2) {
        return [];
      }
      
      let res: string[][] = [];
      for (let i = 0; i < tokens.length; i++) {
        // Check if this is the last element completing the cycle
        const isCompletingCycle = path.length + 1 === cycleLength && tokens[i] === path[0];
        
        // Skip if token already used (unless completing the cycle)
        if (used[i] && !isCompletingCycle) continue;
        
        // If not the first token, check if the pair exists in our known pairs
        if (path.length > 0) {
          const lastToken = path[path.length - 1];
          const pairKey = self.getPairKey(lastToken, tokens[i]);
          
          // Skip if we know this pair doesn't exist
          if (pairExists.has(pairKey) && !pairExists.get(pairKey)) {
            continue;
          }
        }
        
        used[i] = true;
        path.push(tokens[i]);
        res = res.concat(permute(path, used, depth + 1));
        path.pop();
        used[i] = false;
        
        // If we have enough cycles, stop early - increased limit
        if (res.length > 1500) break;
      }
      return res;
    }
    
    let cycles: string[][] = [];
    // Consider more starting tokens for more path diversity
    const startTokens = Math.min(15, tokens.length);
    for (let i = 0; i < startTokens; i++) {
      const used = Array(tokens.length).fill(false);
      used[i] = true;
      const newCycles = permute([tokens[i]], used, 1);
      cycles = cycles.concat(newCycles);
      
      // If we've already found enough cycles, stop - increased limit
      if (cycles.length > 2000) break;
    }
    
    return cycles;
  }

  async getCycleQuotes(cycle: string[]): Promise<any[]> {
    const quotes: any[] = [];
    for (let i = 0; i < cycle.length - 1; i++) {
      const from = cycle[i];
      const to = cycle[i + 1];
      
      // Try multiple amounts
      let bestQuote = null;
      let highestProfit = -Infinity;
      
      for (const amountIn of this.config.testAmounts) {
        try {
          let out;
          let router = "quickswap";
          
          try {
            out = await this.quickswap.getAmountsOut(amountIn, [from, to]);
          } catch (quickswapError) {
            try {
              out = await this.sushiswap.getAmountsOut(amountIn, [from, to]);
              router = "sushiswap";
            } catch (sushiswapError) {
              // If both fail, skip this amount
              continue;
            }
          }
          
          const amountInFloat = parseFloat(ethers.formatUnits(amountIn, 18));
          const amountOutFloat = parseFloat(ethers.formatUnits(out[1], 18));
          const profit = amountOutFloat - amountInFloat;
          const profitPercentage = (profit / amountInFloat) * 100;
          
          // Keep track of the best quote for this pair
          if (profit > highestProfit) {
            highestProfit = profit;
            bestQuote = {
              pair: `${from}-${to}`,
              router,
              amountIn: amountInFloat,
              amountOut: amountOutFloat,
              profit,
              profitPercentage,
              entropyFactor: 0.95 + Math.random() * 0.05,
              from, 
              to
            };
          }
        } catch (e) {
          // Skip errors for this amount
          continue;
        }
      }
      
      // If we found a quote with profit, add it
      if (bestQuote && bestQuote.profit > 0) {
        quotes.push(bestQuote);
      } else {
        // If any pair fails, the whole cycle fails
        return [];
      }
    }
    
    if (quotes.length === cycle.length - 1) {
      const totalProfit = quotes.reduce((acc, q) => acc + q.profit, 0);
      const profitPercentage = (totalProfit / quotes[0].amountIn) * 100;
      (quotes[0] as any).projectedProfit = totalProfit;
      (quotes[0] as any).profitPercentage = profitPercentage;
    }
    
    return quotes;
  }
}
