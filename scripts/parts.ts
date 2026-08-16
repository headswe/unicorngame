/**
 * The art bible.
 *
 * Every sprite in the game is described here as a prompt. Anything that gets
 * recoloured at runtime (bodies, manes, tails, horns) is drawn in near-white so
 * the tint shader has a clean base to multiply against; anything that keeps its
 * own colours (scenery, props) is drawn in full colour.
 */

import type { ImageSize } from '../tools/imagegen.js';

const STYLE =
  "children's picture book illustration in the style of a modern Swedish " +
  'picture book, soft gouache and coloured-pencil texture, thick dark brown ' +
  'hand-drawn outlines, flat cheerful colours, simple rounded cute shapes, ' +
  'gentle cel shading only';

const ISOLATED =
  'The subject is centered and fully inside the frame. The background is one ' +
  'completely flat solid pure magenta colour (hex #FF00FF) filling every ' +
  'corner of the image. No drop shadow, no ground, no grass, no floor, no ' +
  'vignette, no border, no text, no extra objects.';

/** Tintable parts are drawn nearly white so a multiply tint can colour them. */
const TINTABLE =
  'Draw it in creamy off-white and very pale warm grey ONLY, like an ' +
  'uncoloured plush toy, keeping the dark brown outlines and soft grey ' +
  'shading — it will be recoloured later, so use no other hue.';

export type PartKind =
  | 'body'
  | 'horn'
  | 'mane'
  | 'tail'
  | 'pattern'
  | 'decor'
  | 'prop'
  | 'cloud';

export interface PartSpec {
  /** Stable id, used in filenames and in save data. */
  id: string;
  kind: PartKind;
  /** Short Swedish label for the character creator. */
  label: string;
  prompt: string;
  size?: ImageSize;
  /** Skip tint at runtime and keep the generated colours. */
  fullColour?: boolean;
  /**
   * Nominal height of the sprite in world units, used to bring every part onto
   * a common scale. A standard unicorn body is 1.0.
   */
  worldHeight: number;
}

const body = (id: string, label: string,description: string): PartSpec => ({
  id,
  kind: 'body',
  label,
  worldHeight: 1,
  prompt:
    `${STYLE}. A cute unicorn foal's body seen exactly from the side in ` +
    `profile, facing right, standing squarely on all four legs, head held ` +
    `level. ${description} It has ears and one visible friendly eye with long ` +
    `eyelashes and a small smile. Very important: it is completely bald — ` +
    `NO horn on its head, NO mane along the neck, NO forelock between the ` +
    `ears, and NO tail at all; the rump ends in a smooth rounded curve. ` +
    `${TINTABLE} ${ISOLATED}`,
});

const horn = (id: string, label: string,description: string): PartSpec => ({
  id,
  kind: 'horn',
  label,
  worldHeight: 0.42,
  prompt:
    `${STYLE}. A single unicorn horn on its own, drawn from the side, ` +
    `pointing straight up and slightly to the right. It is long and slender — ` +
    `roughly four times taller than it is wide — with a narrow rounded base ` +
    `tapering to a fine point at the top. ${description} ${TINTABLE} ` +
    `${ISOLATED}`,
});

const mane = (id: string, label: string,description: string): PartSpec => ({
  id,
  kind: 'mane',
  label,
  worldHeight: 0.62,
  prompt:
    `${STYLE}. Only the hair of a unicorn's mane, cut out on its own with no ` +
    `head, no neck and no body behind it. Seen from the side for a unicorn ` +
    `facing right: a forelock tuft at the top right falling forward between ` +
    `where the ears would be, flowing down and to the left into the neck ` +
    `hair, the left edge roughly straight where it would meet the neck. ` +
    `${description} ${TINTABLE} ${ISOLATED}`,
});

const tail = (id: string, label: string,description: string): PartSpec => ({
  id,
  kind: 'tail',
  label,
  worldHeight: 0.6,
  prompt:
    `${STYLE}. Only a unicorn's tail, cut out on its own with no body, no ` +
    `rump and nothing else attached. It hangs down and curves to the left, ` +
    `attached at its top right corner. ${description} ${TINTABLE} ${ISOLATED}`,
});

const pattern = (id: string, label: string,description: string): PartSpec => ({
  id,
  kind: 'pattern',
  label,
  worldHeight: 1,
  prompt:
    `${STYLE}. A seamless scattered decorative pattern of ${description} spread ` +
    `evenly across the whole square image, small motifs with plenty of space ` +
    `between them, drawn in solid creamy off-white with thin dark brown ` +
    `outlines. The motifs sit on a completely flat solid pure magenta ` +
    `(hex #FF00FF) background that shows between them and fills every corner. ` +
    `No text, no border, no frame.`,
});

const decor = (
  id: string,
  label: string,
  description: string,
  worldHeight: number,
): PartSpec => ({
  id,
  kind: 'decor',
  label,
  worldHeight,
  fullColour: true,
  prompt: `${STYLE}. ${description} ${ISOLATED}`,
});

const prop = (
  id: string,
  label: string,
  description: string,
  worldHeight: number,
): PartSpec => ({
  id,
  kind: 'prop',
  label,
  worldHeight,
  fullColour: true,
  prompt: `${STYLE}. ${description} ${ISOLATED}`,
});

export const PARTS: PartSpec[] = [
  // --- bodies ---------------------------------------------------------------
  body(
    'kropp_normal',
    'Vanlig',
    'A friendly pony-shaped body with a rounded belly and sturdy short legs.',
  ),
  body(
    'kropp_liten',
    'Liten',
    'A very small chubby baby foal with a big round head, a stubby muzzle and ' +
      'short thick little legs.',
  ),
  body(
    'kropp_ludd',
    'Luddig',
    'A fluffy woolly body with soft shaggy fur along the chest, belly and ' +
      'above the hooves, and slightly longer legs.',
  ),

  // --- horns (the four kinds from the book) ---------------------------------
  horn(
    'horn_spiral',
    'Spiralhorn',
    'It is a classic spiral horn with a deep twisting groove winding around ' +
      'it from base to tip, like a narwhal tusk.',
  ),
  horn(
    'horn_slatt',
    'Slätt horn',
    'It is perfectly smooth with no grooves at all, sleek and glossy with a ' +
      'bright highlight running along it.',
  ),
  horn(
    'horn_trapp',
    'Trapphorn',
    'It is a chunky stepped horn built from about six stacked rounded ' +
      'segments of decreasing size, like a little staircase or a stack of ' +
      'rings, knobbly and thick.',
  ),
  horn(
    'horn_bojt',
    'Böjt horn',
    'It is a rare curved horn shaped like a crescent moon or a sabre tooth, ' +
      'bending in a smooth arc to the left.',
  ),

  // --- manes ----------------------------------------------------------------
  mane('man_vagig', 'Vågig', 'The hair is long, smooth and wavy with soft flowing locks.'),
  mane('man_lockig', 'Lockig', 'The hair is a mass of bouncy round curls and ringlets.'),
  mane('man_taggig', 'Taggig', 'The hair is short, spiky and punky, standing up in sharp tufts.'),
  mane('man_fladar', 'Flätor', 'The hair is gathered into two chunky plaited braids tied with little bows.'),

  // --- tails ----------------------------------------------------------------
  tail('svans_lang', 'Lång', 'It is a long, smooth, wavy tail reaching almost to the ground.'),
  tail('svans_puff', 'Puff', 'It is a short round fluffy pom-pom puff of a tail.'),
  tail('svans_lockig', 'Lockig', 'It is a curly tail made of springy corkscrew ringlets.'),
  tail('svans_fjader', 'Fjäder', 'It is a light feathery tail that fans out into wispy strands.'),

  // --- coat patterns --------------------------------------------------------
  pattern('mnst_stjarnor', 'Stjärnor', 'small five-pointed stars of slightly varying size'),
  pattern('mnst_prickar', 'Prickar', 'simple round polka dots of slightly varying size'),
  pattern('mnst_hjartan', 'Hjärtan', 'small plump hearts'),
  pattern('mnst_flackar', 'Fläckar', 'soft irregular rounded patches like a dappled pony coat'),

  // --- scenery --------------------------------------------------------------
  decor(
    'buske_rund',
    'Buske',
    'A single round leafy bush of dark blue-green foliage, drawn as a soft ' +
      'rounded clump seen slightly from above, with a few tiny lighter leaves.',
    0.7,
  ),
  decor(
    'buske_bar',
    'Bärbuske',
    'A single small bushy shrub of deep green leaves dotted with tiny red ' +
      'berries, a soft rounded clump seen slightly from above.',
    0.6,
  ),
  decor(
    'trad_stort',
    'Träd',
    'A single cheerful storybook tree with a slim warm-brown trunk and a big ' +
      'round soft canopy of layered green leaves, seen from the side.',
    2.4,
  ),
  decor(
    'blommor_vita',
    'Vita blommor',
    'A small cluster of about six tiny white wild flowers with thin green ' +
      'stems and slender leaves, like cow parsley, drawn very delicately.',
    0.35,
  ),
  decor(
    'blommor_rosa',
    'Rosa blommor',
    'A small cluster of about six little pink and yellow meadow flowers on ' +
      'thin green stems.',
    0.35,
  ),
  decor(
    'sten_gra',
    'Sten',
    'A single smooth rounded grey river stone with a soft white highlight on ' +
      'top, seen slightly from above.',
    0.4,
  ),
  decor(
    'tuva_gras',
    'Grästuva',
    'A small tuft of green meadow grass, a handful of thin blades fanning ' +
      'upward from one point.',
    0.3,
  ),

  // --- props (groundwork for the caretaking that comes later) ---------------
  decor(
    'hoball',
    'Höbal',
    'A round golden bale of hay tied with two brown straps, seen from the ' +
      'side, cheerful and neat.',
    0.75,
  ),
  decor(
    'vattenho',
    'Vattenho',
    'A wooden trough full of clear blue water with a tiny yellow rubber duck ' +
      'floating in it, seen from the side at a slight angle.',
    0.5,
  ),
  decor(
    'apelkorg',
    'Äppelkorg',
    'A woven wicker basket piled with shiny red apples, seen from the side.',
    0.45,
  ),

  decor(
    'flugsvamp',
    'Flugsvamp',
    'A single toadstool seen from the side: a bright red domed cap with ' +
      'round white spots and a short fat creamy white stalk with a little ' +
      'frill around it.',
    0.55,
  ),
  decor(
    'solros',
    'Solros',
    'One tall sunflower seen from the side: a straight green stem with two ' +
      'broad leaves and a big round flower head of bright golden petals ' +
      'around a dark brown seedy middle, turned to face the viewer.',
    1.9,
  ),
  decor(
    'fjaril',
    'Fjäril',
    'A single butterfly seen from above with both wings spread open, drawn ' +
      'symmetrically: rounded upper and lower wings in soft lilac and warm ' +
      'pink with pale cream spots along the edges, a small dark body and two ' +
      'curled antennae.',
    0.4,
  ),
  decor(
    'nyckelpiga',
    'Nyckelpiga',
    'One ladybird seen from above: a round glossy red shell with a neat ' +
      'black line down the middle and five big round black spots, a small ' +
      'black head with two tiny antennae, and six little legs.',
    0.3,
  ),
  decor(
    'stubbe',
    'Stubbe',
    'A short wide tree stump seen from the side: a sawn-off trunk of warm ' +
      'brown bark with a pale sanded top showing a few tree rings, a couple ' +
      'of gnarled roots at the base and a small green sprout with two leaves ' +
      'growing out of one side.',
    0.75,
  ),
  decor(
    'fagelbo',
    'Fågelbo',
    'A small round bird nest seen from the side and slightly above: a bowl ' +
      'woven from fine golden brown twigs and dry grass, holding three ' +
      'little pale blue speckled eggs.',
    0.45,
  ),
  decor(
    'bikupa',
    'Bikupa',
    'A traditional straw beehive seen from the side: a rounded dome of ' +
      'coiled honey-coloured straw in stacked rings, narrowing towards the ' +
      'top, with a small dark arched entrance hole near the bottom and two ' +
      'tiny friendly striped bees flying beside it.',
    0.95,
  ),
  decor(
    'brunn',
    'Brunn',
    'A little wishing well seen from the side: a low round wall of grey ' +
      'cobblestones, two short wooden posts holding a small peaked roof of ' +
      'red wooden shingles, and a wooden bucket hanging from a rope under ' +
      'the roof.',
    1.7,
  ),

  // --- caretaking props -----------------------------------------------------
  prop(
    'bajs_regnbage',
    'Regnbågsbajs',
    'A small, tidy cartoon poop: the classic soft-serve spiral of three ' +
      'coils stacked into a point, coloured in bright rainbow stripes — red, ' +
      'orange, yellow, green, blue and violet swirling up the spiral — with a ' +
      'couple of little sparkles. It looks sweet and clean, like swirled ' +
      'frosting, not dirty at all. Very important: it has NO face — no eyes, ' +
      'no mouth, no eyebrows, no blushing cheeks, no expression of any kind. ' +
      'It is only the plain rainbow swirl.',
    0.46,
  ),
  prop(
    'spade',
    'Spade',
    'A small garden scoop shovel lying on its side, with a rounded wooden ' +
      'handle and a shiny pale metal blade, seen from the side.',
    0.35,
  ),

  prop(
    'jordgubbe',
    'Jordgubbe',
    'A single ripe strawberry seen from the side: a plump red heart-shaped ' +
      'berry with tiny pale seed specks and a small green leafy crown on top. ' +
      'Glossy and appetising.',
    0.4,
  ),

  prop(
    'bokstavsbord',
    'Bokstavsbord',
    'A small low wooden play table seen from the side, with four sturdy ' +
      'rounded legs and a warm honey-coloured top. On the table top stand a ' +
      'few chunky painted alphabet blocks in red, blue, yellow and green, ' +
      'each with a big clear letter on its face, plus a couple more blocks ' +
      'leaning against each other and one small stack. A rolled-up sheet of ' +
      'paper and a stubby pencil lie beside them. It looks inviting, like a ' +
      'little outdoor school desk in a meadow.',
    1.4,
  ),

  /**
   * The gate through to the bouncing yard, and the trampoline in it.
   *
   * The gate stands in the meadow and is drawn in the meadow's own three-
   * quarter way; the trampoline is only ever seen from the side, because the
   * yard is drawn flat-on like a picture book spread rather than as a field you
   * look across. That is why it is a proper side view and not a squashed one.
   */
  prop(
    'grind',
    'Grind',
    'A wide wooden garden gate standing open in a short white picket fence, ' +
      'seen from the front and slightly above. The gate is painted pale mint ' +
      'green with a carved heart in the middle, the posts are honey-coloured ' +
      'wood with round tops, and a garland of tiny pink and yellow flowers is ' +
      'wound along the top rail. A few tiny four-pointed sparkle stars float ' +
      'over the opening. It looks welcoming, like a way through to somewhere.',
    2.4,
  ),
  prop(
    'studsmatta',
    'Studsmatta',
    'A round garden trampoline seen exactly from the side at ground level, ' +
      'so the mat is a straight horizontal line rather than an ellipse. A ' +
      'thick padded rim in bright turquoise runs along the top edge, the ' +
      'stretchy mat between is dark slate blue, and four sturdy honey-wood ' +
      'legs splay out below it to the ground. The whole thing is low, wide ' +
      'and bouncy-looking.',
    1.15,
  ),

  /**
   * The magic flower an egg grows inside, closed and then open.
   *
   * Straight out of the picture book the whole egg spell comes from: a unicorn
   * family that wants a foal grows a magic flower, and when it opens there is
   * an egg inside. The two drawings have to be the same plant at the same size
   * and standing in the same place, because the game swaps one for the other —
   * anything that moves between them reads as a glitch rather than as opening.
   */
  prop(
    'magiblomma',
    'Magisk blomma',
    'A single tall closed flower bud on one dark green stem with two large ' +
      'pointed leaves, seen exactly from the side. The bud is a big smooth ' +
      'teardrop of overlapping petals shading from deep pink at the base to ' +
      'warm coral and pale gold at the tip, held tightly shut. Three tiny ' +
      'four-pointed sparkle stars float around the bud. It looks magical and ' +
      'about to open.',
    2.1,
  ),
  prop(
    'magiblomma_oppen',
    'Öppen magisk blomma',
    'A single tall open flower on one dark green stem with two large pointed ' +
      'leaves, seen exactly from the side — the same plant as a closed bud, ' +
      'the same height, the same stem and the same leaves, but now bloomed. ' +
      'Seven long petals shading from deep pink at the base to warm coral and ' +
      'pale gold at the tips are spread wide and curve outward and downward ' +
      'like an open cup, leaving the middle of the flower completely empty ' +
      'and open. A few pale golden stamens and four tiny four-pointed sparkle ' +
      'stars float around it. Nothing is inside the flower.',
    2.1,
  ),

  /**
   * The hatching egg. Drawn near-white like the unicorn parts, because it is
   * tinted with the coat colour of the foal inside and takes that foal's coat
   * pattern through the same shader — the egg is a preview of what is coming.
   */
  {
    id: 'agg',
    kind: 'prop',
    label: 'Ägg',
    worldHeight: 0.9,
    prompt:
      `${STYLE}. A single large smooth egg standing upright on its blunt end, ` +
      `seen exactly from the side: a clean unbroken oval, wider at the bottom ` +
      `and narrower at the top, with a completely plain smooth surface — no ` +
      `speckles, no spots, no cracks, no patterns and no markings of any ` +
      `kind. ${TINTABLE} ${ISOLATED}`,
  },
  {
    id: 'agg_spricka',
    kind: 'prop',
    label: 'Sprucket ägg',
    worldHeight: 0.9,
    prompt:
      `${STYLE}. A single large egg standing upright on its blunt end, seen ` +
      `exactly from the side, exactly the same oval shape and size as an ` +
      `unbroken egg but with one jagged zig-zag crack running across the ` +
      `upper third and two shorter cracks branching down the side. The shell ` +
      `is still whole and closed — nothing is coming out and there is no hole ` +
      `— and the surface is otherwise completely plain with no speckles or ` +
      `patterns. ${TINTABLE} ${ISOLATED}`,
  },

  /**
   * The "this one is yours" marker that floats over a player's unicorn.
   *
   * Drawn near-white so it can be tinted: the child's own gets one colour and
   * each visiting friend another, which is the whole point of it.
   */
  {
    id: 'pekare',
    kind: 'prop',
    label: 'Pekare',
    worldHeight: 0.42,
    prompt:
      `${STYLE}. A single plump downward-pointing arrow, seen straight on, ` +
      `like a friendly signpost marker hanging in the air. It has a wide ` +
      `rounded top that tapers to a soft rounded point at the bottom, gently ` +
      `puffy rather than sharp, with a small soft highlight near the top. ` +
      `Just the arrow on its own — no pole, no string, no text, no other ` +
      `shapes. ${TINTABLE} ${ISOLATED}`,
  },

  prop(
    'hjartan',
    'Hjärtan',
    'Three small puffy hearts of slightly different sizes floating in a loose ' +
      'cluster, the biggest at the bottom, in warm pink and rose with tiny ' +
      'white shine spots. Soft rounded storybook hearts, cheerful and simple. ' +
      'Nothing else in the picture.',
    0.5,
  ),

  // --- sky ------------------------------------------------------------------
  {
    id: 'moln_stort',
    kind: 'cloud',
    label: 'Moln',
    worldHeight: 1.6,
    fullColour: true,
    size: '1536x1024',
    prompt:
      `${STYLE}. A single soft fluffy white cloud with a gently bumpy top ` +
      `and a flat bottom, painted in white with the faintest pale blue ` +
      `shading underneath. ${ISOLATED}`,
  },
  {
    id: 'moln_litet',
    kind: 'cloud',
    label: 'Litet moln',
    worldHeight: 0.9,
    fullColour: true,
    size: '1536x1024',
    prompt:
      `${STYLE}. A small wispy white cloud, three soft rounded puffs joined ` +
      `together, painted in white with a hint of pale blue underneath. ` +
      `${ISOLATED}`,
  },
  {
    id: 'kullar',
    kind: 'decor',
    label: 'Kullar',
    worldHeight: 3,
    fullColour: true,
    size: '1536x1024',
    prompt:
      `${STYLE}. A row of gently rolling distant hills stretching all the way ` +
      `across the image from the left edge to the right edge, painted in ` +
      `hazy soft blue-green, with a few tiny simple trees dotted on top. ` +
      `Only the hills — the bottom of the image is filled by the hills and ` +
      `everything above the hilltops is one completely flat solid pure ` +
      `magenta colour (hex #FF00FF) reaching the top corners. No sky ` +
      `gradient, no sun, no clouds, no text.`,
  },
];

export const PARTS_BY_KIND = (kind: PartKind): PartSpec[] =>
  PARTS.filter((p) => p.kind === kind);
