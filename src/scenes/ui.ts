// Tiny placeholder UI helpers for the skeleton scenes (to be replaced by src/ui/*).
import Phaser from 'phaser';

export const FONT: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '8px',
  color: '#f4ecd8',
  resolution: 2,
};

export function label(scene: Phaser.Scene, x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return scene.add.text(x, y, text, { ...FONT, ...style });
}

export function button(
  scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void,
  opts: { color?: string; bg?: string; disabled?: boolean } = {},
) {
  const t = scene.add.text(x, y, text, {
    ...FONT,
    color: opts.disabled ? '#6b6378' : opts.color ?? '#f4ecd8',
    backgroundColor: opts.bg ?? '#3b2f4f',
    padding: { x: 3, y: 2 },
  });
  if (!opts.disabled) {
    t.setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#5d4a7d'));
    t.on('pointerout', () => t.setBackgroundColor(opts.bg ?? '#3b2f4f'));
    t.on('pointerup', onClick);
  }
  return t;
}
