/**
 * The meadow relay.
 *
 * One lobby, and it does exactly one thing: whatever a browser sends, everyone
 * else in the lobby gets. It never parses a message, never keeps game state,
 * and never decides anything — all of that lives in the clients, which each run
 * their own copy of the meadow. That is why this file is short, and why it
 * cannot be the thing that breaks the game.
 *
 * Deliberately plain Node with one dependency. There is nothing Azure-specific
 * in here, so the same server runs on a laptop, on App Service, or anywhere
 * else if we ever want to move it.
 *
 *   PORT=8080 node relay.js
 */

import { createServer } from 'node:http';

import { WebSocketServer } from 'ws';

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
    res.end(JSON.stringify({ ok: true, players: lobby.size }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: PATH, maxPayload: MAX_MESSAGE });

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

  socket.on('message', (data, isBinary) => {
    // The protocol is JSON text. Anything else is not this game.
    if (isBinary) return;

    for (const peer of lobby) {
      // Never echo to the sender: a browser must not be introduced to itself,
      // and the clients are written expecting a relay that behaves this way.
      if (peer === socket || peer.readyState !== peer.OPEN) continue;
      peer.send(data, { binary: false });
    }
  });

  socket.on('close', () => lobby.delete(socket));
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

wss.on('close', () => clearInterval(heartbeat));

http.listen(PORT, () => {
  console.log(`relay listening on :${PORT}${PATH}`);
});
