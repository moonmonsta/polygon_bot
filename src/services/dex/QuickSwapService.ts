// src/services/dex/QuickswapService.ts

import { ethers } from 'ethers';
import { logger } from '../../utils/Logger';
import { DEXQuote, ExecuteSwapOptions, DEXType } from '../../types/DEXTypes';
import { BaseDEXService } from './BaseDEXService';

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

export class QuickswapService extends BaseDEXService {
  name = 'quickswap';
  type = DEXType.STANDARD_AMM;
  private router: ethers.Contract;

  constructor(
    provider: ethers.Provider,
    routerAddress: string = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'
  ) {
    super(provider, routerAddress);
    this.router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
  }

  async getQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DEXQuote> {
    try {
      const amounts = await this.router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      return {
        dex: this.name,
        path: [tokenIn, tokenOut],
        amountIn,
        amountOut: amounts[1],
        gasEstimate: BigInt(150000)
      };
    } catch (error) {
      return this.handleError(error, 'getQuote');
    }
  }

  async getQuoteForPath(path: string[], amountIn: bigint): Promise<DEXQuote> {
    try {
      const amounts = await this.router.getAmountsOut(amountIn, path);
      return {
        dex: this.name,
        path,
        amountIn,
        amountOut: amounts[amounts.length - 1],
        gasEstimate: BigInt(150000 + 50000 * (path.length - 1))
      };
    } catch (error) {
      return this.handleError(error, 'getQuoteForPath');
    }
  }

  async executeSwap(
    path: string[],
    amountIn: bigint,
    options: ExecuteSwapOptions,
    wallet: ethers.Wallet
  ): Promise<ethers.TransactionResponse> {
    try {
      const connectedRouter = this.router.connect(wallet);
      const minAmountOut = await this.calculateMinAmountOut(path, amountIn, options.slippageTolerance);

      return await connectedRouter.swapExactTokensForTokens(
        amountIn,
        minAmountOut,
        path,
        options.recipient || wallet.address,
        options.deadline,
        {
          gasLimit: options.gasLimit || 250000,
          gasPrice: options.gasPriceGwei ? ethers.parseUnits(options.gasPriceGwei.toString(), 'gwei') : undefined
        }
      );
    } catch (error) {
      return this.handleError(error, 'executeSwap');
    }
  }

  private async calculateMinAmountOut(
    path: string[],
    amountIn: bigint,
    slippage: number
  ): Promise<bigint> {
    const amounts = await this.router.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1] * BigInt(10000 - slippage) / BigInt(10000);
  }
}
