// src/stacks/StackIntegrator.ts
import { NiStack } from './NiStack';
import { TiStack } from './TiStack';
import { DEXQuotes } from '../types/ArbitrageTypes';
import { loadStackConfig } from './StackLoader';

export class StackIntegrator {
  private ni: NiStack;
  private ti: TiStack;

  constructor() {
    this.ni = new NiStack(loadStackConfig('1_Ni'));
    this.ti = new TiStack(loadStackConfig('7_Ti'));
  }

  evaluate(quotes: DEXQuotes[], cycles: DEXQuotes[][]): DEXQuotes | null {
    let filtered = this.ni.filterPatterns(quotes);
    filtered = this.ni.adjustForComplexity(filtered);
    let projected = this.ni.projectFuture(filtered, 3);
    let bestCycle = this.ni.nonlinearSolve(cycles);
    let reduced = this.ti.reduceComplexity(bestCycle);
    for (const q of reduced) {
      if (this.ti.validateLogic(q) && this.ti.causalChain(q) > 0.95) {
        return q;
      }
    }
    return null;
  }
}
