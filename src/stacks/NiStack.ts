// src/stacks/NiStack.ts
import { DEXQuotes } from '../types/ArbitrageTypes';

export class NiStack {
  private config: any;
  constructor(config: any) { this.config = config; }

  filterPatterns(quotes: DEXQuotes[]): DEXQuotes[] {
    const depth = this.config.primary_parameters.Pattern_Recognition_Optimization_Depth.base_value;
    const stability = this.config.primary_parameters.Pattern_Recognition_Optimization_Depth.harmonic_properties.multi_state_sustainability[0];
    return quotes.filter(q => {
      const profit = q.quickswap.reverseOut.sub(q.amountIn).toNumber() / q.amountIn.toNumber();
      return profit > (depth * stability * 0.5);
    });
  }

  projectFuture(quotes: DEXQuotes[], nBlocks: number): DEXQuotes[] {
    const proj = this.config.primary_parameters.Future_Projection_Optimization;
    const decay = proj.decay[0];
    const inertia = proj.inertia[0];
    return quotes.map(q => {
      const profit = q.quickswap.reverseOut.sub(q.amountIn).toNumber() / q.amountIn.toNumber();
      const projected = profit * Math.pow(1 - decay, nBlocks) * (1 + inertia * 0.1);
      return { ...q, projectedProfit: projected };
    }).filter(q => q.projectedProfit > 0.01);
  }

  nonlinearSolve(cycles: DEXQuotes[][]): DEXQuotes[] {
    const nonlin = this.config.primary_parameters.Nonlinear_Problem_Solving_Optimization;
    const base = nonlin.base_value;
    return cycles.map(path => {
      const score = path.reduce((acc, q) => acc * (q.quickswap.reverseOut.sub(q.amountIn).toNumber() / q.amountIn.toNumber() + 1), 1) * base;
      return { path, score };
    }).sort((a, b) => b.score - a.score).slice(0, 1).map(x => x.path).flat();
  }

  adjustForComplexity(quotes: DEXQuotes[]): DEXQuotes[] {
    const osaka = this.config.primary_parameters.Osaka_Complexity_Wave_Detection;
    const complexity = osaka.complexity_factor[0];
    return quotes.map(q => ({
      ...q,
      adjustedAmount: q.amountIn.mul(Math.floor(complexity * 100)).div(100)
    }));
  }
}
