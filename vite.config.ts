import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// VITE_EMBED_ASSETS=1 のときだけ、単一ページ統合ビルド(all.html 1枚・dist-artifact出力)に切り替える。
// 通常の `npm run build`(VITE_EMBED_ASSETS未設定)は従来どおり index.html/editor.html/terrain.html の
// 3ページ構成のまま変更しない。npm run build:artifact がこのフラグをセットする。
const isArtifactBuild = process.env.VITE_EMBED_ASSETS === '1';

export default defineConfig({
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  plugins: isArtifactBuild ? [viteSingleFile()] : [],
  build: isArtifactBuild
    ? {
        outDir: 'dist-artifact',
        // 単一ページビルドではアセットをすべてSVG生文字列としてバンドルに埋め込む
        // (render/embeddedAssets.ts)ため、public/ をそのままコピーする必要がない。
        // コピーしないことで dist-artifact が本当に all.html 1枚だけになる。
        copyPublicDir: false,
        rollupOptions: {
          input: {
            all: 'all.html',
          },
        },
      }
    : {
        rollupOptions: {
          input: {
            main: 'index.html',
            editor: 'editor.html',
            terrain: 'terrain.html',
          },
        },
      },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
