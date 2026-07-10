// public/assets/manifest.json の全エントリが実際のSVGファイルと整合していることを保証する
// 回帰テスト(frames数・frameWからSVGのwidth/heightが一意に決まる規約を検証する)。
// vitestはnode環境で動くため、fs直読みでSVGの中身を検証できる(DOM/canvas不要)。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifestRaw from '../../public/assets/manifest.json';
import type { AssetManifest } from './assets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', '..', 'public', 'assets');

const manifest = manifestRaw as AssetManifest;

function readSvgDimensions(path: string): { width: number; height: number } {
  const svg = readFileSync(path, 'utf8');
  const rootTagMatch = svg.match(/<svg[^>]*>/);
  if (!rootTagMatch) throw new Error(`<svg>ルート要素が見つかりません: ${path}`);
  const rootTag = rootTagMatch[0];
  const widthMatch = rootTag.match(/width="(\d+(?:\.\d+)?)"/);
  const heightMatch = rootTag.match(/height="(\d+(?:\.\d+)?)"/);
  if (!widthMatch || !heightMatch) throw new Error(`<svg>にwidth/height属性がありません: ${path}`);
  return { width: Number(widthMatch[1]), height: Number(heightMatch[1]) };
}

describe('manifest.json と実アセットSVGの整合性', () => {
  it('manifest.jsonは空でない', () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(manifest))('%s: SVGファイルが存在し、frames×frameW/frameHと実サイズが一致する', (name, entry) => {
    const path = join(ASSETS_DIR, entry.src);
    let dimensions: { width: number; height: number };
    expect(() => {
      dimensions = readSvgDimensions(path);
    }, `${name}(${entry.src})の読み込みに失敗`).not.toThrow();
    dimensions = readSvgDimensions(path);

    expect(dimensions.width, `${name}: svg width`).toBe(entry.frameW * entry.frames);
    expect(dimensions.height, `${name}: svg height`).toBe(entry.frameH);
  });

  it('ジャンプマンの全ポーズ(idle/run/jump/hit/dead)がmanifestに存在する', () => {
    for (const key of ['jumpman_idle', 'jumpman_run', 'jumpman_jump', 'jumpman_hit', 'jumpman_dead']) {
      expect(manifest[key], key).toBeDefined();
    }
  });

  it('ジャンプマンのフレーム数が要件どおり(idle=2, run=8, jump=2, hit=1, dead=1)', () => {
    expect(manifest['jumpman_idle']?.frames).toBe(2);
    expect(manifest['jumpman_run']?.frames).toBe(8);
    expect(manifest['jumpman_jump']?.frames).toBe(2);
    expect(manifest['jumpman_hit']?.frames).toBe(1);
    expect(manifest['jumpman_dead']?.frames).toBe(1);
  });

  it('敵のフレーム数が要件どおり(slime=4, frog=3, bird=4)', () => {
    expect(manifest['slime']?.frames).toBe(4);
    expect(manifest['frog']?.frames).toBe(3);
    expect(manifest['bird']?.frames).toBe(4);
  });
});
