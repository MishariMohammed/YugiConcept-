// Aggregator for duel-side effect handlers. The DuelEngine imports this file, so
// every effect module imported here is registered before a duel starts.
// The generic reference effects live in ../EffectRegistry.ts.
// Wave 2 (Card Designer): add `import './spells';`, `import './traps';` etc. below.
import '../EffectRegistry';
