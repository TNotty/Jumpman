// 単一ページ統合ビルド(all.html, dist-artifact)のエントリポイント。
// location.hash (#game / #editor / #terrain。#game-draftはgameモードのdraftテストプレイ)を見て、
// 対応する<template>の中身「だけ」を実DOMへ複製し、対応するモードのmain.tsを動的import()する。
// ゲーム/エディタ/地形エディタの3モードを同時に起動するとキー入力やDOM要素IDが衝突するため、
// 常に1モードだけを実行する。hashが変わったときは単純にlocation.reload()して作り直す
// (SPAルーターは導入せず、シンプルさを優先する)。

type Mode = 'game' | 'editor' | 'terrain';

function resolveMode(hash: string): Mode {
  if (hash === '#editor') return 'editor';
  if (hash === '#terrain') return 'terrain';
  // '#game' ・ '#game-draft' ・ 未指定(空文字)はすべてgameモード扱い
  return 'game';
}

function cloneTemplateInto(templateId: string): void {
  const template = document.getElementById(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`#${templateId} が見つかりません`);
  }
  document.body.appendChild(template.content.cloneNode(true));
}

async function main(): Promise<void> {
  const mode = resolveMode(window.location.hash);
  // body[data-mode] に応じてCSSを切り替える(all.html参照)。テンプレートは複製するまで
  // 非表示(<template>の中身はレンダリングされない)なので、切替時のチラつきは発生しない。
  document.body.dataset.mode = mode;

  if (mode === 'editor') {
    cloneTemplateInto('tpl-editor');
    await import('../editor/main');
  } else if (mode === 'terrain') {
    cloneTemplateInto('tpl-terrain');
    await import('../terrain/main');
  } else {
    cloneTemplateInto('tpl-game');
    await import('../game/main');
  }
}

// hashchange(platform/navigation.ts の openEditor/openTerrainEditor/openGameDraft から発火)では
// 単純に再読込し、フレッシュな状態でresolveMode~モジュールimportをやり直す。
window.addEventListener('hashchange', () => {
  window.location.reload();
});

void main();
