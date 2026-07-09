// ページ間遷移の抽象化。通常ビルド(index.html/editor.html/terrain.htmlの複数ページ構成)では
// window.open で別ページ/別タブを開く(従来どおり)。単一ページ統合ビルド(all.html、
// VITE_EMBED_ASSETS=1でビルド)では、1つのHTMLの中で location.hash を切り替えて
// (src/app/all/main.ts が hashchange を検知して location.reload する)モードを切り替える。
// ?stage=draft 相当は単一ページビルドでは #game-draft ハッシュに対応させる。
//
// VITE_EMBED_ASSETS はアセット埋め込みと同時に「単一ページビルドかどうか」の判定にも使う
// (npm run build:artifact が常に両フラグをセットでON にするため。挙動が食い違うことはない)。
//
// 通常ビルド経路のURLは全て './editor.html' のようなルート相対でないパスにする(先頭に'/'を
// 付けない)。'/editor.html' のようなルート絶対パスだと、GitHub Pagesのようなサブパス配信
// (例: https://tnotty.github.io/Jumpman/)で https://tnotty.github.io/editor.html を指してしまい
// 404になる。相対パスなら現在ページ(index.html/editor.html/terrain.htmlはすべて同一ディレクトリの
// 兄弟ファイル)からの相対解決になるため、dev(base '/')・ビルド(base './'、サブパス配信含む)の
// どちらでも正しく解決される。

const isSinglePageBuild = import.meta.env.VITE_EMBED_ASSETS === '1';

function navigateToHash(hash: string): void {
  if (window.location.hash === hash) {
    // 既に同じハッシュの場合はhashchangeが発火しないため、明示的にリロードしてモードを再初期化する
    window.location.reload();
  } else {
    window.location.hash = hash;
  }
}

/** マップエディタを開く(通常ビルド: 新規タブでeditor.html / 単一ページビルド: #editorへ切替) */
export function openEditor(): void {
  if (isSinglePageBuild) {
    navigateToHash('#editor');
  } else {
    window.open('./editor.html', '_blank');
  }
}

/** 地形マスタエディタを開く(通常ビルド: 新規タブでterrain.html / 単一ページビルド: #terrainへ切替) */
export function openTerrainEditor(): void {
  if (isSinglePageBuild) {
    navigateToHash('#terrain');
  } else {
    window.open('./terrain.html', '_blank');
  }
}

/**
 * エディタのテストプレイ(draftステージ)としてゲームを開く。
 * 通常ビルド: 新規タブで index.html?stage=draft / 単一ページビルド: #game-draftへ切替。
 */
export function openGameDraft(): void {
  if (isSinglePageBuild) {
    navigateToHash('#game-draft');
  } else {
    window.open('./index.html?stage=draft', '_blank');
  }
}
