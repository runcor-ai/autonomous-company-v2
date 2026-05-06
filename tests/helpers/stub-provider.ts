// Minimal ModelProvider stub for V2 integration tests that need to force specific
// substrate verdict outcomes (pass / modify / escalate / block) deterministically.
// Real OpenRouter calls won't reliably produce flag-triggering outputs on demand.
//
// Usage:
//   const stub = createStubProvider();
//   stub.setNextResponse('valid response');           // single response
//   stub.setNextResponses(['', '', '']);              // queue (pop on each call)
//   stub.setNextError(new Error('simulated 500'));    // throw on next call
//   stub.setStaticResponse('always reply this');      // sticky default
//
// Pass `provider` into createV2Engine via a thin override at engine-factory consumption,
// or wire the provider directly when constructing the engine in tests.

import type { ModelProvider, ModelRequest, ModelResponse } from 'runcor/dist/model/provider.js';

export interface StubProviderState {
  /** Number of `complete` invocations so far. */
  callCount: number;
  /** Last received request — useful for asserting feedback injection across attempts. */
  lastRequest: ModelRequest | null;
  /** Every received request, in order. */
  allRequests: ModelRequest[];
}

export interface StubProvider extends ModelProvider {
  state: StubProviderState;
  setNextResponse(text: string): void;
  setNextResponses(texts: string[]): void;
  setStaticResponse(text: string): void;
  setNextError(err: Error): void;
  reset(): void;
}

export function createStubProvider(opts: { name?: string; defaultText?: string } = {}): StubProvider {
  const name = opts.name ?? 'stub';
  let staticResponse: string | null = opts.defaultText ?? '{"action":"none","args":{},"reasoning":"stub"}';
  const queued: string[] = [];
  let nextError: Error | null = null;

  const state: StubProviderState = {
    callCount: 0,
    lastRequest: null,
    allRequests: [],
  };

  const provider: StubProvider = {
    name,
    state,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      state.callCount += 1;
      state.lastRequest = request;
      state.allRequests.push(request);

      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }

      const text = queued.length > 0 ? queued.shift()! : (staticResponse ?? '');
      return {
        text,
        model: request.model ?? 'stub-model',
        provider: name,
        usage: { promptTokens: 100, completionTokens: 50 },
      };
    },
    setNextResponse(text: string): void {
      queued.push(text);
    },
    setNextResponses(texts: string[]): void {
      queued.push(...texts);
    },
    setStaticResponse(text: string): void {
      staticResponse = text;
    },
    setNextError(err: Error): void {
      nextError = err;
    },
    reset(): void {
      state.callCount = 0;
      state.lastRequest = null;
      state.allRequests.length = 0;
      queued.length = 0;
      nextError = null;
    },
  };

  return provider;
}
