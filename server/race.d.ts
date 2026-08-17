/** Types for race.js, which is plain JavaScript so the relay and the browser can share it. */

import type { RaceMessage } from '../src/net/protocol.ts';

export declare const PHASES: {
  waiting: number;
  countdown: number;
  racing: number;
  results: number;
};

export declare class Race {
  constructor(now?: number);
  readonly phase: RaceMessage['phase'];
  readonly rolling: boolean;
  tick(
    now: number,
    onTrack: string[],
    at: Map<string, { x: number; y: number }>,
  ): boolean;
  snapshot(): RaceMessage;
}
