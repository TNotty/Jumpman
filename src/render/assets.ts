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

/** manifest.json を読み込み、全スプライトをプリロードして AssetStore を返す */
export async function loadAssets(baseUrl = '/assets'): Promise<AssetStore> {
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
