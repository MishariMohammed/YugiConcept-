// Starter decks. Each deck is exactly 30 card ids (max 3 copies), validated by tools/validate-cards.ts.

export type DeckId = 'yugi' | 'kaiba';

export const DECKS: Record<DeckId, string[]> = {
  // 17 monsters (5 tribute) + 13 spells/traps. Spellcaster/Warrior/Rock defense with control traps.
  yugi: [
    // Tribute monsters (5)
    'dark-magician',
    'dark-magician-girl',
    'summoned-skull',
    'gaia-the-fierce-knight',
    'curse-of-dragon',
    // Level 1-4 (12)
    'celtic-guardian',
    'alpha-the-magnet-warrior',
    'beta-the-magnet-warrior',
    'gamma-the-magnet-warrior',
    'giant-soldier-of-stone',
    'kuriboh',
    'big-shield-gardna',
    'feral-imp',
    'mystical-elf',
    'breaker-the-magical-warrior',
    'silver-fang',
    'mammoth-graveyard',
    // Spells (9)
    'pot-of-greed',
    'dark-hole',
    'monster-reborn',
    'swords-of-revealing-light',
    'book-of-secret-arts',
    'legendary-sword',
    'rush-recklessly',
    'mystical-space-typhoon',
    'dian-keto-the-cure-master',
    // Traps (4)
    'mirror-force',
    'spellbinding-circle',
    'magic-cylinder',
    'waboku',
  ],
  // 18 monsters (5 tribute) + 12 spells/traps. Aggressive beatdown into Blue-Eyes, with removal.
  kaiba: [
    // Tribute monsters (5)
    'blue-eyes-white-dragon',
    'blue-eyes-white-dragon',
    'blue-eyes-white-dragon',
    'judge-man',
    'rude-kaiser',
    // Level 1-4 (13)
    'lord-of-d',
    'kaiser-sea-horse',
    'battle-ox',
    'la-jinn',
    'vorse-raider',
    'ryu-kishin-powered',
    'hitotsu-me-giant',
    'saggi-the-dark-clown',
    'x-head-cannon',
    'y-dragon-head',
    'z-metal-tank',
    'spear-dragon',
    'krokodilus',
    // Spells (8)
    'pot-of-greed',
    'raigeki',
    'fissure',
    'monster-reborn',
    'ookazi',
    'dark-energy',
    'rush-recklessly',
    'mystical-space-typhoon',
    // Traps (4)
    'trap-hole',
    'trap-hole',
    'sakuretsu-armor',
    'negate-attack',
  ],
};

export const DECK_META: Record<DeckId, { name: string; owner: string; description: string }> = {
  yugi: {
    name: 'Magician\'s Legacy',
    owner: 'Yugi',
    description: 'Dark Magician and friends. Sturdy walls, tricky traps, and a big finish.',
  },
  kaiba: {
    name: 'White Dragon Onslaught',
    owner: 'Kaiba',
    description: 'Hard-hitting beatdown that tributes into three Blue-Eyes White Dragons.',
  },
};
