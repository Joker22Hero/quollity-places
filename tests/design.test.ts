import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/design.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries(
  [...css.matchAll(/(--[a-z-]+):\s*(#[a-f0-9]{6})/g)].map((match) => [
    match[1],
    match[2],
  ]),
);
function luminance(hex: string) {
  const channels = hex
    .match(/[a-f\d]{2}/gi)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
describe('Places palette contrast', () => {
  it.each([
    ['--green', '--paper'],
    ['--muted', '--paper'],
    ['--muted', '--place-soft'],
    ['--place-terracotta', '--paper'],
    ['--place-terracotta', '--place-cream'],
    ['--place-oxblood', '--place-soft'],
    ['--surface', '--place-terracotta'],
    ['--place-cream', '--place-terracotta'],
    ['--surface', '--place-oxblood'],
  ])('keeps text %s on %s above WCAG AA', (ink, background) => {
    const values = [luminance(tokens[ink]), luminance(tokens[background])].sort(
      (a, b) => b - a,
    );
    expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps control boundaries visible on cream surfaces', () => {
    const values = [
      luminance(tokens['--control-line']),
      luminance(tokens['--surface']),
    ].sort((a, b) => b - a);
    expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(3);
  });
});
