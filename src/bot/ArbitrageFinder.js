const ethers = require('ethers');
const { abi: ERC20_ABI } = require('@openzeppelin/contracts/build/contracts/ERC20.json');
const FLASH_LOAN_ABI = require('../../abis/ArbitrageCore.json');
const ROUTER_ABI = require('../../abis/Router.json');

class ArbitrageFinder {
  constructor(provider, flashLoanAddress, config) {
    this.provider = new ethers.providers.JsonRpcProvider(provider);
    this.flashLoanAddress = flashLoanAddress;
    this.config = config;
    this.isInitialized = false;
  }

  async init() {
    try {
      // Setup wallet
      this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
      console.log(`Connected to wallet: ${this.wallet.address}`);
      
      // Connect to flash loan contract
      this.flashLoanContract = new ethers.Contract(
        this.flashLoanAddress,
        FLASH_LOAN_ABI,
        this.wallet
      );
      
      // Connect to DEX routers
      this.quickswapRouter = new ethers.Contract(
        this.config.QUICKSWAP_ROUTER_ADDRESS,
        ROUTER_ABI,
        this.wallet
      );
      
      this.sushiswapRouter = new ethers.Contract(
        this.config.SUSHISWAP_ROUTER_ADDRESS,
        ROUTER_ABI,
        this.wallet
      );
      
      // Setup token map
      this.tokenMap = {};
      for (const token of this.config.TOKENS_TO_MONITOR) {
        this.tokenMap[token.symbol] = {
          address: token.address,
          decimals: token.decimals,
          contract: new ethers.Contract(token.address, ERC20_ABI, this.wallet)
        };
      }
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error(`Initialization error: ${error.message}`);
      return false;
    }
  }

  async findArbitrageOpportunities() {
    if (!this.isInitialized) {
      console.warn('ArbitrageFinder not initialized');
      return [];
    }
    
    const opportunities = [];
    
    for (const pair of this.config.TOKEN_PAIRS) {
      console.log(`Checking pair: ${pair.name}`);
      
      const baseToken = this.tokenMap[pair.baseToken];
      const quoteToken = this.tokenMap[pair.quoteToken];
      
      if (!baseToken || !quoteToken) continue;
      
      const amountIn = ethers.utils.parseUnits(
        pair.amount.toString(), 
        baseToken.decimals
      );
      
      try {
        // Path for QuickSwap: baseToken -> quoteToken
        const pathQuickToSushi = [baseToken.address, quoteToken.address];
        
        // Path for SushiSwap: quoteToken -> baseToken
        const pathSushiToQuick = [quoteToken.address, baseToken.address];
        
        // Get price from QuickSwap
        const quickSwapAmounts = await this.quickswapRouter.getAmountsOut(
          amountIn,
          pathQuickToSushi
        );
        
        const quickSwapOut = quickSwapAmounts[1];
        
        // Get price from SushiSwap
        const sushiSwapAmounts = await this.sushiswapRouter.getAmountsOut(
          quickSwapOut,
          pathSushiToQuick
        );
        
        const sushiSwapOut = sushiSwapAmounts[1];
        
        // Calculate profit
        const profit = sushiSwapOut.sub(amountIn);
        const profitPercentage = parseFloat(profit.mul(10000).div(amountIn).toString()) / 100;
        
        if (profitPercentage > this.config.MIN_PROFIT_PERCENTAGE) {
          const opportunity = {
            pair: pair.name,
            baseToken: pair.baseToken,
            quoteToken: pair.quoteToken,
            path1: pathQuickToSushi,
            path2: pathSushiToQuick,
            amountIn,
            quickSwapOut,
            sushiSwapOut,
            profit,
            profitPercentage
          };
          
          opportunities.push(opportunity);
          console.log(`Found opportunity for ${pair.name}: ${profitPercentage.toFixed(2)}% profit`);
          
          if (this.config.AUTO_EXECUTE_ARBITRAGE) {
            await this.executeArbitrage(opportunity);
          }
        }
      } catch (error) {
        console.error(`Error checking ${pair.name}: ${error.message}`);
      }
    }
    
    return opportunities;
  }

  async executeArbitrage(opportunity) {
    try {
      console.log(`Executing arbitrage for ${opportunity.pair}`);
      
      const baseTokenAddress = this.tokenMap[opportunity.baseToken].address;
      const loanAmount = ethers.utils.parseUnits(
        this.config.TOKEN_PAIRS.find(p => p.name === opportunity.pair).loanAmount.toString(),
        this.tokenMap[opportunity.baseToken].decimals
      );
      
      // Min amount out (1% slippage tolerance)
      const minAmountOut = opportunity.amountIn.mul(99).div(100);
      
      // Encode parameters for flash loan
      const params = ethers.utils.defaultAbiCoder.encode(
        ['address[]', 'address[]', 'uint256'],
        [opportunity.path1, opportunity.path2, minAmountOut]
      );
      
      // Execute flash loan
      const tx = await this.flashLoanContract.executeArbitrage(
        baseTokenAddress,
        loanAmount,
        params,
        {
          gasLimit: this.config.GAS_LIMIT,
          gasPrice: ethers.utils.parseUnits(this.config.GAS_PRICE_GWEI.toString(), 'gwei')
        }
      );
      
      console.log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(`Arbitrage executed successfully in block ${receipt.blockNumber}`);
        return true;
      } else {
        console.error('Transaction failed');
        return false;
      }
    } catch (error) {
      console.error(`Error executing arbitrage: ${error.message}`);
      return false;
    }
  }

  async startMonitoring(intervalMs = 10000) {
    if (!this.isInitialized) {
      const initialized = await this.init();
      if (!initialized) return false;
    }
    
    console.log(`Starting arbitrage monitoring every ${intervalMs}ms...`);
    
    this.monitoringInterval = setInterval(() => {
      this.findArbitrageOpportunities()
        .catch(error => console.error(`Monitoring error: ${error.message}`));
    }, intervalMs);
    
    return true;
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('Arbitrage monitoring stopped');
    }
  }
}

module.exports = ArbitrageFinder;
