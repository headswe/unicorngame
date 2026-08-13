# Enhörningsängen 🦄

A scrolling unicorn meadow for a six-year-old. TypeScript, three.js, and a set of
sprites drawn by `gpt-image-2` that get stacked and recoloured at runtime so
every unicorn is different.

**▶ Play: <https://headswe.github.io/unicorngame/>**

On a tablet, "Add to Home Screen" opens it full-screen without browser chrome.

```bash
npm install
npm run dev          # http://localhost:5173
```

The generated art is committed, so you do not need image-API credentials just to
play — only to draw new parts.

## Controls

| | |
|---|---|
| Arrow keys / WASD | Walk |
| Tap or drag anywhere | Walk to that spot |
| **Min enhörning** | Open the wardrobe and dress your unicorn |
| Walk into the shovel | Pick it up |
| Tap a poop nearby (or Space) | Shovel it up |
| **✨** | Open the spellbook |
| Walk to the letter table | Play the spelling game |

Both schemes are live at once, so a laptop and a tablet behave the same.

## How a unicorn is put together

A unicorn is never drawn as one picture. It is a **recipe** — `UnicornVariant` in
`src/game/variant.ts` — naming a body, a horn, a mane, a tail and an optional
coat pattern, plus a colour for each:

```ts
{ bodyId: 'kropp_ludd', hornId: 'horn_trapp', maneId: 'man_fladar',
  tailId: 'svans_puff', patternId: 'mnst_stjarnor',
  coat: 0xffd3e0, maneColour: 0x53bcd8, hornColour: 0xffd479, … }
```

That is 3 bodies × 4 horns × 4 manes × 4 tails × 5 pattern states × 12 coats ×
10 hair colours — tens of thousands of combinations from 15 drawings. Because a
variant is plain data it can be rolled from a seed, saved, sent over a wire, or
edited one field at a time by a character creator later on.

Two pieces make that work:

**Tinting.** Every unicorn part is drawn in cream and pale grey, and the shader
in `src/engine/sprite-material.ts` multiplies it by the variant's colour. Dark
outlines stay dark, the coat becomes whatever colour you asked for, and coat
patterns are multiplied through the same shading so stars and hearts sit *in*
the fur rather than floating on it.

**The rig.** `src/game/rig.ts` holds three sockets per body — poll, crest and
dock — measured off the artwork, and a pivot for every horn, mane and tail. It
is a pure function with no three.js in it, so the offline preview and the game
run the exact same layout code and can never disagree.

## The art pipeline

```bash
export GPT_IMAGE_API="https://….../gpt-image-2/images/generations?api-version=…"
export GPT_IMAGE_KEY="…"

npm run gen:assets                    # draw anything not already cached
npm run gen:assets -- horn_ kropp_    # only matching ids
npm run gen:assets -- --force         # ignore the cache and redraw
npm run gen:assets -- --manifest-only # rebuild the manifest from the PNGs on disk
```

Every sprite is described as a prompt in `scripts/parts.ts` — the art bible. The
pipeline then:

1. **Generates** on a flat magenta field. The Azure deployment refuses
   `background: "transparent"`, so the background is chroma-keyed instead.
2. **Keys it out** (`tools/chroma.ts`). The key is flood-filled from the image
   border and from any unmistakably magenta pixel, which removes the holes
   inside a curly tail while never eating a pink mane in the middle of a sprite.
   Fringe pixels are de-spilled and the result is trimmed to its content.
3. **Writes** `public/assets/parts/<id>.png` plus
   `src/generated/parts-manifest.json`, rebuilt after every part so an
   interrupted run still leaves a playable game.

Raw API responses are cached in `.cache/images/` keyed by a hash of the prompt,
so re-running only pays for prompts that actually changed. The Azure S0 tier
throttles hard; parts are drawn one at a time and retries honour `Retry-After`.

### Adding a new part

1. Add a `PartSpec` to `scripts/parts.ts`.
2. `npm run gen:assets -- <your-id>`
3. `npx tsx scripts/grid.ts <your-id>` overlays a labelled 0..1 grid on the
   sprite so you can read its pivot straight off the picture.
4. Put that pivot in `PIVOT_BY_ID` in `src/game/rig.ts`.
5. `npx tsx scripts/preview.ts` renders nine assembled unicorns to
   `.cache/preview.png` in about a second — much faster than eyeballing it in
   the browser.

New bodies, horns, manes, tails and patterns are picked up by the random
generator automatically; scenery needs a line in the `SCATTER` table in
`src/game/world.ts`.

## How the world is drawn

The meadow is a flat field: `x` runs east, `y` runs away from you. Characters
are drawn in side view and the `y` axis is squashed to about half
(`DEPTH_SQUASH` in `src/engine/view.ts`), so walking north moves you up the
screen more slowly than walking east moves you sideways. That one trick is what
makes a stack of flat cut-outs read as a field you can wander around in.

- **Depth sorting** is done entirely with `renderOrder`, never the depth buffer
  — every sprite is a transparent cut-out. Anything further north is drawn
  first; parts within one character are separated by a small index.
- **The floor** is a shader, not tiles: a green wash with two frequencies of
  noise, so it stretches to the horizon without a seam and costs one draw call.
- **The backdrop** slides horizontally at a fraction of the camera's speed —
  hills at 14%, clouds at 30%. Vertically the hills stay put at the far edge, so
  walking north genuinely brings you closer to the horizon.
- **Colour** stays in sRGB byte space from PNG to pixel. `ColorManagement` is
  off and the renderer does no conversion, which is what keeps flat illustrated
  art looking like what the artist drew.

## Layout

```
scripts/parts.ts          the art bible — one prompt per sprite
scripts/generate-assets   generate → chroma-key → manifest
scripts/grid.ts           grid overlay for reading pivots off a sprite
scripts/preview.ts        offline sheet of assembled unicorns
scripts/tour.mjs          walks the world and screenshots it
tools/chroma.ts           magenta cut-out
tools/imagegen.ts         Azure gpt-image-2 client, cached and rate-limit aware

src/engine/               projection, sprites, tint shader, input, assets, rng
src/game/                 variant, rig, unicorn, player, npc, world, backdrop
```

## Debugging

`npm run dev` exposes `window.angen` with the world, camera, assets and player,
so you can poke at the meadow from the console:

```js
angen.player.y = 39            // teleport to the north edge
angen.world.residents.length   // how many unicorns live here
```

`node scripts/tour.mjs` walks the meadow and writes `.cache/tour-*.png`.

## The wardrobe

**Min enhörning** opens a dressing room: one tab per part, each offering that
part's shapes *and* its colours, because "pick a mane, pick its colour" is one
thought to a child rather than two. Options are pictures of the actual sprites,
so nothing depends on being able to read. There is a name field, a dice for
rolling a whole unicorn at once, and patterns can be switched off with **Inget**.

The preview is a real `Unicorn`, built by the same code that puts them in the
meadow, breathing on its own little stage — so it cannot show something the game
would draw differently. It gets its own WebGL context because the overlay covers
the meadow's canvas; textures are shared and three re-uploads them per context.

Every change is applied to the player's unicorn immediately rather than on
confirm, so closing the wardrobe never surprises anyone. The result is saved to
`localStorage` and comes back next visit.

**Regnbåge** is the first swatch in the coat, hair and horn rows. It is not a
colour: `RAINBOW` is a sentinel that switches the sprite shader from a flat
multiply to a hue ramp, so it costs no art and works on any part. The ramp runs
*down* the sprite rather than across it, so it survives the unicorn turning
round, and it is keyed off the texture coordinate rather than the quad — which
is what makes the ears, cut from the body, continue the body's rainbow instead
of running a private one. A random roll only turns one up occasionally; special
should stay special.

This is what `UnicornVariant` was designed for: editing a unicorn is setting
fields on plain data and rebuilding, with no editor-specific path through the
renderer. New parts appear in the wardrobe automatically — generating a fifth
mane puts a fifth card on the shelf with no UI changes at all.

## Caretaking

Unicorns leave rainbow poop behind them every half-minute or so. Walk into the
shovel lying near the spawn point to pick it up, then tap a poop within reach to
clear it — a tap aimed at a poop is swallowed so it does not also order a walk,
and a distant poop just walks you over instead of being cleaned from across the
meadow. Space does the same thing for keyboard players.

Sounds are synthesised in `src/engine/sfx.ts` rather than loaded: nothing to
download, and each one is a number to tune instead of a file to re-export. The
reward sounds are plain major and pentatonic runs, which are hard to make
unpleasant, and nothing is ever a buzzer. Magical sounds go through a reverb
send — the impulse response is generated too — which is most of what separates
"a beep" from "a spell". Footsteps are tied to distance travelled rather than a
clock, so they slow as the unicorn eases to a halt. All of it follows the music
on/off switch.

`node scripts/render-sfx.mjs` renders every sound to `.cache/sfx/*.wav` plus an
`all.wav` montage, by running the real `Sfx` class against an
`OfflineAudioContext` in a headless browser — so the files are exactly what the
game plays, not a reimplementation that can drift. It prints each sound's peak
and flags anything silent or clipping, which is how the levels were set against
the music at 0.18. Needs the dev server up.

## Spells

The ✨ button opens the spellbook. Pick a spell, then trace its sigil with a
finger or the mouse; a good enough trace casts it, a poor one shakes and invites
another go. Because the spell is chosen *before* the sigil is drawn, recognition
never has to work out which shape was intended — it only scores one stroke
against one template, which is both simpler and far more forgiving.

`src/game/sigil.ts` does the scoring with the normalisation half of the $1
unistroke recogniser: resample both strokes to 32 evenly spaced points, centre
and scale them, then average the distance between corresponding points. Closed
shapes are compared at every starting offset and in both directions, so it does
not matter where on the circle you start or which way round you go.

`npx tsx scripts/sigil-check.ts` scores synthetic strokes — clean, wobbly,
child-grade, and deliberately wrong — against every template and reports
anything that behaved unexpectedly. Worth re-running after touching a threshold:
a circle scores about 0.65 against the triangle, so the triangle's bar sits
above that.

Adding a spell is an entry in `src/game/spellbook.ts` plus a shape in
`sigil.ts`; the overlay and the recogniser need no changes.

## The spelling game

A picture, a row of slots, and pieces to put in them. Three levels of the same
puzzle, differing only in how big the pieces are:

| | |
|---|---|
| **Lätt** | `jordgubbe` → drag **jord** and **gubbe** |
| **Mellan** | about half the letters are given; drag the missing few |
| **Svår** | every letter, shuffled |

Words live in `src/game/words.ts`, each pointing at a sprite the meadow already
uses, so the picture is something the child has walked past. `chunks` is how the
easiest level breaks the word up — the halves of a compound (jord + gubbe) where
there is one, plain syllables (spa + de) otherwise. A one-chunk word makes a
one-tile puzzle, so those are skipped on the easiest level and still appear on
the letter levels.

Two ways to place a piece, both always live: dragging is the point, but it is
genuinely hard for a small hand on a tablet, so a plain tap drops a piece into
the first empty slot and a tap on a placed piece takes it back out.

Checking waits until every slot is full, then **keeps the letters that were
right and returns only the wrong ones**. Spelling `buske` as "besuk" leaves the
b and the s standing and hands back the rest — partial credit is visible, which
is how a child works out what they got wrong without being shown the answer.

The chosen level is remembered between visits.

## Music

Drop an audio file into `public/assets/music/` and it becomes the background
music — no code change and no filename to register. A small Vite plugin lists
whatever is in that folder (`.mp3`, `.ogg`, `.m4a`, `.wav`); several files play
as a playlist in filename order, a single file loops natively.

It plays at 18% volume (`VOLUME` in `src/engine/music.ts`), fades in, stops
while the tab is hidden, and can be switched off with the button in the HUD,
which is remembered between visits. Browsers refuse audio before the first
interaction, so the opening `play()` is expected to fail and is retried on the
first tap or key press.

The file is downloaded in full, so keep an eye on its size — it is currently the
largest thing in the build.

## Playing together

Two children on two machines see each other's unicorns walking around the same
meadow. One lobby, no room codes, no accounts, no chat, and no typed text
anywhere — names come from the game's own list.

The whole thing is affordable because **the meadow is generated, not stored**.
Every browser builds the identical field from the same seed — same trees, same
eighteen residents, same colours — so none of it is ever sent. That leaves
two things worth putting on the wire:

- **where each child's own unicorn is**, ten times a second while walking and
  twice a second while standing still, eased on the receiving end so it reads as
  a pony walking rather than a pony teleporting;
- **the spells they cast**, replayed from a seed so a strawberry shower lands in
  the same places on both screens. The egg is the exception: it sends its foal
  outright rather than a seed, because two children watching one egg must not
  see different ponies come out of it.

**A new meadow every morning.** The seed is the date (`src/game/day.ts`), so
the scenery, the hills and the whole herd are re-rolled each day. Two things
make a date usable as a shared seed. It is read in **one fixed timezone**, never
the device's — cousins can be in different countries, and two children in one
lobby looking at differently-arranged fields would be worse than any
arrangement. And the day turns over at **four in the morning**, not midnight, so
the meadow can never change shape under a child still using it on a late
holiday evening. The relay applies the same rule; if you change one, change the
other.

The shovel and the letter table keep their fixed spots, so they are still where
they were yesterday.

**The herd is shared without being sent.** Where each resident stands is a pure
function of the wall clock — see `src/game/npc.ts`. Time is chopped into legs of
a fixed length, the endpoints of leg *n* are hashed out of the resident's seed
and *n*, and a position is found by working out which leg the clock is in and
how far through it we are. Every browser gets the same answer, in constant time,
with nothing on the wire.

This replaced the obvious version — pick a target, walk toward it each frame —
which could not be shared. Two browsers integrating their own frame times drift
apart whenever one stutters, and much worse, a child opening the game half an
hour later starts every resident back at its spawn point. Eighteen ponies in the
wrong places is exactly the kind of thing two children on a call notice
immediately: "look at the blue one by the tree" has to mean something.

**The poop is shared the same way.** Each resident gets one hashed chance per
40-second slot to leave something, and because a resident's position can be
asked for at any *past* moment, each present lands exactly where that pony was
standing when it dropped it. Both children work out the same droppings from the
clock with nothing on the wire. Only the last twenty minutes are replayed on
opening — a meadow that greets a child with nine hours of accumulated poop is a
chore, not a game.

Shovelling *is* sent, because it is a choice rather than a consequence. Each
poop has a stable name (`resident:slot`), so "I cleaned `418:1042`" removes the
same one on every screen. A `hello` carries everything the sender has cleaned
today, which is how a child joining at four in the afternoon avoids arriving to
a field their cousin cleared at ten.

Still per-machine: who eats which strawberry. Nobody will ever notice.

### What the meadow remembers

Deriving things from the clock turned out to cover almost everything, which
leaves the store very small. Only the *choices* survive a reload:

| kept | why it can't be derived |
|---|---|
| shovelled poop | a choice, not a consequence |
| live eggs | cast at an arbitrary moment, carrying a rolled foal |
| hatchlings | the ponies the children made |

It is bucketed by the same date the field is seeded from and resets each
morning — **except the hatchlings, which carry over.** A pony a child made
should not be gone by breakfast, and since everything else about the meadow is
new each day, the foals they have made are the thread running through it.

The relay learns all of it by watching messages it is relaying anyway, so
clients tell it almost nothing extra. A live egg is stored with the moment it
was cast, so reopening the game resumes its timer rather than restarting it —
and if it was due while nobody was watching, the foal is simply there instead of
being made to hatch again.

Written to `/home/data/meadow.json` on App Service, whose `/home` survives a
worker recycle; `./data` locally, or set `ANGEN_DATA_DIR`. Saves are debounced
and written via a temporary file and a rename, so a recycle mid-write cannot
leave a half-file that fails to parse the next morning. If the file is
unreadable the relay starts with a fresh meadow rather than refusing to start —
losing a day's tidying is a shame, leaving the children with nothing is worse.

There is no host and no server-side authority — every browser runs its own
meadow and simply draws the others walking through it. Nothing in `src/net/` can
break single-player: with no relay reachable, the game just has nobody else in
it.

**Discovery repairs itself.** An introduction is a single `hello`, and on home
wifi one will eventually be lost, stranding a child in an empty meadow. So a
pose from an unknown peer is treated as evidence of a missed handshake and
answered with an ask-for-reply `hello`. Worth keeping if you touch this: it is
the difference between "it works on my desk" and "it works on a Sunday".

### Trying it with no server at all

`src/net/transport.ts` has two implementations behind one interface. With no
relay configured the game uses a `BroadcastChannel`, which joins up two tabs on
the same machine — that is how all of this was built and tested, and it means
the multiplayer code path is never cold even when you are working offline. Open
the game in two tabs and they will find each other.

### The relay

`server/` is a plain Node WebSocket server, about eighty lines, with one
dependency. It has exactly one job: whatever a browser sends, everyone else
gets. It never parses a message, never holds game state and never decides
anything, which is why it is short and why it cannot be the thing that breaks
the game. Nothing in it is Azure-specific.

```sh
cd server && npm install
PORT=8080 npm start          # ws://localhost:8080/angen
```

Point the game at it by setting `VITE_ANGEN_RELAY` at build time:

```sh
VITE_ANGEN_RELAY=wss://your-relay.azurewebsites.net/angen npm run build
```

It must be `wss://` in production — an HTTPS page cannot open a plain `ws://`
socket.

### Hosting it on Azure App Service

App Service is the boring choice, which is what you want for something children
rely on when nobody is around to restart it.

`infra/relay.bicep` is the whole infrastructure: one Linux App Service plan and
one web app. Nothing else — the relay keeps its state in a single JSON file
under `/home`, which App Service already gives us as persistent storage, so
there is no database and no storage account.

```sh
az group create --name angen --location swedencentral
az deployment group create -g angen -f infra/relay.bicep \
  -p appName=angen-relay-<something-of-yours>
```

It prints the `wss://…/angen` URL to use as `VITE_ANGEN_RELAY`.

**B1 is the smallest that works, not a preference.** WebSockets need Basic or
above, and Free and Shared cannot do Always On — without which the app unloads
between visits and the first child to arrive waits for a cold start. Basic
allows 350 concurrent WebSocket connections per instance, far more than one
family needs. The template turns on WebSockets and Always On, both of which are
off by default, and pins the app to a single worker.

**Never scale it out.** The lobby lives in one process's memory, so a second
instance is a second meadow that cannot see the first. Sticky sessions do not
help — they keep one client on one instance, they do not gather different
clients onto the same one.

`.github/workflows/deploy-relay.yml` publishes the relay on any push that
touches `server/`. It needs one secret, `AZURE_RELAY_PUBLISH_PROFILE`:

```sh
az webapp deployment list-publishing-profiles \
  -g angen -n angen-relay-<yours> --xml
```

Paste the XML into the repository secret of that name, and set `APP_NAME` at the
top of the workflow to match. The job installs production dependencies, checks
the relay starts and answers `/healthz` locally, deploys, and then waits for the
live URL to answer before it calls itself done — the relay is the one piece that
can be quietly down until a child tries to play.

The game and the relay deploy independently and always will: a broken relay
must never be able to stop the meadow loading.

App Service recycles workers for platform updates, so the socket *will* drop
during a long session even with Always On. `SocketTransport` reconnects with a
backoff and the session re-announces itself. Because the meadow is generated
from a seed rather than stored, coming back costs a second of reconnecting and
nothing else — the field rebuilds identically.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to the default branch. `base` is `'./'` in the Vite config, so the build is
path-independent — it works at a repo subpath, at a domain root, or straight off
the filesystem, with no rebuild.

To turn on multiplayer for the published game, set `VITE_ANGEN_RELAY` as a
repository variable and pass it through to the build step in that workflow.
Without it the deployed game is single-player, which is a safe default.

## Not built yet

Deliberately left for later, but the shape is in place for them:

- **Caring for the unicorns.** Hay bales, water troughs and apple baskets are
  already scattered around the field as scenery, waiting to become interactive.
- **Mini-games** — hide and seek, and the fishing and ring-toss from the book.
  `PlayerController.stop()` exists so a mini-game can take over the controls.
- **A character creator.** Every part carries a Swedish `label` and the variant
  is plain saved data, so a stable screen is mostly UI work.
