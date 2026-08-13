/**
 * The spelling game's vocabulary.
 *
 * Every word is something already drawn for the meadow, so the picture the
 * child is spelling is the same object they have been walking past. `chunks`
 * are the pieces the easiest level hands out: the halves of a compound word
 * where there is one (jord + gubbe), otherwise plain syllables (spa + de).
 *
 * A word with a single chunk cannot be played on the easiest level — there
 * would be one tile and nothing to work out — so those are filtered out there
 * and still appear on the letter levels.
 */

export interface SpellingWord {
  /** Sprite id from the parts manifest — the picture shown. */
  partId: string;
  word: string;
  /** How the word breaks up for the easiest level, in order. */
  chunks: string[];
}

export const WORDS: SpellingWord[] = [
  { partId: 'jordgubbe', word: 'jordgubbe', chunks: ['jord', 'gubbe'] },
  { partId: 'hoball', word: 'höbal', chunks: ['hö', 'bal'] },
  { partId: 'vattenho', word: 'vattenho', chunks: ['vatten', 'ho'] },
  { partId: 'apelkorg', word: 'äppelkorg', chunks: ['äppel', 'korg'] },
  { partId: 'tuva_gras', word: 'grästuva', chunks: ['gräs', 'tuva'] },
  { partId: 'buske_bar', word: 'bärbuske', chunks: ['bär', 'buske'] },
  { partId: 'blommor_rosa', word: 'blomma', chunks: ['blom', 'ma'] },
  { partId: 'solros', word: 'solros', chunks: ['sol', 'ros'] },
  { partId: 'flugsvamp', word: 'flugsvamp', chunks: ['flug', 'svamp'] },
  { partId: 'nyckelpiga', word: 'nyckelpiga', chunks: ['nyckel', 'piga'] },
  { partId: 'fagelbo', word: 'fågelbo', chunks: ['fågel', 'bo'] },
  { partId: 'bikupa', word: 'bikupa', chunks: ['bi', 'kupa'] },
  { partId: 'fjaril', word: 'fjäril', chunks: ['fjä', 'ril'] },
  { partId: 'stubbe', word: 'stubbe', chunks: ['stub', 'be'] },
  { partId: 'spade', word: 'spade', chunks: ['spa', 'de'] },
  { partId: 'buske_rund', word: 'buske', chunks: ['bus', 'ke'] },
  { partId: 'moln_stort', word: 'moln', chunks: ['moln'] },
  { partId: 'trad_stort', word: 'träd', chunks: ['träd'] },
  { partId: 'sten_gra', word: 'sten', chunks: ['sten'] },
  { partId: 'brunn', word: 'brunn', chunks: ['brunn'] },
  { partId: 'horn_spiral', word: 'horn', chunks: ['horn'] },
  { partId: 'bajs_regnbage', word: 'bajs', chunks: ['bajs'] },
];

export type Difficulty = 'latt' | 'mellan' | 'svar';

export interface DifficultySpec {
  id: Difficulty;
  label: string;
  hint: string;
  icon: string;
}

export const DIFFICULTIES: DifficultySpec[] = [
  { id: 'latt', label: 'Lätt', hint: 'Sätt ihop ordet av två bitar', icon: '🌱' },
  { id: 'mellan', label: 'Mellan', hint: 'Några bokstäver saknas', icon: '🌿' },
  { id: 'svar', label: 'Svår', hint: 'Stava hela ordet själv', icon: '🌳' },
];

/** One playable puzzle: what the slots hold, and what is in the tray. */
export interface Puzzle {
  word: SpellingWord;
  /** One entry per slot; a string is already filled in, null is a blank. */
  slots: Array<string | null>;
  /** Loose pieces to place, already shuffled. */
  tray: string[];
}

/**
 * Splits a word into the units a level plays with: whole chunks on the easiest
 * level, single characters otherwise.
 *
 * Uses the spread operator rather than `split('')` so that any character which
 * needs more than one UTF-16 unit stays a single tile.
 */
function unitsFor(word: SpellingWord, difficulty: Difficulty): string[] {
  return difficulty === 'latt' ? word.chunks : [...word.word];
}

export function playableWords(difficulty: Difficulty): SpellingWord[] {
  // A one-chunk word makes a one-tile puzzle, which is not a puzzle.
  return difficulty === 'latt' ? WORDS.filter((w) => w.chunks.length > 1) : WORDS;
}

/**
 * How many pieces the child places on the middle level: about half the word,
 * never fewer than two (or it is trivial) and never more than five (or it is
 * just the hard level with extra steps).
 */
function blanksFor(length: number): number {
  return Math.max(2, Math.min(5, Math.round(length / 2)));
}

export function buildPuzzle(
  word: SpellingWord,
  difficulty: Difficulty,
  random: () => number,
): Puzzle {
  const units = unitsFor(word, difficulty);

  // Which positions the child fills in. Everything, except on the middle level.
  let blankAt: Set<number>;
  if (difficulty === 'mellan') {
    const wanted = blanksFor(units.length);
    const positions = units.map((_, i) => i);
    // Shuffle then take, so the gaps land in different places each time.
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [positions[i], positions[j]] = [positions[j]!, positions[i]!];
    }
    blankAt = new Set(positions.slice(0, wanted));
  } else {
    blankAt = new Set(units.map((_, i) => i));
  }

  const slots = units.map((unit, i) => (blankAt.has(i) ? null : unit));
  const tray = units.filter((_, i) => blankAt.has(i));

  // Shuffled, but never left in the order that would spell it out.
  for (let i = tray.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tray[i], tray[j]] = [tray[j]!, tray[i]!];
  }
  const solution = units.filter((_, i) => blankAt.has(i));
  if (tray.length > 1 && tray.every((t, i) => t === solution[i])) {
    [tray[0], tray[1]] = [tray[1]!, tray[0]!];
  }

  return { word, slots, tray };
}
