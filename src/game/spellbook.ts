/**
 * What spells exist.
 *
 * Each one is a name, an icon, a sigil to trace and something that happens.
 * Adding a spell means adding an entry here and a shape in sigil.ts — the
 * casting UI and the recogniser do not need to know anything about it.
 */

import { SIGILS, type SigilTemplate } from './sigil.ts';

export interface Spell {
  id: string;
  /** Shown on the card in the spell picker. */
  name: string;
  /** One line telling a child what it does. */
  description: string;
  icon: string;
  sigil: SigilTemplate;
  /** Colour of the trail while tracing, and of the burst on success. */
  colour: string;
  /** Which signature sound plays when it lands. */
  sound: 'rain' | 'bloom' | 'egg';
}

export const SPELLS: Spell[] = [
  {
    id: 'jordgubbsregn',
    name: 'Jordgubbsregn',
    description: 'Det regnar jordgubbar! Enhörningarna kommer och äter.',
    icon: '🍓',
    // A strawberry is a triangle, which is also about the easiest closed shape
    // a small hand can draw.
    sigil: SIGILS.triangle!,
    colour: '#ff5f7e',
    sound: 'rain',
  },
  {
    id: 'blomstercirkel',
    name: 'Blomstercirkel',
    description: 'En ring av blommor slår ut runt dig.',
    icon: '🌸',
    sigil: SIGILS.circle!,
    colour: '#ff9ec4',
    sound: 'bloom',
  },
  {
    id: 'trollagg',
    name: 'Trollägg',
    description: 'Ett ägg dyker upp. Vänta — en liten enhörning kläcks!',
    icon: '🥚',
    // A heart, for a new little one. It is also the only one of the three a
    // child is likely to have drawn a hundred times already.
    sigil: SIGILS.heart!,
    colour: '#8ad6b8',
    sound: 'egg',
  },
];
