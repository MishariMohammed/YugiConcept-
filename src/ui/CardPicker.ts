// Modal card chooser (targets, discards, graveyard picks). Single-pick resolves on tap;
// multi-pick shows a CONFIRM button that enables once `count` cards are chosen.

import Phaser from 'phaser';
import type { CardDef } from '../core/types';
import { CardView } from './CardView';
import { PixelButton, dimmer, panelTexture } from './Widgets';
import { pixelText } from './PixelText';
import { PALT } from '../fx/art/Palette';

export interface PickItem { uid: number; def: CardDef; faceDown?: boolean; note?: string }

export interface PickOptions {
  title: string;
  items: PickItem[];
  /** exact number of cards to choose (default 1) */
  count?: number;
  cancellable?: boolean;
  depth?: number;
}

/** Resolves with the chosen uids, or null when cancelled. */
export function pickCards(scene: Phaser.Scene, opts: PickOptions): Promise<number[] | null> {
  const count = opts.count ?? 1;
  const depth = opts.depth ?? 4000;
  const W = scene.scale.width, H = scene.scale.height;
  const objs: Phaser.GameObjects.GameObject[] = [];
  const dim = dimmer(scene, 0.72, depth);
  objs.push(dim);
  const n = opts.items.length;
  const perRow = Math.min(n, 7);
  const rows = Math.ceil(n / perRow);
  const scale = rows > 2 ? 0.6 : rows > 1 ? 0.8 : 1;
  const cw = 48 * scale, ch = 68 * scale;
  const gap = 6;
  const panelW = Math.max(200, Math.min(W - 16, perRow * (cw + gap) + 24));
  const panelH = Math.min(H - 12, rows * (ch + 12) + 70);
  const px = W / 2, py = H / 2;
  const panel = scene.add.image(px, py, panelTexture(scene, Math.round(panelW), Math.round(panelH))).setDepth(depth + 1);
  objs.push(panel);
  const top = py - panelH / 2;
  objs.push(pixelText(scene, px, top + 8, opts.title, 1, PALT.gold, { originX: 0.5 }).setDepth(depth + 2));
  const chosen = new Set<number>();
  const views: CardView[] = [];
  return new Promise((resolve) => {
    const finish = (r: number[] | null) => {
      views.forEach((v) => v.destroy());
      objs.forEach((o) => o.destroy());
      resolve(r);
    };
    const confirm = count > 1 ? new PixelButton(scene, px + (opts.cancellable ? 34 : 0), top + panelH - 18, 60, 20, 'CONFIRM', PALT.blue, () => {
      if (chosen.size === count) finish([...chosen]);
    }) : null;
    if (confirm) { confirm.setDepth(depth + 3).setEnabled(false); objs.push(confirm); }
    if (opts.cancellable !== false) {
      const cancel = new PixelButton(scene, px - (confirm ? 34 : 0), top + panelH - 18, 60, 20, 'CANCEL', PALT.redDark, () => finish(null));
      cancel.setDepth(depth + 3);
      objs.push(cancel);
    }
    const counter = count > 1 ? pixelText(scene, px, top + 20, `0 / ${count}`, 1, PALT.cream, { originX: 0.5, tiny: true }).setDepth(depth + 2) : null;
    if (counter) objs.push(counter);
    opts.items.forEach((it, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const inRow = Math.min(perRow, n - r * perRow);
      const x = px + (c - (inRow - 1) / 2) * (cw + gap);
      const y = top + 34 + ch / 2 + r * (ch + 12);
      const v = new CardView(scene, x, y, it.def, { faceDown: it.faceDown, scale, raiseOnHover: false });
      v.setDepth(depth + 2);
      views.push(v);
      if (it.note) objs.push(pixelText(scene, x, y + ch / 2 + 2, it.note, 1, PALT.haze, { originX: 0.5, tiny: true }).setDepth(depth + 2));
      v.on('cardTap', () => {
        if (count === 1) { finish([it.uid]); return; }
        if (chosen.has(it.uid)) { chosen.delete(it.uid); v.setHighlight(null); }
        else if (chosen.size < count) { chosen.add(it.uid); v.setHighlight(PALT.red); }
        counter?.setText(`${chosen.size} / ${count}`);
        confirm?.setEnabled(chosen.size === count);
      });
    });
  });
}
