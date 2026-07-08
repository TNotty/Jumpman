# ジャンプマン

自動で右に走り続ける棒人間「ジャンプマン」を、プレイヤーがクリックで地形を生成してゴールまで導く自動横スクロールパズルアクション。

- ターゲット: Steam(Electron/Tauri でラップ予定)→ iOS/Android(Capacitor 予定)
- 技術: TypeScript + HTML5 Canvas 2D(エンジン不使用)/ Vite / vitest

## 起動

```bash
npm install
npm run dev
```

| URL | 内容 |
|---|---|
| `/` (index.html) | ゲーム本体(タイトル→ステージ選択→プレイ) |
| `/editor.html` | マップエディタ |
| `/terrain.html` | 生成地形マスタエディタ |

## コマンド

```bash
npm run dev        # 開発サーバー
npm test           # ユニット+シナリオテスト (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # 型チェック + 本番ビルド (dist/)
```

## 遊び方

- ジャンプマンは自動で右に走り、崖・壁で自動ジャンプする(HP5、落下は即死、死ぬとチェックポイントから再開)
- 画面下 1/6 の地形パレット(8枠)から地形を選択: 左クリック / A・D / ←・→
- ゲーム領域を左クリックで選択中の地形を生成(マナ消費)、右クリックで1マス消去(コスト3)
- マナは 1/秒 で回復、最大50

## エディタ

- **マップエディタ**: ブロック4種・敵3種・スタート/ゴール/チェックポイントを配置。JSONダウンロード/読込、localStorage オートセーブ。「テストプレイ」で `index.html?stage=draft` が開き即プレイ可能
- **地形マスタエディタ**: プレイヤーが生成できる地形(形状 8×8・コスト・解放フラグ)を編集。「ゲームへ反映」で localStorage 経由でゲームに反映(同梱JSONより優先)
- エディタで作ったステージを同梱するには、ダウンロードした JSON を `src/data/stages/` に置き `src/app/game/main.ts` の stages 配列に追加する

## ディレクトリ構成

```
src/core/      純ロジック層(物理・自動ジャンプ・敵AI・マナ・配置)。DOM/Canvas/時刻/乱数に非依存 → vitest で決定論テスト
src/data/      JSONスキーマ検証、ステージ(stage01/02)、地形マスタ
src/render/    Canvas描画(レンダラ・カメラ・HUD・アセットローダー)
src/input/     マウス/キーボード → コマンド変換
src/app/       エントリ(game/editor/terrain)+固定タイムステップループ
src/platform/  localStorage/ファイルI/O 抽象化(Electron 化時の差し替え点)
public/assets/ 仮画像アセット(SVG)+ manifest.json
```

## 画像アセットの差し替え

現在の画像はすべて仮の SVG です。描画は `public/assets/manifest.json`(論理名 → `{src, frameW, frameH, frames}`)経由なので、**同名ファイルの上書き、またはマニフェストの `src` 書き換えだけで差し替え可能**です(PNG 可)。フレーム数・サイズもマニフェスト側で変更できます。

## データ形式

ステージ JSON のタイルは行文字列: `.`=空 / `N`=通常 / `B`=壊れる / `S`=トゲ / `F`=落ちる。
スキーマ検証は `src/data/schema.ts`(`validateStage` / `validateTerrainMaster`)。
