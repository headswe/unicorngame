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
| **🔤** | Open the spelling game |

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

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to the default branch. `base` is `'./'` in the Vite config, so the build is
path-independent — it works at a repo subpath, at a domain root, or straight off
the filesystem, with no rebuild.

## Not built yet

Deliberately left for later, but the shape is in place for them:

- **Caring for the unicorns.** Hay bales, water troughs and apple baskets are
  already scattered around the field as scenery, waiting to become interactive.
- **Mini-games** — hide and seek, and the fishing and ring-toss from the book.
  `PlayerController.stop()` exists so a mini-game can take over the controls.
- **A character creator.** Every part carries a Swedish `label` and the variant
  is plain saved data, so a stable screen is mostly UI work.
