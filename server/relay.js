/**
 * The meadow relay.
 *
 * One lobby. Whatever a browser sends, everyone else in the lobby gets, the few
 * things worth keeping are written down (meadow.js), and — the part that makes
 * this a small game server rather than a pipe — the herd is simulated here and
 * broadcast (herd.js).
 *
 * The herd moved server-side because a pony that reacts to a child cannot also
 * be a pure function of the clock, which is how it used to stay in step across
 * browsers. One machine deciding is the ordinary way games do this, and it is
 * what makes feeding and following possible at all.
 *
 * Deliberately plain Node with one dependency. There is nothing Azure-specific
 * in here, so the same server runs on a laptop, on App Service, or anywhere
 * else if we ever want to move it.
 *
 *   PORT=8080 node relay.js
 */

import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

import { Herd, HERD_HZ, RESIDENTS, WORLD_BOUNDS, hashSeed, scatterTreats } from './herd.js';
import { Meadow, meadowSeed } from './meadow.js';

/** App Service tells the app which port to listen on. */
const PORT = Number(process.env.PORT ?? 8080);

/** Path the game connects to. Everything else is a plain HTTP response. */
const PATH = '/angen';

/**
 * Enough for a big family and a couple of cousins. A cap at all is the point:
 * one lobby on one small instance should not be able to fill up with hundreds
 * of connections and stop working for the children it was built for.
 */
const MAX_PLAYERS = 12;

/**
 * A pose message is about 80 bytes and a wardrobe announcement about 600. Ten
 * kilobytes is a wide margin that still refuses anything that is not the game.
 */
const MAX_MESSAGE = 10 * 1024;

/** A socket that has not answered a ping within two rounds is gone. */
const PING_INTERVAL = 30_000;

const http = createServer((req, res) => {
  // App Service pings the root to decide whether the app is alive.
  if (req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: lobby.size, day: meadow.snapshot().day }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: PATH, maxPayload: MAX_MESSAGE });

const meadow = new Meadow();

// --- the herd -------------------------------------------------------------
let herd = new Herd({ seed: meadowSeed(), count: RESIDENTS, bounds: WORLD_BOUNDS });
let herdDay = meadow.snapshot().day;

/** Berries currently on the grass, so the ponies know what to go after. */
let treats = [];

/**
 * Where each child is, so the ponies can notice them.
 *
 * The relay reads this off the pose messages it is already forwarding, which is
 * the whole trick: the herd learns about the children without anybody sending
 * anything extra.
 */
const players = new Map();

/** Puts the foals the children have hatched back into the herd. */
function stockFoals() {
  for (const born of meadow.snapshot().foals) {
    herd.add(born.foal.seed, born.x, born.y);
  }
}
stockFoals();

function broadcast(message) {
  const text = JSON.stringify(message);
  for (const peer of lobby) {
    if (peer.readyState === peer.OPEN) peer.send(text);
  }
}

let lastTick = Date.now();
const ticker = setInterval(() => {
  const now = Date.now() / 1000;
  // Capped at a tick and a half. setInterval drifts under load, and an
  // oversized step moves a pony further than its own walking speed allows —
  // which arrives on the children's screens as a lurch. Better that a busy
  // moment makes the meadow run a hair slow than that it teleports.
  const dt = Math.min(1.5 / HERD_HZ, now - lastTick / 1000);
  lastTick = Date.now();

  // A new morning: a new field deserves a new herd, but the ponies the children
  // made come with it.
  const day = meadow.snapshot().day;
  if (day !== herdDay) {
    herdDay = day;
    herd = new Herd({ seed: meadowSeed(), count: RESIDENTS, bounds: WORLD_BOUNDS });
    stockFoals();
    treats = [];
    broadcast({ t: 'roster', day, ponies: herd.roster() });
  }

  // Berries nobody got to are cleared once they have been lying a while, so a
  // forgotten shower does not keep the herd walking in circles forever.
  treats = treats.filter((tr) => !tr.eaten && now - tr.bornAt < 90);

  const { poops, eaten, cheers } = herd.tick(dt, now, treats, [...players.values()]);

  // Nobody is watching: still simulate, so the meadow has moved on when they
  // come back, but do not bother shouting about it.
  if (lobby.size === 0) return;

  broadcast({ t: 'herd', now, ponies: herd.snapshot() });
  for (const poop of poops) {
    const message = { t: 'poop', id: 'angen', poop: poop.id, x: poop.x, y: poop.y };
    meadow.observe(message);
    broadcast(message);
  }
  for (const id of eaten) broadcast({ t: 'eaten', id: 'angen', berry: id });
  if (cheers.length) broadcast({ t: 'cheer', ponies: cheers });
}, 1000 / HERD_HZ);
ticker.unref?.();

/** Everyone currently in the meadow. */
const lobby = new Set();

wss.on('connection', (socket) => {
  if (lobby.size >= MAX_PLAYERS) {
    socket.close(1013, 'full');
    return;
  }

  lobby.add(socket);
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  // Hand the newcomer the meadow as it stands, and who lives in it, before
  // anything else arrives.
  socket.send(JSON.stringify(meadow.snapshot()));
  socket.send(JSON.stringify({ t: 'roster', day: herdDay, ponies: herd.roster() }));

  socket.on('message', (data, isBinary) => {
    // The protocol is JSON text. Anything else is not this game.
    if (isBinary) return;

    // Watch what goes past, but never let a malformed message stop the relay
    // doing its actual job.
    try {
      const message = JSON.parse(data.toString());
      meadow.observe(message);
      absorb(message, socket);
    } catch {
      // Not JSON, or not something worth acting on. Relay it anyway.
    }

    for (const peer of lobby) {
      // Never echo to the sender: a browser must not be introduced to itself,
      // and the clients are written expecting a relay that behaves this way.
      if (peer === socket || peer.readyState !== peer.OPEN) continue;
      peer.send(data, { binary: false });
    }
  });

  socket.on('close', () => {
    lobby.delete(socket);
    // Forget where they were, or the ponies keep following a ghost.
    if (socket.peerId) players.delete(socket.peerId);
  });
  // A socket that errors is a socket that is leaving.
  socket.on('error', () => socket.terminate());
});

/**
 * A child who closes a laptop lid never sends a close frame, and the connection
 * can sit there for a long time before the OS notices. Pinging finds them.
 */
const heartbeat = setInterval(() => {
  for (const socket of lobby) {
    if (!socket.isAlive) {
      lobby.delete(socket);
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, PING_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(ticker);
});

/**
 * Takes note of anything in a relayed message that the herd needs to know.
 *
 * The clients still decide what the children do; the relay only learns the
 * consequences. A strawberry shower is the one that matters — the ponies cannot
 * chase berries they have never heard of.
 */
function absorb(message, socket) {
  if (message?.t === 'pose' && message.pose) {
    // Remembering which socket a child speaks through is what lets the ponies
    // stop following them the moment the laptop closes.
    if (socket) socket.peerId = message.id;
    players.set(message.id, { id: message.id, x: message.pose.x, y: message.pose.y });
  } else if (message?.t === 'bye') {
    players.delete(message.id);
  } else if (message?.t === 'pet') {
    // A child reached out to one. The herd decides whether they were actually
    // close enough, so a hopeful tap from across the meadow does nothing.
    if (herd.pet(message.pony, players.get(message.id), Date.now() / 1000)) {
      broadcast({ t: 'cheer', ponies: [message.pony] });
    }
  } else if (message?.t === 'spell' && message.spell === 'jordgubbsregn') {
    treats.push(
      ...scatterTreats(message.x, message.y, 14, 5.5, makeRng(message.seed), message.seed, message.at),
    );
  } else if (message?.t === 'eaten') {
    const treat = treats.find((tr) => tr.id === message.berry);
    if (treat) treat.eaten = true;
  } else if (message?.t === 'hatched' && message.foal) {
    // A newly hatched foal joins the herd where its shell was.
    herd.add(message.foal.seed, message.x, message.y);
    broadcast({ t: 'roster', day: herdDay, ponies: herd.roster() });
  }
}

/** mulberry32, matching the game's, so a shower lands where the caster saw it. */
function makeRng(seed) {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (min, max) => min + next() * (max - min) };
}

// A recycle should not lose the afternoon's tidying.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    void meadow.save().finally(() => process.exit(0));
  });
}

await meadow.load();
http.listen(PORT, () => {
  console.log(`relay listening on :${PORT}${PATH}`);
});
