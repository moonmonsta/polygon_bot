import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from './Logger';

// Cache token prices to reduce API calls
const priceCache: Record<string, { price: number, timestamp: number }> = {};
const CACHE_TTL = 60 * 1000; // 1 minute

export async function getTokenPrice(tokenAddress: string): Promise<number> {
  // Check cache first
  const cachedPrice = priceCache[tokenAddress];
  if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_TTL) {
    return cachedPrice.price;
  }
  
  try {
    // Use CoinGecko API to get token price
    // Replace with your preferred price oracle
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/token_price/polygon-pos?contract_addresses=${tokenAddress}&vs_currencies=usd`
    );
    
    if (response.data && response.data[tokenAddress.toLowerCase()]) {
      const price = response.data[tokenAddress.toLowerCase()].usd;
      
      // Update cache
      priceCache[tokenAddress] = {
        price,
        timestamp: Date.now()
      };
      
      return price;
    }
    
    // Fallback price for MATIC
    if (tokenAddress.toLowerCase() === '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270') {
      return 0.7; // Fallback MATIC price
    }
    
    // Default fallback
    return 1.0;
  } catch (error) {
    logger.error(`Error fetching token price: ${error}`);
    return 1.0; // Default fallback
  }
}
