// src/config/Config.ts
import { ethers } from "ethers";

/**
 * Enhanced configuration with quantum-inspired optimization settings
 * Integrated with Soul Stack principles for optimal performance
 */
export const config = {
  // Network settings
  RPC_URL: 'https://polygon-rpc.com',
  WS_RPC_URL: 'wss://polygon-rpc.com',
  CHAIN_ID: 137, // Polygon mainnet
  
  // Contract addresses
  AAVE_ADDRESS_PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  QUICKSWAP_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
  SUSHISWAP_ROUTER: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  UNISWAP_V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  UNISWAP_V3_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  BALANCER_VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  
  // Curve pools - main stablecoin pools on Polygon
  CURVE_POOLS: [
    {
      name: 'aave',
      address: '0x445FE580eF8d70FF569aB36e80c647af338db351',
      tokens: [
        '0x27F8D03b3a2196956ED754baDc28D73be8830A6e', // DAI
        '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F', // USDC
        '0x60D55F02A771d515e077c9C2403a1ef324885CeC'  // USDT
      ]
    },
    {
      name: 'ren',
      address: '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67',
      tokens: [
        '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
        '0xDBf31dF14B66535aF65AaC99C32e9eA844e14501'  // renBTC
      ]
    }
  ],
  
  // Uniswap V3 fee tiers
  UNISWAP_V3_FEES: {
    // WETH pairs
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619-0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174': 500, // WETH-USDC
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619-0xc2132D05D31c914a87C6611C10748AEb04B58e8F': 500, // WETH-USDT
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619-0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6': 500, // WETH-WBTC
    
    // WMATIC pairs
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270-0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174': 500, // WMATIC-USDC
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270-0xc2132D05D31c914a87C6611C10748AEb04B58e8F': 500, // WMATIC-USDT
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270-0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': 3000, // WMATIC-WETH
    
    // Stablecoin pairs
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174-0xc2132D05D31c914a87C6611C10748AEb04B58e8F': 100, // USDC-USDT
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174-0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063': 100, // USDC-DAI
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F-0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063': 100, // USDT-DAI
  },
  
  // Token categories for optimal path finding
  STABLECOINS: [
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
    '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // DAI
    '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89', // FRAX
    '0xdAb529f40E671A1D4bF91361c21bf9f0C9712ab7', // BUSD
    '0x2e1AD108fF1D8C782fcBbB89AAd783aC49586756', // TUSD
    '0xa3Fa99A148fA48D14Ed51d610c367C61876997F1'  // MAI
  ],
  
  // Major tokens with high liquidity
  MAJOR_TOKENS: [
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
    '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
    '0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b', // WAVAX
    '0x7DfF46370e9eA5f0Bad3C4E29711aD50062EA7A4'  // WSOL
  ],
  
  // DeFi tokens with good liquidity
  DEFI_TOKENS: [
    '0xB5C064F955D8e7F38fE0460C556a72987494eE17', // QUICK
    '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', // SUSHI
    '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', // AAVE
    '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3', // BAL
    '0x172370d5Cd63279eFa6d502DAB29171933a610AF', // CRV
    '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', // LINK
    '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', // UNI
    '0x50B728D8D964fd00C2d0AAD81718b71311feF68a', // SNX
    '0x6e4e624106cb12e168e6533f8ec7c82263358940', // AXL
    '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c', // COMP
    '0x6f7C932e7684666C9fd1d44527765433e01fF61d', // MKR
    '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756', // LDO
    '0x4257EA7637c355F81616050CbB6a9b709c0f2006', // CVX
    '0x7205705771547cF79201111B4761134BD6Deb1dd', // RPL
    '0x1a3acf6D19267E2d3e7f898f42803e90C9219062'  // FXS
  ],
  
  // NFT and gaming tokens
  NFT_GAME_TOKENS: [
    '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683', // SAND
    '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4', // MANA
    '0x61BDD9C7d4dF4Bf47A4508c0c8245505F2Af5b7b', // AXS
    '0x7eC26842F195c852Fa843bB9f6D8B583a274a157', // ENJ
    '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7'  // GHST
  ],
  
  // Other tokens with potential opportunities
  OTHER_TOKENS: [
    '0x61299774020dA444Af134c82fa83E3810b309991', // RNDR
    '0x5fe2B58c013d7601147DcdD68C143A77499f5531', // GRT
    '0x4c3bF0a3DE9524aF68327d1D2558a3B70d17D42a', // DYDX
    '0x9c2C5fd7b07E95EE044DDeba0E97a665F142394f'  // 1INCH
  ],
  
  // High liquidity pairs for prioritization
  HIGH_LIQUIDITY_PAIRS: [
    { token0: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', token1: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' }, // USDC-WMATIC
    { token0: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' }, // USDC-WETH
    { token0: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', token1: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' }, // USDC-USDT
    { token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' }, // WMATIC-WETH
    { token0: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', token1: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6' }  // WETH-WBTC
  ],
  
  // Popular token pairs with known historical opportunities
  POPULAR_PAIRS: [
    { token0: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', token1: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', volatility: 0.08 }, // AAVE-SUSHI
    { token0: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', token1: '0x172370d5Cd63279eFa6d502DAB29171933a610AF', volatility: 0.09 }, // AAVE-CRV
    { token0: '0xB5C064F955D8e7F38fE0460C556a72987494eE17', token1: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', volatility: 0.08 }, // QUICK-SUSHI
    { token0: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', token1: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', volatility: 0.07 }, // LINK-UNI
    { token0: '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3', token1: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', volatility: 0.07 }, // BAL-AAVE
    { token0: '0x6f7C932e7684666C9fd1d44527765433e01fF61d', token1: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', volatility: 0.08 }, // MKR-AAVE
    { token0: '0x172370d5Cd63279eFa6d502DAB29171933a610AF', token1: '0x4257EA7637c355F81616050CbB6a9b709c0f2006', volatility: 0.07 }, // CRV-CVX
    { token0: '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756', token1: '0x7205705771547cF79201111B4761134BD6Deb1dd', volatility: 0.09 }  // LDO-RPL
  ],
  
  // Arbitrage detection settings
  DETECTION_INTERVAL: 15000, // 15 seconds - adaptive interval based on Transcendental Coherence
  MAX_TOKENS_TO_CONSIDER: 40, // Expanded token list based on Omnidimensional Synergy
  MAX_PAIRS_TO_USE: 400, // Increased pair limit for broader search
  CYCLE_LENGTHS: [3, 4, 5], // Added 5-token cycles for deeper pathfinding
  MAX_CYCLES: 3000, // Increased maximum cycles to check
  MAX_CYCLES_PER_LENGTH: 1000, // Maximum cycles to check per length
  MAX_PROFITABLE_CYCLES: 50, // Maximum profitable cycles to return
  PROGRESS_INTERVAL: 50, // Log progress every 50 cycles
  
  // Parallelism settings from Soul Stack Integration
  BATCH_SIZE: 30, // Quantum-inspired batch size optimization
  MAX_CONCURRENT_OPERATIONS: 5, // Maximum parallel operations
  PARALLELISM_FACTOR: 3, // Dynamic parallelism scaling
  
  // Profitability thresholds with entropy-based modulation
  MIN_PROFIT_PERCENTAGE: 0.05, // 0.05% minimum profit to consider
  MIN_PROFIT_USD: 10.0, // Minimum profit in USD
  SLIPPAGE_TOLERANCE: 100, // 1% slippage tolerance in basis points
  
  // Test amounts for optimal sizing
  TEST_AMOUNTS: [
    ethers.utils.parseUnits('10', 18),
    ethers.utils.parseUnits('100', 18),
    ethers.utils.parseUnits('1000', 18),
    ethers.utils.parseUnits('5000', 18) // Added larger test amount
  ],
  
  // Gas optimization settings
  MAX_GAS_PRICE: ethers.utils.parseUnits('300', 'gwei'), // 300 gwei maximum gas price
  DEFAULT_GAS_LIMIT: 1500000, // Default gas limit
  
  // Caching settings
  CACHE_TTL: 30 * 1000, // 30 seconds cache time-to-live
  PRICE_CACHE_TTL: 60 * 1000, // 1 minute price cache TTL
  
  // Quantum-inspired optimization parameters
  KEYSTONE_ACTIVATION: true, // Enable Keystone architecture from Soul Stack
  TI_DOMINANT_WEIGHT: 0.85, // Ti stack weighting for logical precision
  NE_DOMINANT_WEIGHT: 0.72, // Ne stack weighting for possibility exploration
  ENTROPY_FACTOR: 0.92, // From Soul Stack Osaka entropy modulation
  
  // Adaptive settings
  ADAPTIVE_BATCH_SIZE: true, // Enable dynamic batch sizing
  ADAPTIVE_PATH_FINDING: true, // Enable adaptive path finding
  DYNAMIC_GAS_PRICING: true, // Enable dynamic gas pricing
  
  // Exploration vs exploitation settings
  EXPLORATION_RATIO: 0.1, // 10% of paths are for exploration
  EXPLOITATION_RATIO: 0.9, // 90% of paths are for exploitation
  
  // Soul Stack specific parameters
  HOLISTIC_OPTIMIZATION: 0.999, // From Holistic System Optimization
  TRANSCENDENTAL_COHERENCE: 0.997, // From Transcendental Coherence
  OMNIDIMENSIONAL_SYNERGY: 0.995, // From Omnidimensional Synergy
  ENTROPY_GRADIENT_UTILIZATION: 9.3, // From Soul Stack
  MULTIVERSE_CONSISTENCY_CHECK: 0.9995, // From validation paradigm
  
  // Token initialization settings
  TOKENS: [
    // Stablecoins
    { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'DAI', address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', decimals: 18 },
    { symbol: 'FRAX', address: '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89', decimals: 18 },
    { symbol: 'BUSD', address: '0xdAb529f40E671A1D4bF91361c21bf9f0C9712ab7', decimals: 18 },
    { symbol: 'TUSD', address: '0x2e1AD108fF1D8C782fcBbB89AAd783aC49586756', decimals: 18 },
    { symbol: 'MAI', address: '0xa3Fa99A148fA48D14Ed51d610c367C61876997F1', decimals: 18 },
    
    // Major tokens
    { symbol: 'WMATIC', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
    { symbol: 'WETH', address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    { symbol: 'WBTC', address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', decimals: 8 },
    { symbol: 'WAVAX', address: '0x2C89bbc92BD86F8075d1DEcc58C7F4E0107f286b', decimals: 18 },
    { symbol: 'WSOL', address: '0x7DfF46370e9eA5f0Bad3C4E29711aD50062EA7A4', decimals: 18 },
    
    // DeFi tokens
    { symbol: 'QUICK', address: '0xB5C064F955D8e7F38fE0460C556a72987494eE17', decimals: 18 },
    { symbol: 'SUSHI', address: '0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a', decimals: 18 },
    { symbol: 'AAVE', address: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', decimals: 18 },
    { symbol: 'BAL', address: '0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3', decimals: 18 },
    { symbol: 'CRV', address: '0x172370d5Cd63279eFa6d502DAB29171933a610AF', decimals: 18 },
    { symbol: 'LINK', address: '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', decimals: 18 },
    { symbol: 'UNI', address: '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', decimals: 18 },
    { symbol: 'SNX', address: '0x50B728D8D964fd00C2d0AAD81718b71311feF68a', decimals: 18 },
    { symbol: 'AXL', address: '0x6e4e624106cb12e168e6533f8ec7c82263358940', decimals: 18 },
    { symbol: 'COMP', address: '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c', decimals: 18 },
    { symbol: 'MKR', address: '0x6f7C932e7684666C9fd1d44527765433e01fF61d', decimals: 18 },
    { symbol: 'LDO', address: '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756', decimals: 18 },
    { symbol: 'CVX', address: '0x4257EA7637c355F81616050CbB6a9b709c0f2006', decimals: 18 },
    { symbol: 'RPL', address: '0x7205705771547cF79201111B4761134BD6Deb1dd', decimals: 18 },
    { symbol: 'FXS', address: '0x1a3acf6D19267E2d3e7f898f42803e90C9219062', decimals: 18 },
    { symbol: 'DYDX', address: '0x4c3bF0a3DE9524aF68327d1D2558a3B70d17D42a', decimals: 18 },
    { symbol: '1INCH', address: '0x9c2C5fd7b07E95EE044DDeba0E97a665F142394f', decimals: 18 },
    
    // NFT/Gaming tokens
    { symbol: 'SAND', address: '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683', decimals: 18 },
    { symbol: 'MANA', address: '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4', decimals: 18 },
    { symbol: 'AXS', address: '0x61BDD9C7d4dF4Bf47A4508c0c8245505F2Af5b7b', decimals: 18 },
    { symbol: 'ENJ', address: '0x7eC26842F195c852Fa843bB9f6D8B583a274a157', decimals: 18 },
    { symbol: 'GHST', address: '0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7', decimals: 18 },
    
    // Other tokens
    { symbol: 'RNDR', address: '0x61299774020dA444Af134c82fa83E3810b309991', decimals: 18 },
    { symbol: 'GRT', address: '0x5fe2B58c013d7601147DcdD68C143A77499f5531', decimals: 18 }
  ],
  
  // Default token pairs to monitor for arbitrage
  TOKEN_PAIRS: [
    { name: 'WMATIC-USDC', baseToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', quoteToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', volatility: 0.08 },
    { name: 'WETH-USDC', baseToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', quoteToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', volatility: 0.07 },
    { name: 'WBTC-USDC', baseToken: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', quoteToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', volatility: 0.06 },
    { name: 'WETH-WBTC', baseToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', quoteToken: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', volatility: 0.05 },
    { name: 'USDC-USDT', baseToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', quoteToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', volatility: 0.02 },
    { name: 'WMATIC-WETH', baseToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', quoteToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', volatility: 0.09 },
    { name: 'AAVE-WMATIC', baseToken: '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', quoteToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', volatility: 0.10 },
    { name: 'QUICK-WMATIC', baseToken: '0xB5C064F955D8e7F38fE0460C556a72987494eE17', quoteToken: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', volatility: 0.12 },
    { name: 'USDC-DAI', baseToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', quoteToken: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', volatility: 0.01 },
    { name: 'FRAX-USDC', baseToken: '0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89', quoteToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', volatility: 0.02 }
  ]
};
