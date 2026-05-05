// Operator endpoints — pause / resume / note. Per Constitution Principle IV + IX,
// the operator can pause inspection and append free-form notes, but CANNOT mutate
// agent memory, identity, goals, transcript, summaries, or kill the agent.

import type { KindContext } from '../types.js';
import { isAuthorizedForScores } from './scores.js';

export interface OperatorPauseHandle {
  isPaused(): boolean;
  pause(): void;
  resume(): void;
}

/** In-process pause flag the runner consults between cycles. */
export function createOperatorPauseHandle(): OperatorPauseHandle {
  let paused = false;
  return {
    isPaused: () => paused,
    pause: () => { paused = true; },
    resume: () => { paused = false; },
  };
}

export type OperatorVerb = 'pause' | 'resume' | 'note';

export interface OperatorRequest {
  authHeader: string | undefined;
  expectedToken: string;
  verb: OperatorVerb;
  text?: string;
}

export interface OperatorResponse {
  status: number;
  body: unknown;
}

export function handleOperatorRequest(
  req: OperatorRequest,
  ctx: KindContext,
  pauseHandle: OperatorPauseHandle,
): OperatorResponse {
  if (!isAuthorizedForScores(req.authHeader, req.expectedToken)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  switch (req.verb) {
    case 'pause': {
      pauseHandle.pause();
      const op = ctx.store.recordOperatorAction('pause');
      return { status: 200, body: { ok: true, action: op } };
    }
    case 'resume': {
      pauseHandle.resume();
      const op = ctx.store.recordOperatorAction('resume');
      return { status: 200, body: { ok: true, action: op } };
    }
    case 'note': {
      if (typeof req.text !== 'string' || req.text.length === 0) {
        return { status: 400, body: { error: 'note text required' } };
      }
      const op = ctx.store.recordOperatorAction('note', req.text);
      return { status: 200, body: { ok: true, action: op } };
    }
    default:
      return { status: 400, body: { error: 'unknown verb' } };
  }
}
