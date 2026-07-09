// ステージJSON生成スクリプト(手書きの代わり)。600タイル前後の長いステージを5本、
// 難易度カーブ(導入→洞窟のギミック→複合)に沿って機械的に組み立てて src/data/stages/*.json に書き出す。
// 実行: node scripts/generateStages.mjs
//
// 設計方針(安全側に倒す):
// - 床は常に2行厚(floorTop/floorBottom)。
// - gaps(要橋渡しの穴): 2行とも空にする。幅は自動ジャンプの限界(約4タイル)を大きく超える
//   8〜9タイルにし、必ずプレイヤーが地形生成で橋を架けないと越えられないようにする。
// - hazards(壊れる/トゲ/落ちるブロック): floorTop側だけを置き換え、floorBottomは安全網として
//   常にNのまま残す。トゲは非固体なので自動ジャンプの崖センサーが検知して自動回避されやすく、
//   壊れる/落ちるブロックも万一崩れて落ちても安全網の床に着地するだけで即死しない。
// - 敵/チェックポイント/ゴールはgapsとhazardsのx範囲に重ならない位置に配置する。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'data', 'stages');

/**
 * @param {{x:number,width:number}[]} gaps
 * @param {{x:number,width:number,char:'B'|'S'|'F'}[]} hazards
 */
function buildTiles(width, height, gaps, hazards) {
  const floorTopY = height - 2;
  const floorBottomY = height - 1;
  const rows = Array.from({ length: height }, () => new Array(width).fill('.'));

  for (let x = 0; x < width; x++) {
    rows[floorTopY][x] = 'N';
    rows[floorBottomY][x] = 'N';
  }
  for (const gap of gaps) {
    for (let x = gap.x; x < gap.x + gap.width; x++) {
      rows[floorTopY][x] = '.';
      rows[floorBottomY][x] = '.';
    }
  }
  for (const hz of hazards) {
    for (let x = hz.x; x < hz.x + hz.width; x++) {
      rows[floorTopY][x] = hz.char;
    }
  }
  return rows.map((r) => r.join(''));
}

function buildStage(spec) {
  const { id, name, theme, width, height, gaps, hazards, start, goal, checkpoints, enemies, mana, eraseCost, coins } = spec;
  const tiles = buildTiles(width, height, gaps, hazards);
  return {
    version: 1,
    id,
    name,
    theme,
    width,
    height,
    tiles,
    start,
    goal,
    checkpoints,
    enemies,
    mana,
    eraseCost,
    coins: coins ?? [],
  };
}

const WIDTH = 600;

// floorTopY - 2 の位置に立たせる(2タイル上から重力で着地する。既存ステージと同じ規約)。
const groundY = (height) => height - 2 - 2;
// コインは floorTopY - 1(床のすぐ上、通常の走行中に自然に重なる高さ)に浮かせる。
const coinY = (height) => height - 3;

const stage01 = buildStage({
  id: 'stage01',
  name: 'はじまりの草原',
  theme: 'grass',
  width: WIDTH,
  height: 20,
  gaps: [{ x: 150, width: 8 }],
  hazards: [],
  start: { x: 2, y: groundY(20) },
  goal: { x: 595, y: groundY(20) },
  checkpoints: [
    { x: 100, y: groundY(20) },
    { x: 250, y: groundY(20) },
    { x: 400, y: groundY(20) },
    { x: 500, y: groundY(20) },
  ],
  enemies: [
    { type: 'slime', x: 60, y: groundY(20), dir: -1 },
    { type: 'frog', x: 300, y: groundY(20), dir: 1 },
    { type: 'bird', x: 450, y: 10, dir: -1 },
  ],
  mana: { initial: 8, max: 50, regenPerSec: 1.2 },
  eraseCost: 3,
  // 序盤の練習+穴(要橋渡し)の上+終盤、で5枚(道中3・穴の上1・ゴール手前1)
  coins: [
    { x: 30, y: coinY(20) },
    { x: 153, y: coinY(20) }, // 穴(x=150-157)の上。橋を架けないと取れない
    { x: 250, y: coinY(20) },
    { x: 420, y: coinY(20) },
    { x: 580, y: coinY(20) },
  ],
});

const stage02 = buildStage({
  id: 'stage02',
  name: '洞窟の試練',
  theme: 'cave',
  width: WIDTH,
  height: 16,
  gaps: [
    { x: 150, width: 8 },
    { x: 400, width: 9 },
  ],
  hazards: [
    { x: 80, width: 5, char: 'B' },
    { x: 250, width: 5, char: 'F' },
    { x: 500, width: 3, char: 'S' },
  ],
  start: { x: 2, y: groundY(16) },
  goal: { x: 595, y: groundY(16) },
  checkpoints: [
    { x: 100, y: groundY(16) },
    { x: 300, y: groundY(16) },
    { x: 450, y: groundY(16) },
    { x: 550, y: groundY(16) },
  ],
  enemies: [
    { type: 'slime', x: 60, y: groundY(16), dir: -1 },
    { type: 'frog', x: 230, y: groundY(16), dir: 1 },
    { type: 'bird', x: 340, y: 8, dir: -1 },
    { type: 'slime', x: 520, y: groundY(16), dir: 1 },
  ],
  mana: { initial: 6, max: 55, regenPerSec: 1.0 },
  eraseCost: 3,
  // 穴2箇所(x=150,400)の上に配置し、両方とも橋渡しが前提。残りは道中/終盤
  coins: [
    { x: 40, y: coinY(16) },
    { x: 153, y: coinY(16) }, // 穴1(x=150-157)の上
    { x: 270, y: coinY(16) },
    { x: 404, y: coinY(16) }, // 穴2(x=400-408)の上
    { x: 570, y: coinY(16) },
  ],
});

const stage03 = buildStage({
  id: 'stage03',
  name: '草原の回廊',
  theme: 'grass',
  width: WIDTH,
  height: 20,
  gaps: [
    { x: 120, width: 8 },
    { x: 300, width: 9 },
    { x: 470, width: 8 },
  ],
  hazards: [
    { x: 60, width: 4, char: 'B' },
    { x: 200, width: 4, char: 'S' },
    { x: 380, width: 5, char: 'F' },
    { x: 540, width: 4, char: 'B' },
  ],
  start: { x: 2, y: groundY(20) },
  goal: { x: 595, y: groundY(20) },
  checkpoints: [
    { x: 90, y: groundY(20) },
    { x: 250, y: groundY(20) },
    { x: 400, y: groundY(20) },
    { x: 530, y: groundY(20) },
  ],
  enemies: [
    { type: 'slime', x: 40, y: groundY(20), dir: -1 },
    { type: 'frog', x: 180, y: groundY(20), dir: 1 },
    { type: 'bird', x: 260, y: 10, dir: -1 },
    { type: 'slime', x: 360, y: groundY(20), dir: 1 },
    { type: 'frog', x: 430, y: groundY(20), dir: -1 },
  ],
  mana: { initial: 6, max: 55, regenPerSec: 0.9 },
  eraseCost: 3,
  // 穴1(x=120)の上+道中3枚+穴3(x=470)の上
  coins: [
    { x: 30, y: coinY(20) },
    { x: 123, y: coinY(20) }, // 穴1(x=120-127)の上
    { x: 304, y: coinY(20) },
    { x: 473, y: coinY(20) }, // 穴3(x=470-477)の上
    { x: 560, y: coinY(20) },
  ],
});

const stage04 = buildStage({
  id: 'stage04',
  name: '深部の坑道',
  theme: 'cave',
  width: WIDTH,
  height: 16,
  gaps: [
    { x: 100, width: 8 },
    { x: 260, width: 9 },
    { x: 420, width: 8 },
    { x: 540, width: 9 },
  ],
  hazards: [
    { x: 50, width: 4, char: 'S' },
    { x: 180, width: 4, char: 'B' },
    { x: 330, width: 5, char: 'F' },
    { x: 480, width: 4, char: 'S' },
    { x: 570, width: 4, char: 'B' },
  ],
  start: { x: 2, y: groundY(16) },
  goal: { x: 595, y: groundY(16) },
  checkpoints: [
    { x: 80, y: groundY(16) },
    { x: 240, y: groundY(16) },
    { x: 400, y: groundY(16) },
    { x: 510, y: groundY(16) },
  ],
  enemies: [
    { type: 'slime', x: 30, y: groundY(16), dir: -1 },
    { type: 'frog', x: 150, y: groundY(16), dir: 1 },
    { type: 'bird', x: 220, y: 8, dir: -1 },
    { type: 'slime', x: 300, y: groundY(16), dir: 1 },
    { type: 'frog', x: 390, y: groundY(16), dir: -1 },
    { type: 'bird', x: 460, y: 8, dir: 1 },
  ],
  mana: { initial: 6, max: 60, regenPerSec: 0.8 },
  eraseCost: 3,
  // 4つの穴すべての上に配置(全て橋渡しが前提)+道中1枚
  coins: [
    { x: 20, y: coinY(16) },
    { x: 103, y: coinY(16) }, // 穴1(x=100-107)の上
    { x: 263, y: coinY(16) }, // 穴2(x=260-268)の上
    { x: 423, y: coinY(16) }, // 穴3(x=420-427)の上
    { x: 543, y: coinY(16) }, // 穴4(x=540-548)の上
  ],
});

const stage05 = buildStage({
  id: 'stage05',
  name: '大草原の最終試練',
  theme: 'grass',
  width: WIDTH,
  height: 20,
  gaps: [
    { x: 90, width: 8 },
    { x: 220, width: 9 },
    { x: 350, width: 8 },
    { x: 470, width: 9 },
    { x: 560, width: 8 },
  ],
  hazards: [
    { x: 40, width: 4, char: 'B' },
    { x: 150, width: 4, char: 'S' },
    { x: 290, width: 5, char: 'F' },
    { x: 410, width: 4, char: 'B' },
    { x: 520, width: 4, char: 'S' },
  ],
  start: { x: 2, y: groundY(20) },
  goal: { x: 595, y: groundY(20) },
  checkpoints: [
    { x: 70, y: groundY(20) },
    { x: 240, y: groundY(20) },
    { x: 400, y: groundY(20) },
    { x: 540, y: groundY(20) },
  ],
  enemies: [
    { type: 'slime', x: 20, y: groundY(20), dir: -1 },
    { type: 'frog', x: 120, y: groundY(20), dir: 1 },
    { type: 'bird', x: 180, y: 10, dir: -1 },
    { type: 'slime', x: 260, y: groundY(20), dir: 1 },
    { type: 'frog', x: 320, y: groundY(20), dir: -1 },
    { type: 'bird', x: 390, y: 10, dir: 1 },
    { type: 'slime', x: 440, y: groundY(20), dir: -1 },
  ],
  mana: { initial: 6, max: 65, regenPerSec: 0.75 },
  eraseCost: 3,
  // 最終ステージ: 5つの穴すべての上にコインを置く(全枚数回収には全ての橋渡しが前提)
  coins: [
    { x: 93, y: coinY(20) }, // 穴1(x=90-97)の上
    { x: 224, y: coinY(20) }, // 穴2(x=220-228)の上
    { x: 353, y: coinY(20) }, // 穴3(x=350-357)の上
    { x: 474, y: coinY(20) }, // 穴4(x=470-478)の上
    { x: 563, y: coinY(20) }, // 穴5(x=560-567)の上
  ],
});

const stages = { stage01, stage02, stage03, stage04, stage05 };

for (const [key, data] of Object.entries(stages)) {
  const outPath = join(OUT_DIR, `${key}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath} (width=${data.width}, height=${data.height}, gaps含む)`);
}
