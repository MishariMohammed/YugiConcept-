// Glue between Phaser scenes and the pure-TS duel engine.
// Scenes never talk to each other directly: they use scene keys + typed data
// objects below, and the `sceneBus` for results flowing back (arena -> duel).
import type Phaser from 'phaser';
import type { ArenaRequest, ArenaResult, PlayerId } from '../core/types';

export const SCENES = {
  Boot: 'Boot',
  Title: 'Title',
  Duel: 'Duel',
  Arena: 'Arena',
  Result: 'Result',
} as const;

/** Data passed to scene.start(SCENES.Duel, ...). */
export interface DuelSceneData {
  deck0: string;   // key in DECKS (human)
  deck1: string;   // key in DECKS (NPC)
  seed?: number;
}

/** Data passed to scene.launch(SCENES.Arena, ...). */
export interface ArenaSceneData {
  request: ArenaRequest;
  /** Which side the human controls in this fight. */
  humanPlayer: PlayerId;
}

/** Data passed to scene.start(SCENES.Result, ...). */
export interface ResultSceneData {
  winner: PlayerId | 'draw';
  humanPlayer: PlayerId;
  turns: number;
  lp: [number, number];
}

type BusEvents = {
  /** Emitted by ArenaScene when the fight ends; DuelScene feeds it to engine.resolveArena. */
  arenaResult: ArenaResult;
};

type Handler<T> = (payload: T) => void;

class TypedBus {
  private handlers: { [K in keyof BusEvents]?: Set<Handler<BusEvents[K]>> } = {};

  on<K extends keyof BusEvents>(ev: K, fn: Handler<BusEvents[K]>): () => void {
    const set = (this.handlers[ev] ??= new Set()) as Set<Handler<BusEvents[K]>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  once<K extends keyof BusEvents>(ev: K, fn: Handler<BusEvents[K]>): () => void {
    const off = this.on(ev, (p) => { off(); fn(p); });
    return off;
  }

  emit<K extends keyof BusEvents>(ev: K, payload: BusEvents[K]): void {
    const set = this.handlers[ev] as Set<Handler<BusEvents[K]>> | undefined;
    if (set) for (const fn of [...set]) fn(payload);
  }
}

export const sceneBus = new TypedBus();

/**
 * Launch the arena on top of `from` and resolve when ArenaScene reports a result.
 * ArenaScene must call `finishArena(this, result)` exactly once.
 */
export function runArena(from: Phaser.Scene, data: ArenaSceneData): Promise<ArenaResult> {
  return new Promise((resolve) => {
    sceneBus.once('arenaResult', resolve);
    from.scene.launch(SCENES.Arena, data);
    from.scene.bringToTop(SCENES.Arena);
  });
}

/** Called by ArenaScene: stop itself and hand the result back to the duel. */
export function finishArena(arena: Phaser.Scene, result: ArenaResult): void {
  arena.scene.stop();
  sceneBus.emit('arenaResult', result);
}
