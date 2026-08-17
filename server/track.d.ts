/** Types for track.js, which is plain JavaScript so the relay and the browser can share it. */

export declare const ROAD_WIDTH: number;
export declare const LAPS: number;
export declare const LAP_LENGTH: number;
export declare const CENTRE: Array<{ x: number; y: number; at: number }>;
export declare const TRACK_BOUNDS: { minX: number; maxX: number; minY: number; maxY: number };

export declare function locate(x: number, y: number): { along: number; off: number; index: number };
export declare function onRoad(x: number, y: number): boolean;
export declare function headingAt(index: number): number;
export declare function gridSlot(place: number): { x: number; y: number; heading: number };
export declare function lapStep(was: number, now: number): -1 | 0 | 1;
export declare function distance(lap: number, along: number): number;
