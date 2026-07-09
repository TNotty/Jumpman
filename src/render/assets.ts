// アセットローダー。manifest.json を fetch して全画像をプリロードし、論理名で取得できるようにする。
// core層はアセットを一切知らない。描画コードは常にこのマニフェスト経由の論理名を使う。

export interface AssetManifestEntry {
  src: string;
  frameW: number;
  frameH: number;
  frames: number;
}

export type AssetManifest = Record<string, AssetManifestEntry>;

export interface SpriteAsset {
  image: HTMLImageElement;
  frameW: number;
  frameH: number;
  frames: number;
}

export class AssetStore {
  private readonly sprites: Map<string, SpriteAsset>;

  constructor(sprites: Map<string, SpriteAsset>) {
    this.sprites = sprites;
  }

  get(name: string): SpriteAsset {
    const sprite = this.sprites.get(name);
    if (!sprite) {
      throw new Error(`未登録のスプライト名です: ${name}`);
    }
    return sprite;
  }

  has(name: string): boolean {
    return this.sprites.has(name);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${src}`));
    image.src = src;
  });
}

/**
 * 既定のアセットベースURL。import.meta.env.BASE_URL(vite.config.tsのbase設定、既定 './')を
 * 基準にした相対パスにすることで、サブパス配信(itch.io等)でも絶対パス '/assets' 決め打ちにならず
 * 正しく解決できるようにする。
 */
function defaultAssetBaseUrl(): string {
  return `${import.meta.env.BASE_URL}assets`;
}

async function loadAssetsFromNetwork(baseUrl: string): Promise<AssetStore> {
  const response = await fetch(`${baseUrl}/manifest.json`);
  if (!response.ok) {
    throw new Error(`manifest.json の取得に失敗しました: ${response.status}`);
  }
  const manifest = (await response.json()) as AssetManifest;

  const entries = await Promise.all(
    Object.entries(manifest).map(async ([name, entry]) => {
      const image = await loadImage(`${baseUrl}/${entry.src}`);
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

/**
 * manifest.json を読み込み、全スプライトをプリロードして AssetStore を返す。
 * VITE_EMBED_ASSETS=1(単一ページ統合ビルド dist-artifact)の場合は fetch を一切使わず、
 * バンドルに埋め込んだSVG(embeddedAssets.ts)を使う。if/elseの両分岐を明示的に書くことで、
 * ビルド時にimport.meta.env.VITE_EMBED_ASSETSが静的に確定した際、どちらか片方の分岐
 * (未使用の方)がdead codeとして除去され、成果物に混入しないようにしている
 * (通常ビルドにembeddedAssets.tsの埋め込みSVGが、artifactビルドにfetch呼び出しが残らない)。
 */
export async function loadAssets(baseUrl: string = defaultAssetBaseUrl()): Promise<AssetStore> {
  if (import.meta.env.VITE_EMBED_ASSETS === '1') {
    const { loadEmbeddedAssets } = await import('./embeddedAssets');
    return loadEmbeddedAssets();
  } else {
    return loadAssetsFromNetwork(baseUrl);
  }
}
