// Card definition registry. Pure TS.
// Card data lives in src/data/cards.json (array of CardDef) and src/data/decks.ts
// (export const DECKS: Record<string, string[]>), owned by the Card Designer.
import type { CardDef } from '../types';

const registry = new Map<string, CardDef>();

/** Register (or overwrite) card definitions. */
export function registerCards(defs: readonly CardDef[]): void {
  for (const d of defs) {
    if (!d || typeof d.id !== 'string' || !d.id) throw new Error('registerCards: card without id');
    registry.set(d.id, d);
  }
}

/** Throws if the id is unknown. */
export function getCard(id: string): CardDef {
  const d = registry.get(id);
  if (!d) throw new Error(`Unknown card id "${id}"`);
  return d;
}

export function hasCard(id: string): boolean {
  return registry.has(id);
}

export function allCards(): CardDef[] {
  return [...registry.values()];
}

/** Test helper: empty the registry. */
export function clearCards(): void {
  registry.clear();
}

let defaultDecks: Record<string, string[]> = {};

/**
 * Lazily load src/data/cards.json + src/data/decks.ts when running under Vite/Vitest.
 * Uses import.meta.glob so a missing data file is not a build error (returns false).
 * Under plain Node/tsx (no Vite transform) this returns false: tools should read the
 * JSON themselves and call registerCards().
 */
export function loadDefaultCards(): boolean {
  let cardMods: Record<string, unknown> = {};
  let deckMods: Record<string, unknown> = {};
  try {
    cardMods = import.meta.glob('../../data/cards.json', { eager: true, import: 'default' });
    deckMods = import.meta.glob('../../data/decks.ts', { eager: true, import: 'DECKS' });
  } catch {
    return false; // not running under Vite
  }
  const cards = Object.values(cardMods)[0] as CardDef[] | undefined;
  if (!Array.isArray(cards)) return false;
  registerCards(cards);
  const decks = Object.values(deckMods)[0] as Record<string, string[]> | undefined;
  if (decks) defaultDecks = decks;
  return true;
}

/** Decks loaded by loadDefaultCards() (empty until then / if missing). */
export function getDecks(): Record<string, string[]> {
  return defaultDecks;
}
