/** Colours and names the unicorn generator draws from. */

export interface NamedColour {
  label: string;
  hex: number;
}

/**
 * Not a colour at all: a marker meaning "run a rainbow across this part".
 *
 * Colours on a variant are plain numbers so they can be saved and compared, so
 * the rainbow rides along as a value no real colour can take. Anything reading
 * a colour has to check for it — see `sprite-material`, which switches the
 * shader to a hue ramp instead of a flat multiply.
 */
export const RAINBOW = -1;

/** Coat colours — soft and pastel, so the dark outlines still read. */
export const COATS: NamedColour[] = [
  { label: 'Regnbåge', hex: RAINBOW },
  { label: 'Rosa', hex: 0xffd3e0 },
  { label: 'Grädde', hex: 0xffeccd },
  { label: 'Himmelsblå', hex: 0xd4e7ff },
  { label: 'Lavendel', hex: 0xdfd4f7 },
  { label: 'Mint', hex: 0xcaeddc },
  { label: 'Persika', hex: 0xffd9b8 },
  { label: 'Smörgul', hex: 0xfff2c0 },
  { label: 'Snövit', hex: 0xfdfdfd },
  { label: 'Pärlgrå', hex: 0xe8e2dc },
  { label: 'Korall', hex: 0xffc3bd },
  { label: 'Isblå', hex: 0xc7e6f5 },
  { label: 'Karamell', hex: 0xe8cfae },
];

/** Mane and tail colours — bright, because that is the fun part. */
export const HAIR: NamedColour[] = [
  { label: 'Regnbåge', hex: RAINBOW },
  { label: 'Turkos', hex: 0x53bcd8 },
  { label: 'Rosa', hex: 0xff8fb8 },
  { label: 'Lila', hex: 0x9a7ce0 },
  { label: 'Orange', hex: 0xffa94d },
  { label: 'Grön', hex: 0x6fd39a },
  { label: 'Gul', hex: 0xffdc5e },
  { label: 'Röd', hex: 0xf4676f },
  { label: 'Vit', hex: 0xfbfbfb },
  { label: 'Blå', hex: 0x5b8fd6 },
  { label: 'Körsbär', hex: 0xe4557f },
];

/** Horn colours — mostly metallic. */
export const HORNS: NamedColour[] = [
  { label: 'Regnbåge', hex: RAINBOW },
  { label: 'Guld', hex: 0xffd479 },
  { label: 'Silver', hex: 0xe8eef4 },
  { label: 'Rosenguld', hex: 0xffc2b8 },
  { label: 'Pärlemor', hex: 0xdff2ea },
  { label: 'Kopparn', hex: 0xe9a97a },
];

/** Pattern colours, kept light so motifs stay visible on a pastel coat. */
export const PATTERN_COLOURS: NamedColour[] = [
  { label: 'Vit', hex: 0xffffff },
  { label: 'Guld', hex: 0xffd479 },
  { label: 'Rosa', hex: 0xff9ec4 },
  { label: 'Lila', hex: 0xb9a2ec },
  { label: 'Turkos', hex: 0x7fd6e6 },
];

/** First names for the unicorns you meet in the meadow. */
export const NAMES = [
  'Stjärna',
  'Glitter',
  'Pärla',
  'Måne',
  'Solstråle',
  'Blåbär',
  'Smulan',
  'Prinsessa',
  'Dimma',
  'Regnbåge',
  'Snöflinga',
  'Kanel',
  'Vanilj',
  'Sockerbit',
  'Hjärta',
  'Molnet',
  'Droppen',
  'Blomma',
  'Fjädern',
  'Klövern',
  'Kexet',
  'Sirap',
  'Frost',
  'Sagan',
  'Tuvan',
  'Nyponet',
  'Lakrits',
  'Marsipan',
] as const;
