// src/config/Config.ts

/**
 * Configuration for the arbitrage bot
 * Contains all necessary settings and parameters
 */
export const config = {
  // Connection parameters
  RPC_URL: process.env.RPC_URL || 'https://polygon-rpc.com',
  WS_RPC_URL: process.env.WS_RPC_URL || 'wss://polygon-ws.com',
  CHAIN_ID: 137, // Polygon mainnet
  USE_WEBSOCKET: true, // Whether to use WebSocket for real-time updates

  // Protocol addresses
  AAVE_ADDRESS_PROVIDER: '0xd05e3E715d945B59290df0ae8eF85c1BdB684744',
  FLASH_LOAN_PROTOCOL: 'aave', // Options: 'aave', 'balancer', 'custom'

  // DEX routers
  QUICKSWAP_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
  SUSHISWAP_ROUTER: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  UNISWAP_V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  UNISWAP_V3_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',

  // Arbitrage detection settings
  DETECTION_INTERVAL: 15000, // 15 seconds
  MIN_TIME_BETWEEN_DETECTIONS: 5000, // Minimum 5 seconds between detection attempts
  PROGRESS_INTERVAL: 50, // Log progress every 50 cycles
  MAX_PAIRS_TO_USE: 400, // Maximum number of pairs to analyze
  MAX_TOKENS_TO_CONSIDER: 40, // Maximum number of tokens to consider

  // Curve pools
  CURVE_POOLS: [
    {
      name: 'aave',
      address: '0x445FE580eF8d70FF569aB36e80c647af338db351',
      coins: [
        '0x27F8D03b3a2196956ED754baDc28D73be8830A6e', // DAI
        '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F', // USDC
        '0x60D55F02A771d515e077c9C2403a1ef324885CeC'  // USDT
      ]
    },
    {
      name: 'btc',
      address: '0xC2d95EEF97Ec6C17551d45e77B590dc1F9117C67',
      coins: [
        '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', // WBTC
        '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619'  // renBTC
      ]
    }
  ],

  // Token categories mapping for classification
  TOKEN_CATEGORIES: {
    // Stablecoins
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'stablecoin', // USDC
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'stablecoin', // USDT
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 'stablecoin', // DAI
    '0x45c32fa6df82ead1e2ef74d17b76547eddfaff89': 'stablecoin', // FRAX

    // Major tokens
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'major', // WETH
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'major', // WMATIC
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 'major', // WBTC
    '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39': 'major', // LINK

    // DeFi tokens
    '0x831753dd7087cac61ab5644b308642cc1c33dc13': 'defi', // QUICK
    '0xb33eaad8d922b1083446dc23f610c2567fb5180f': 'defi', // UNI
    '0x8505b9d2254a7ae468c0e9dd10ccea3a837aef5c': 'defi', // COMP
    '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3': 'defi'  // BAL
  },

  // Token lists
  STABLECOINS: [
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', // DAI
    '0x45c32fa6df82ead1e2ef74d17b76547eddfaff89'  // FRAX
  ],
  MAJOR_TOKENS: [
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', // WBTC
    '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39'  // LINK
  ],
  DEFI_TOKENS: [
    '0x831753dd7087cac61ab5644b308642cc1c33dc13', // QUICK
    '0xb33eaad8d922b1083446dc23f610c2567fb5180f', // UNI
    '0x8505b9d2254a7ae468c0e9dd10ccea3a837aef5c', // COMP
    '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3'  // BAL
  ],
  NFT_GAME_TOKENS: [
    '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7', // GHST
    '0xd6df932a45c0f255f85145f286ea0b292b21c90b', // AAVE
    '0x3a3df212b7aa91aa0402b9035b098891d276572b', // FISH
    '0x05089c9ebffa4f0aca269e32056b1b36b37ed71b'  // KIRO
  ],
  OTHER_TOKENS: [
    '0xc3c7d422809852031b44ab29eec9f1eff2a58756', // LDO
    '0xb5c064f955d8e7f38fe0460c556a72987494ee17', // QUICK (new)
    '0xbbba073c31bf03b8acf7c28ef0738decf3695683', // SAND
    '0x6f7c932e7684666c9fd1d44527765433e01ff61d'  // MKR
  ],

  // Popular token pairs with known high liquidity
  POPULAR_PAIRS: [
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
      volatility: 0.05
    },
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
      volatility: 0.08
    },
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', // WBTC
      volatility: 0.06
    },
    {
      token0: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
      token1: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
      volatility: 0.1
    }
  ],

  // High liquidity pairs for efficient path finding
  HIGH_LIQUIDITY_PAIRS: [
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'  // WETH
    },
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'  // WMATIC
    },
    {
      token0: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      token1: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6'  // WBTC
    }
  ],

  // Token pairs to analyze
  TOKEN_PAIRS: [
    {
      name: 'USDC-WETH',
      baseToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      quoteToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'  // WETH
    },
    {
      name: 'USDC-WMATIC',
      baseToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      quoteToken: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'  // WMATIC
    },
    {
      name: 'USDC-WBTC',
      baseToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
      quoteToken: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6'  // WBTC
    },
    {
      name: 'WETH-WMATIC',
      baseToken: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', // WETH
      quoteToken: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'  // WMATIC
    }
  ],

  // Token list for initialization
  TOKENS: [
    {
      symbol: 'USDC',
      address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
      decimals: 6,
      priceUsd: 1.0
    },
    {
      symbol: 'USDT',
      address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
      decimals: 6,
      priceUsd: 1.0
    },
    {
      symbol: 'DAI',
      address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
      decimals: 18,
      priceUsd: 1.0
    },
    {
      symbol: 'WMATIC',
      address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
      decimals: 18,
      priceUsd: 0.7
    },
    {
      symbol: 'WETH',
      address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619',
      decimals: 18,
      priceUsd: 1800
    },
    {
      symbol: 'WBTC',
      address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
      decimals: 8,
      priceUsd: 40000
    }
  ],

  // Uniswap V3 fee tiers
  UNISWAP_V3_FEES: {
    'WETH-USDC': 500,   // 0.05% for stable pairs
    'WETH-USDT': 500,   // 0.05% for stable pairs
    'WETH-DAI': 500,    // 0.05% for stable pairs
    'WETH-WBTC': 3000,  // 0.3% for standard pairs
    'WMATIC-WETH': 3000, // 0.3% for standard pairs
    'WMATIC-USDC': 500, // 0.05% for stable pairs
    'WBTC-USDC': 3000   // 0.3% for standard pairs
  },

  // Profitability thresholds
  MIN_PROFIT_PERCENTAGE: 0.05, // 0.05% minimum profit
  MIN_PROFIT_USD: 10.0,        // Minimum profit in USD
  MIN_PROFIT_THRESHOLD: 0.5,   // Minimum profit threshold percentage

  // Gas settings
  GAS_LIMIT: 2000000,     // 2M gas limit
  LOW_GAS_PRICE: '30',    // 30 gwei
  HIGH_GAS_PRICE: '100',  // 100 gwei
  SLIPPAGE_TOLERANCE: 100 // 1% slippage tolerance (in basis points)
};
