/// <reference types="vite/client" />

// カスタム環境変数(Vite標準のDEV/PROD/MODE等に加えて)。
// VITE_ プレフィックスの環境変数は Vite がビルド時に自動でクライアントへ公開する。
interface ImportMetaEnv {
  /** '1' なら開発ビルドでなくてもエディタ導線(タイトルのリンク・プレイ中のボタン)を有効にする */
  readonly VITE_ENABLE_EDITOR?: string;
  /** '1' なら単一ページ統合ビルド(dist-artifact)向けにアセットを埋め込み+ページ内ハッシュ遷移にする */
  readonly VITE_EMBED_ASSETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
