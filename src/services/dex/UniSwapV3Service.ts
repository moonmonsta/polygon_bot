// src/services/dex/UniswapV3Service.ts

import { ethers } from 'ethers';
import { logger } from '../../utils/Logger';
import { DEXQuote, ExecuteSwapOptions, DEXType } from '../../types/DEXTypes';
import { BaseDEXService } from './BaseDEXService';

const QUOTER_ABI = [
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)"
];

const ROUTER_ABI = [
  "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)"
];

export class UniswapV3Service extends BaseDEXService {
  name = 'uniswap_v3';
  type = DEXType.UNISWAP_V3;
  private quoter: ethers.Contract;
  private router: ethers.Contract;
  private feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

  constructor(
    provider: ethers.Provider,
    routerAddress: string = '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    quoterAddress: string = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
  ) {
    super(provider, routerAddress);
    this.router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
    this.quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
  }

  async getQuote(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<DEXQuote> {
    try {
      const fee = await this.findOptimalFee(tokenIn, tokenOut, amountIn);
      const path = this.encodePath([tokenIn, tokenOut], [fee]);
      const amountOut = await this.quoter.quoteExactInput(path, amountIn);

      return {
        dex: this.name,
        path: [tokenIn, tokenOut],
        amountIn,
        amountOut,
        gasEstimate: BigInt(180000)
      };
    } catch (error) {
      return this.handleError(error, 'getQuote');
    }
  }

  async getQuoteForPath(path: string[], amountIn: bigint): Promise<DEXQuote> {
    try {
      const encodedPath = await this.buildEncodedPath(path);
      const amountOut = await this.quoter.quoteExactInput(encodedPath, amountIn);

      return {
        dex: this.name,
        path,
        amountIn,
        amountOut,
        gasEstimate: BigInt(180000 + 70000 * (path.length - 1))
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
      const encodedPath = await this.buildEncodedPath(path);
      const minAmountOut = await this.calculateMinAmountOut(encodedPath, amountIn, options.slippageTolerance);

      return await connectedRouter.exactInput({
        path: encodedPath,
        recipient: options.recipient || wallet.address,
        deadline: options.deadline,
        amountIn: amountIn,
        amountOutMinimum: minAmountOut
      }, {
        gasLimit: options.gasLimit || 250000,
        gasPrice: options.gasPriceGwei ? ethers.parseUnits(options.gasPriceGwei.toString(), 'gwei') : undefined
      });
    } catch (error) {
      return this.handleError(error, 'executeSwap');
    }
  }

  private async findOptimalFee(tokenIn: string, tokenOut: string, amountIn: bigint): Promise<number> {
    let bestFee = 3000; // Default to 0.3%
    let bestOutput = 0n;

    for (const fee of this.feeTiers) {
      try {
        const path = this.encodePath([tokenIn, tokenOut], [fee]);
        const output = await this.quoter.quoteExactInput(path, amountIn);
        if (output > bestOutput) {
          bestOutput = output;
          bestFee = fee;
        }
      } catch {
        continue;
      }
    }
    return bestFee;
  }

  private async buildEncodedPath(path: string[]): Promise<string> {
    if (path.length < 2) throw new Error('Path must contain at least 2 tokens');

    let encoded = '0x';
    for (let i = 0; i < path.length - 1; i++) {
      const fee = await this.findOptimalFee(path[i], path[i+1], BigInt(1e18));
      encoded += path[i].slice(2).toLowerCase();
      encoded += fee.toString(16).padStart(6, '0');
    }
    encoded += path[path.length-1].slice(2).toLowerCase();

    return encoded;
  }

  private encodePath(tokens: string[], fees: number[]): string {
    let encoded = '0x';
    for (let i = 0; i < tokens.length - 1; i++) {
      encoded += tokens[i].slice(2).toLowerCase();
      encoded += fees[i].toString(16).padStart(6, '0');
    }
    encoded += tokens[tokens.length-1].slice(2).toLowerCase();
    return encoded;
  }

  private async calculateMinAmountOut(
    encodedPath: string,
    amountIn: bigint,
    slippage: number
  ): Promise<bigint> {
    const amountOut = await this.quoter.quoteExactInput(encodedPath, amountIn);
    return amountOut * BigInt(10000 - slippage) / BigInt(10000);
  }
}
