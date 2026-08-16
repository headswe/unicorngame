/** Types for clutch.js, which is plain JavaScript so the relay and the browser can share it. */

export declare const CLUTCH_ODDS: { twins: number; triplets: number };
export declare const BLOOM_TIME: number;

export declare function clutchSize(seed: string): 1 | 2 | 3;
export declare function eggId(seed: string, index: number): string;
export declare function clutchOf(id: string): string | null;
