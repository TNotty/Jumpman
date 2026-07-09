// 単一ページ統合ビルド(dist-artifact/all.html, VITE_EMBED_ASSETS=1)専用のアセットローダー。
// fetch を一切使わず、SVGを生の文字列としてバンドルに埋め込み、data:image/svg+xml URLから
// Imageを生成する(CSP環境で追加のネットワークリクエストなしに動かすため)。
// manifest.json も fetch ではなく静的importで直接バンドルに含める。
//
// このファイルは assets.ts の loadAssets() から動的import()でのみ参照される。
// import.meta.env.VITE_EMBED_ASSETS !== '1' の通常ビルドでは、その分岐自体がビルド時に
// 静的に偽と判定され到達不能になるため、このファイル(および import.meta.glob が展開する
// 全SVGの生文字列)は通常ビルドの成果物には含まれない。
import type { AssetManifest, SpriteAsset } from './assets';
import { AssetStore } from './assets';
import manifestRaw from '../../public/assets/manifest.json';

// query: '?raw' + import: 'default' で、各SVGファイルの中身をそのまま文字列として得る。
// キーは '/public/assets/xxx/yyy.svg' のようなプロジェクトルート相対パスになる。
const svgSources = import.meta.glob('/public/assets/**/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function svgToDataUrl(svgSource: string): string {
  // btoa はLatin1前提のため、encodeURIComponent/unescapeでUTF-8バイト列に正規化してからBase64化する
  const base64 = btoa(unescape(encodeURIComponent(svgSource)));
  return `data:image/svg+xml;base64,${base64}`;
}

function loadEmbeddedImage(svgSource: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`埋め込みSVGの読み込みに失敗しました: ${label}`));
    image.src = svgToDataUrl(svgSource);
  });
}

/** manifest.json + 埋め込みSVGから全スプライトをプリロードして AssetStore を返す(fetchなし) */
export async function loadEmbeddedAssets(): Promise<AssetStore> {
  const manifest = manifestRaw as AssetManifest;

  const entries = await Promise.all(
    Object.entries(manifest).map(async ([name, entry]) => {
      const key = `/public/assets/${entry.src}`;
      const svgSource = svgSources[key];
      if (svgSource === undefined) {
        throw new Error(`埋め込みアセットが見つかりません: ${entry.src} (key=${key})`);
      }
      const image = await loadEmbeddedImage(svgSource, entry.src);
      const sprite: SpriteAsset = {
        image,
        frameW: entry.frameW,
        frameH: entry.frameH,
        frames: entry.frames,
      };
      return [name, sprite] as const;
    }),
  );

  return new AssetStore(new Map(entries));
}
