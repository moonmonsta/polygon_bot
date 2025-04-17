export const config = {
  // Network settings
  RPC_URL: 'https://polygon-rpc.com',
  
  // Contract addresses
  AAVE_ADDRESS_PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  QUICKSWAP_ROUTER: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
  SUSHISWAP_ROUTER: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
  
  // Arbitrage settings
  MIN_PROFIT_THRESHOLD: 0.5, // Minimum profit percentage
  SLIPPAGE_TOLERANCE: 100, // 1% slippage tolerance in basis points
  MAX_GAS_PRICE: 100, // Maximum gas price in gwei
  
  // Tokens to monitor
  TOKENS: [
    {
      symbol: 'WMATIC',
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      decimals: 18
    },
    {
      symbol: 'AAVE',
      address: '0xd6df932a45c0f255f85145f286ea0b292b21c90b',
      decimals: 18
    },
    {
      symbol: 'LINK',
      address: '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39',
      decimals: 18
    },
    {
      symbol: 'WBTC',
      address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6',
      decimals: 8
    },
    {
      symbol: 'USDC',
      address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
      decimals: 6
    }
  ],
  
  // Token pairs to monitor for arbitrage
  TOKEN_PAIRS: [
    {
      name: 'WMATIC-AAVE',
      baseToken: 'WMATIC',
      quoteToken: 'AAVE',
      volatility: 0.08
    },
    {
      name: 'WMATIC-LINK',
      baseToken: 'WMATIC',
      quoteToken: 'LINK',
      volatility: 0.06
    },
    {
      name: 'WMATIC-WBTC',
      baseToken: 'WMATIC',
      quoteToken: 'WBTC',
      volatility: 0.05
    },
    {
      name: 'LINK-AAVE',
      baseToken: 'LINK',
      quoteToken: 'AAVE',
      volatility: 0.07
    }
  ]
};
