import type { CoreClient } from '../core/core-client.js'
import type {
  DecisionKernel,
  DecisionKernelEvaluation,
  DecisionKernelInput,
} from './decision-support-contract.js'

export class CoreDecisionKernel implements DecisionKernel {
  constructor(private readonly core: Pick<CoreClient, 'request'>) {}

  async evaluate(input: DecisionKernelInput): Promise<DecisionKernelEvaluation> {
    return this.core.request<DecisionKernelEvaluation>(
      'decision.evaluate',
      input,
      5_000,
    )
  }
}
