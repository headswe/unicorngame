/**
 * One child's place in the shared meadow.
 *
 * Sits between the transport and the game: sends this player's unicorn out at a
 * steady rate, turns everyone else's messages into visitors, and hands cast
 * spells to the game so both screens get the same shower of strawberries.
 *
 * There is no host and no server-side authority. Every browser runs its own
 * meadow and simply shows the others walking through it. That is only possible
 * because the field is generated from a seed, and it is what keeps this layer
 * small enough to trust: nothing here can break single-player, because when the
 * relay is down the game simply carries on with nobody else in it.
 *
 * Introductions are peer-to-peer. A newcomer's `hello` is answered with a
 * `hello` from anyone who does not already know them, which both introduces the
 * newcomer and fills in everyone who was already here. The reply is gated on
 * not knowing the sender, which is what stops it echoing forever.
 */

import type { Visitors } from '../game/visitors.ts';
import type { UnicornVariant } from '../game/variant.ts';
import {
  newPeerId,
  POSE_HZ,
  PROTOCOL_VERSION,
  type NetMessage,
  type Pose,
  type StateMessage,
} from './protocol.ts';
import type { NetStatus, Transport } from './transport.ts';

/** How often a standing-still unicorn reports in, as a heartbeat. */
const IDLE_HZ = 2;

/**
 * And how often from the bouncing yard, where a pony crosses a lot of sky in a
 * hurry and is never really standing still. Twice the meadow's rate, for a
 * handful of children at a time — the traffic is nothing and a friend's bounce
 * arriving in ten steps rather than five is the difference between a bounce and
 * a stutter.
 */
const YARD_HZ = 20;

export interface SessionCallbacks {
  /** Someone else cast a spell; replay it locally so both screens agree. */
  onSpell(
    spell: string,
    x: number,
    y: number,
    seed: string,
    at: number,
    variant?: UnicornVariant,
  ): void;
  /** Someone else's unicorn left a present. */
  onPoop(poop: string, x: number, y: number): void;
  /** Someone shovelled one, named so both screens remove the same poop. */
  onClean(poop: string): void;
  /** A friend's unicorn ate a named strawberry. */
  onEaten(berry: string): void;
  /** What a peer says has already been shovelled here today. */
  onCleanedList(poops: string[]): void;
  /** The meadow as the relay has it, handed over on connecting. */
  onState(state: StateMessage): void;
  /** Who lives here, as seeds. Arrives on connecting and whenever it changes. */
  onRoster(seeds: string[]): void;
  /** Where the herd is, ten times a second. */
  onHerd(poses: Array<[number, number, number, number, number]>): void;
  /** A chunk of somebody else's line on the drawing board. */
  onInk(stroke: string, by: string, colour: number, nib: number, xy: number[]): void;
  /** Lines somebody rubbed out, whoever had drawn them. */
  onRub(strokes: string[]): void;
  /** Ponies that are pleased about something. */
  onCheer(ponies: number[]): void;
  onStatus(status: NetStatus): void;
}

export interface SessionSources {
  /** This player's unicorn, right now. */
  pose(): Pose;
  variant(): UnicornVariant;
  /** Every poop shovelled here today, for bringing a newcomer up to date. */
  cleaned(): string[];
}

export class Session {
  readonly id = newPeerId();
  status: NetStatus = 'offline';

  private since = 0;
  private lastSent: Pose | null = null;
  private lastRepair = 0;

  constructor(
    private readonly transport: Transport,
    private readonly visitors: Visitors,
    private readonly sources: SessionSources,
    private readonly callbacks: SessionCallbacks,
  ) {
    transport.onMessage = (message) => this.receive(message);
    transport.onStatus = (status) => this.changed(status);
  }

  start(): void {
    this.transport.start();
    // A closed laptop should not leave a pony standing in someone else's field
    // any longer than it has to. The timeout would clear it anyway; this is the
    // polite version.
    window.addEventListener('pagehide', () => this.leave());
  }

  private changed(status: NetStatus): void {
    this.status = status;
    if (status === 'online') {
      this.announce();
    } else {
      // Nobody is reachable, so nobody is here. Better an empty meadow than a
      // field of ponies frozen where the connection died.
      this.visitors.clear();
    }
    this.callbacks.onStatus(status);
  }

  /**
   * Introduces this player. Called on connect and after a wardrobe change.
   *
   * `ask` requests an introduction back even from peers who already know us,
   * which is how a missed handshake is repaired. Replies never set it, so the
   * exchange always terminates.
   */
  announce(ask = false): void {
    if (this.status !== 'online') return;
    this.transport.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      id: this.id,
      variant: this.sources.variant(),
      pose: this.sources.pose(),
      cleaned: this.sources.cleaned(),
      ask,
    });
  }

  /**
   * Someone is out there that we were never introduced to — a lost hello, or we
   * connected while they were mid-handshake. Ask them to say hello again.
   *
   * Throttled, because the cue for this is their pose messages and those arrive
   * ten times a second; one request is enough.
   */
  private repair(): void {
    const now = performance.now();
    if (now - this.lastRepair < 1000) return;
    this.lastRepair = now;
    this.announce(true);
  }

  /** Tells everyone what was just cast, so it happens on their screen too. */
  broadcastSpell(
    spell: string,
    x: number,
    y: number,
    seed: string,
    at: number,
    variant?: UnicornVariant,
  ): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'spell', id: this.id, spell, x, y, seed, at, variant });
  }

  /** Tells everyone the player's unicorn left a present. */
  broadcastPoop(poop: string, x: number, y: number): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'poop', id: this.id, poop, x, y });
  }

  /** Reports an egg opening, so the relay can file the foal away for tomorrow. */
  broadcastHatched(egg: string, foal: UnicornVariant, x: number, y: number): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'hatched', id: this.id, egg, foal, x, y });
  }

  /** Tells everyone the player's unicorn ate a named strawberry. */
  broadcastEaten(berry: string): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'eaten', id: this.id, berry });
  }

  /** Sends a chunk of a line being drawn on the shared board. */
  broadcastInk(stroke: string, colour: number, nib: number, xy: number[]): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'ink', id: this.id, stroke, colour, nib, xy });
  }

  /** Tells everyone which lines were rubbed out. */
  broadcastRub(strokes: string[]): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'rub', id: this.id, strokes });
  }

  /** Tells the simulation a pony was patted. It decides whether it counted. */
  pet(pony: number): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'pet', id: this.id, pony });
  }

  /** Tells everyone a poop was shovelled. */
  broadcastClean(poop: string): void {
    if (this.status !== 'online') return;
    this.transport.send({ t: 'clean', id: this.id, poop });
  }

  private receive(message: NetMessage): void {
    // The relay speaks for itself for these three: the meadow's state, who
    // lives in it, and where they are. None carry a sender.
    if (message.t === 'state') {
      this.callbacks.onState(message);
      return;
    }
    if (message.t === 'roster') {
      this.callbacks.onRoster(message.ponies);
      return;
    }
    if (message.t === 'herd') {
      this.callbacks.onHerd(message.ponies);
      return;
    }
    if (message.t === 'cheer') {
      this.callbacks.onCheer(message.ponies);
      return;
    }
    // A relay broadcasts to everyone, so our own messages can come back.
    if (!('id' in message) || message.id === this.id) return;

    switch (message.t) {
      case 'hello': {
        // A child with a stale tab open is dropped rather than left watching
        // everyone else glitch.
        if (message.v !== PROTOCOL_VERSION) return;
        const stranger = this.visitors.isStranger(message.id);
        this.visitors.greet(message.id, message.variant, message.pose);
        // Adopt their record of the tidying before working out today's poop,
        // or we would put back everything they have already cleared.
        this.callbacks.onCleanedList(message.cleaned ?? []);
        // Answer a newcomer so they learn about us, and answer anyone who has
        // explicitly asked. Never answer a plain re-announcement from someone
        // we already know, or two browsers would greet each other forever.
        if (stranger || message.ask) this.announce();
        break;
      }
      case 'pose':
        // A pose from someone we were never introduced to means we missed their
        // hello. Their unicorn would otherwise never appear.
        if (this.visitors.isStranger(message.id)) this.repair();
        else this.visitors.moveTo(message.id, message.pose);
        break;
      case 'spell':
        this.callbacks.onSpell(
          message.spell,
          message.x,
          message.y,
          message.seed,
          message.at,
          message.variant,
        );
        break;
      case 'poop':
        this.callbacks.onPoop(message.poop, message.x, message.y);
        break;
      case 'clean':
        this.callbacks.onClean(message.poop);
        break;
      case 'eaten':
        this.callbacks.onEaten(message.berry);
        break;
      case 'ink':
        this.callbacks.onInk(message.stroke, message.id, message.colour, message.nib, message.xy);
        break;
      case 'rub':
        this.callbacks.onRub(message.strokes);
        break;
      case 'hatched':
        // Nothing to do: the egg on this screen is hatching on its own clock.
        break;
      case 'bye':
        this.visitors.remove(message.id);
        break;
    }
  }

  update(dt: number): void {
    this.visitors.update(dt);
    if (this.status !== 'online') return;

    this.since += dt;
    const pose = this.sources.pose();
    // A unicorn standing still needs only a heartbeat; one being walked needs
    // enough updates to look like walking; one bouncing needs more still. A
    // pony resting between bounces has `m` false but is emphatically not idle,
    // which is why the yard is asked about first.
    const moving = pose.m || this.lastSent === null || this.lastSent.m;
    const rate = pose.p === 'studs' ? YARD_HZ : moving ? POSE_HZ : IDLE_HZ;
    if (this.since < 1 / rate) return;

    this.since = 0;
    this.lastSent = pose;
    this.transport.send({ t: 'pose', id: this.id, pose });
  }

  leave(): void {
    if (this.status === 'online') this.transport.send({ t: 'bye', id: this.id });
    this.transport.close();
  }
}
