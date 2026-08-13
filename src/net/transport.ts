/**
 * How messages actually travel.
 *
 * Two implementations behind one interface. `LoopbackTransport` uses a
 * BroadcastChannel, so two tabs of the game on the same machine can see each
 * other with no server at all — which is how the whole of the multiplayer layer
 * was built and tested before any relay existed, and which stays useful for
 * checking a change without deploying. `SocketTransport` is the real one.
 *
 * Neither knows anything about unicorns. They carry messages and report whether
 * they are up.
 */

import type { NetMessage } from './protocol.ts';

export type NetStatus = 'offline' | 'connecting' | 'online';

export interface Transport {
  /** Shown to the player, and useful in the console. */
  readonly kind: 'loopback' | 'socket';
  start(): void;
  send(message: NetMessage): void;
  close(): void;
  onMessage: ((message: NetMessage) => void) | null;
  onStatus: ((status: NetStatus) => void) | null;
}

/** Same-machine play across two browser tabs. No server involved. */
export class LoopbackTransport implements Transport {
  readonly kind = 'loopback';
  private channel: BroadcastChannel | null = null;

  onMessage: ((message: NetMessage) => void) | null = null;
  onStatus: ((status: NetStatus) => void) | null = null;

  constructor(private readonly name = 'enhorningsangen') {}

  static get supported(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }

  start(): void {
    if (this.channel) return;
    this.channel = new BroadcastChannel(this.name);
    // A BroadcastChannel never echoes to its own sender, which is exactly the
    // behaviour a relay has, so nothing downstream has to know the difference.
    this.channel.onmessage = (event) => this.onMessage?.(event.data as NetMessage);
    this.onStatus?.('online');
  }

  send(message: NetMessage): void {
    this.channel?.postMessage(message);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
    this.onStatus?.('offline');
  }
}

/** Longest gap between reconnection attempts. */
const MAX_BACKOFF = 15000;

/**
 * The real relay.
 *
 * Reconnection is not a polish item here: App Service recycles its workers for
 * platform updates, so the socket *will* drop during a long play session even
 * with Always On. It reconnects with a backoff and tells the game, which
 * re-announces the player. Because the meadow is generated from a seed rather
 * than stored, coming back costs a second of "connecting" and nothing else.
 */
export class SocketTransport implements Transport {
  readonly kind = 'socket';
  private socket: WebSocket | null = null;
  private retry = 0;
  private timer: number | null = null;
  private closed = false;

  onMessage: ((message: NetMessage) => void) | null = null;
  onStatus: ((status: NetStatus) => void) | null = null;

  constructor(private readonly url: string) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    this.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.onStatus?.('online');
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.onMessage?.(JSON.parse(event.data) as NetMessage);
      } catch {
        // A malformed frame is not worth interrupting play for.
      }
    };

    socket.onclose = () => {
      this.socket = null;
      this.onStatus?.('offline');
      this.scheduleRetry();
    };

    // `onclose` always follows `onerror`, so the retry is handled there.
    socket.onerror = () => socket.close();
  }

  private scheduleRetry(): void {
    if (this.closed || this.timer !== null) return;
    // 0.5s, 1s, 2s… up to fifteen, so a relay that is down does not get hammered
    // by a tab left open all afternoon.
    const wait = Math.min(MAX_BACKOFF, 500 * 2 ** this.retry);
    this.retry += 1;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, wait);
  }

  send(message: NetMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.onStatus?.('offline');
  }
}
