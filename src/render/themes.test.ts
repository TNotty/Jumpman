import { describe, expect, it } from 'vitest';
import { ALL_THEMES, getTheme } from './themes';
import type { ThemeDefinition } from './themes';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

describe('themes(grass/caveの整合テスト)', () => {
  it('ALL_THEMESはgrass/caveの2件を含む', () => {
    expect(ALL_THEMES).toHaveLength(2);
    expect(ALL_THEMES.map((t) => t.id).sort()).toEqual(['cave', 'grass']);
  });

  it.each(ALL_THEMES)('$id は必須キー(sky/farLayer/midLayer/tile/editorBackground)をすべて持つ', (theme: ThemeDefinition) => {
    expect(isNonEmptyString(theme.sky.top), 'sky.top').toBe(true);
    expect(isNonEmptyString(theme.sky.bottom), 'sky.bottom').toBe(true);

    expect(isNonEmptyString(theme.farLayer.color), 'farLayer.color').toBe(true);
    expect(theme.farLayer.parallaxFactor, 'farLayer.parallaxFactor').toBeGreaterThanOrEqual(0);
    expect(theme.farLayer.parallaxFactor, 'farLayer.parallaxFactor').toBeLessThanOrEqual(1);

    expect(isNonEmptyString(theme.midLayer.color), 'midLayer.color').toBe(true);
    expect(theme.midLayer.parallaxFactor, 'midLayer.parallaxFactor').toBeGreaterThanOrEqual(0);
    expect(theme.midLayer.parallaxFactor, 'midLayer.parallaxFactor').toBeLessThanOrEqual(1);

    expect(isNonEmptyString(theme.tile.edgeHighlight), 'tile.edgeHighlight').toBe(true);
    expect(isNonEmptyString(theme.tile.edgeShadow), 'tile.edgeShadow').toBe(true);
    expect(isNonEmptyString(theme.tile.innerShade), 'tile.innerShade').toBe(true);

    expect(isNonEmptyString(theme.editorBackground), 'editorBackground').toBe(true);
    expect(isNonEmptyString(theme.cardHeaderColor), 'cardHeaderColor').toBe(true);
  });

  it('grass/caveのcardHeaderColorは異なる色である(草原=緑系/洞窟=青灰系が視覚的に区別できる)', () => {
    expect(getTheme('grass').cardHeaderColor).not.toBe(getTheme('cave').cardHeaderColor);
  });

  it('近景(midLayer)は遠景(farLayer)よりカメラ追従率が高い(視差の奥行きが逆転しない)', () => {
    for (const theme of ALL_THEMES) {
      expect(theme.midLayer.parallaxFactor, theme.id).toBeGreaterThan(theme.farLayer.parallaxFactor);
    }
  });

  it('grassは雲(cloud)を持ち、caveは持たない(現状の意図どおり)', () => {
    expect(getTheme('grass').cloud).toBeDefined();
    expect(getTheme('cave').cloud).toBeUndefined();
  });

  it('caveは結晶の発光色(glowColor)を持ち、grassは持たない(現状の意図どおり)', () => {
    expect(getTheme('cave').glowColor).toBeDefined();
    expect(getTheme('grass').glowColor).toBeUndefined();
  });

  it('cloudを持つテーマは、その中身(color/parallaxFactor/autoScrollPxPerSec)も必須キーがすべて有効', () => {
    const theme = getTheme('grass');
    expect(theme.cloud).toBeDefined();
    if (!theme.cloud) return;
    expect(isNonEmptyString(theme.cloud.color)).toBe(true);
    expect(theme.cloud.parallaxFactor).toBeGreaterThanOrEqual(0);
    expect(theme.cloud.autoScrollPxPerSec).toBeGreaterThan(0);
  });

  it('getTheme("grass")はgrassテーマを返す', () => {
    expect(getTheme('grass').id).toBe('grass');
  });

  it('getTheme("cave")および未知のテーマIDはcaveテーマを返す(既存のblockSpriteName等と同じ2値フォールバック規約)', () => {
    expect(getTheme('cave').id).toBe('cave');
    expect(getTheme('does-not-exist').id).toBe('cave');
    expect(getTheme('').id).toBe('cave');
  });
});
