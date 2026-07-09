// ステージJSON生成スクリプト(手書きの代わり)。stage01〜stage10(10本)を、
// 「セグメント合成方式」で機械的に組み立てて src/data/stages/*.json に書き出す。
// 実行: node scripts/generateStages.mjs
//
// セグメント合成方式の設計方針:
// - ステージを幅10〜25タイル程度の「セグメント」の列として構築する(flat/hill/platforms/
//   spike/breakable/gap の6種)。乱数はシード固定(mulberry32)で決定論的にする
//   (同じ入力なら常に同じステージが生成される。CIやレビューで再現可能)。
// - 床は常に「基準の2行(floorTop/floorBottom)」を軸にする。
//   - flat: 基準そのまま(装飾なし)。
//   - hill: 中央のプレイトー区間だけ elevation(1〜2タイル)分だけ床を持ち上げる。持ち上げは
//     floorBottomまで隙間なく埋めた「土台」にする(下に空洞を作らない)。1〜2タイルの段差は
//     自動ジャンプ(到達高さ≈2.9タイル)で越えられることを検証済み(段差なしの隣接セグメントとの
//     境界には2タイルのバッファを必ず挟む)。
//   - platforms: 基準の床はそのまま(=安全)にしたうえで、頭上に装飾用の浮遊ブロックを
//     いくつか置く(物理的な進行には影響しない、見た目のバリエーション)。
//   - spike/breakable: floorTop行だけをS/B/Fに置き換え、floorBottomは安全網としてNのまま残す
//     (既存の実証済みパターンを踏襲)。
//   - gap(橋必須の大穴): floorTop/floorBottomとも完全に空にする。幅6〜10タイルは自動ジャンプの
//     水平到達距離(速度3で約2タイル)を大きく超えるため、必ずプレイヤーが地形生成で橋を
//     架けないと越えられない。
// - 隣接する2つの flat セグメントは連続させない(単調な平坦区間を防ぐ)。さらに生成後、
//   実際のタイル列を走査して「装飾の無い完全平坦な列」の連続長が一定(18タイル)を超える
//   区間があれば1タイルの段差を自動的に差し込み、単調さを機械的に断ち切る(セグメントの
//   組み合わせ次第で偶然長い平坦区間ができてしまうケースへの保険)。
// - 難易度(0=stage01 〜 1=stage10)が上がるほど: flatの出現重みを下げ、hill/spike/breakable/gap
//   の出現重みと敵配置の確率を上げ、gapの幅レンジも広げる。
// - コイン5枚は「序盤の寄り道・高台(hill)の上・穴(gap)の上・危険地帯(spike/breakable)の先・
//   終盤」の5箇所を優先して選ぶ(該当セグメントが無い場合は安全な位置へフォールバックする)。
// - このスクリプトは「橋が必要な位置リスト」を src/data/stages/gaps.generated.json にも
//   書き出す。クリア可能性テスト(src/data/stageClearability.test.ts)はこれをそのまま
//   読み込んで橋渡しシミュレーションに使う(手書きで座標を二重管理しない)。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'data', 'stages');

// --- 決定論的乱数(mulberry32) ---------------------------------------------------------

function mulberry32(seed) {
  let state = seed | 0;
  return function rng() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedPick(rng, entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let r = rng() * total;
  for (const entry of entries) {
    if (r < entry.weight) return entry.value;
    r -= entry.weight;
  }
  return entries[entries.length - 1].value;
}

// --- セグメント定義 ---------------------------------------------------------------------

const SEG = { FLAT: 'flat', HILL: 'hill', PLATFORMS: 'platforms', SPIKE: 'spike', BREAKABLE: 'breakable', GAP: 'gap' };

const MIN_WIDTH = { flat: 6, hill: 11, platforms: 10, spike: 3, breakable: 3, gap: 6 };

function weightFor(type, difficulty) {
  switch (type) {
    case SEG.FLAT:
      return Math.max(0.4, 2.4 - difficulty * 1.9);
    case SEG.HILL:
      return 1.0 + difficulty * 1.1;
    case SEG.PLATFORMS:
      return 0.8 + difficulty * 0.6;
    case SEG.SPIKE:
      return 0.5 + difficulty * 0.6;
    case SEG.BREAKABLE:
      return 0.5 + difficulty * 0.6;
    case SEG.GAP:
      return 0.5 + difficulty * 1.4;
    default:
      return 0;
  }
}

// HPは全ステージ共通で5(強化なしの基礎値)固定・自動プレイ中に回復する手段が無い(死亡復帰以外)。
// トゲ/壊れる/落ちるブロックの区間は「floorTopが非固体になり、1タイル下のfloorBottom
// (安全網)まで一時的に沈み込んでその区間を歩き抜ける」実装のため、無敵時間(2秒=速度3で
// 約6タイル分)を超える幅の区間では1回の通過で2回被弾しうる。3〜5タイル幅に抑えることで
// 1区間あたり最大1回の被弾に収める(既存ステージの実証済みレンジを踏襲)。
const HAZARD_WIDTH_RANGE = [3, 5];

function segmentWidth(rng, type, difficulty) {
  switch (type) {
    case SEG.FLAT:
      return randInt(rng, 6, 11);
    case SEG.HILL:
      return randInt(rng, 11, 18);
    case SEG.PLATFORMS:
      return randInt(rng, 10, 16);
    case SEG.SPIKE:
      return randInt(rng, HAZARD_WIDTH_RANGE[0], HAZARD_WIDTH_RANGE[1]);
    case SEG.BREAKABLE:
      return randInt(rng, HAZARD_WIDTH_RANGE[0], HAZARD_WIDTH_RANGE[1]);
    case SEG.GAP: {
      const lo = 6;
      const hi = Math.min(10, 6 + Math.round(difficulty * 4));
      return randInt(rng, lo, Math.max(lo, hi));
    }
    default:
      return 6;
  }
}

const ALL_TYPES = [SEG.FLAT, SEG.HILL, SEG.PLATFORMS, SEG.SPIKE, SEG.BREAKABLE, SEG.GAP];

/**
 * セグメント列と、それを反映した列単位のジオメトリ配列(elevationAt/isGapAt/hazardAt/
 * platformCols)を組み立てる。始点・終点には必ず装飾の無い安全な平坦区間(START_MARGIN/
 * END_MARGIN)を置く。
 */
function buildLayout(rng, width, difficulty) {
  const START_MARGIN = 5;
  const END_MARGIN = 5;

  const elevationAt = new Array(width).fill(0);
  const isGapAt = new Array(width).fill(false);
  const hazardAt = new Array(width).fill(null);
  const platformCols = [];
  const gaps = [];
  const segments = [];

  segments.push({ type: SEG.FLAT, x: 0, width: START_MARGIN });

  let x = START_MARGIN;
  const bodyEnd = width - END_MARGIN;
  // 冒頭の安全地帯の直後にgapが来ないようにする初期値(GAPも連続として扱い、
  // 最初のgapまで最低限の助走距離を確保する)。flat-after-flatの抑制も兼ねる。
  let lastType = SEG.FLAT;

  // HPは全ステージ共通で基礎値5固定・自動プレイ中にHPを回復する手段が無い(死亡復帰以外)。
  // トゲ/壊れる/落ちるブロックの区間は1区間あたり最大1回の被弾になるよう幅を抑えてあるが、
  // 区間の「数」が多すぎると被弾が積み重なり、最初のチェックポイントに辿り着く前に
  // HPが尽きてしまう(死亡復帰を延々繰り返してタイムアウトする)。そのためステージ全体の
  // ハザード区間数に上限を設ける(基礎HPに対して常に安全マージンを残す)。
  const MAX_HAZARD_SEGMENTS = 2 + Math.round(difficulty * 2); // 2(stage01)〜4(stage10)
  let hazardSegCount = 0;

  while (x < bodyEnd) {
    const remaining = bodyEnd - x;
    // flat-after-flat(単調な平坦の連続)と gap-after-gap(隣接する穴が実質1つの巨大な穴に
    // 融合してしまい、幅6〜10タイルという意図から外れるうえマナ回復の間が無くなる)を防ぐ。
    const hazardCapped = hazardSegCount >= MAX_HAZARD_SEGMENTS;
    const options = ALL_TYPES.filter((t) => MIN_WIDTH[t] <= remaining)
      .filter((t) => !(t === SEG.FLAT && lastType === SEG.FLAT) && !(t === SEG.GAP && lastType === SEG.GAP))
      .filter((t) => !(hazardCapped && (t === SEG.SPIKE || t === SEG.BREAKABLE)));
    if (options.length === 0) {
      segments.push({ type: SEG.FLAT, x, width: remaining });
      x = bodyEnd;
      break;
    }
    const type = weightedPick(
      rng,
      options.map((t) => ({ value: t, weight: weightFor(t, difficulty) })),
    );
    const width_ = Math.min(remaining, segmentWidth(rng, type, difficulty));

    applySegment(type, x, width_, rng, { elevationAt, isGapAt, hazardAt, platformCols, gaps });
    segments.push({ type, x, width: width_ });
    if (type === SEG.SPIKE || type === SEG.BREAKABLE) hazardSegCount += 1;
    x += width_;
    lastType = type;

    // gapの直後は必ず「回復区間」(flat、幅10〜16)を強制的に挟む。マナ回復の時間を確保し、
    // 隣接するgap同士の間隔が狭すぎて次の橋を架けるマナが足りなくなる事態を構造的に防ぐ。
    if (type === SEG.GAP && x < bodyEnd) {
      const recoveryWidth = Math.min(bodyEnd - x, randInt(rng, 10, 16));
      segments.push({ type: SEG.FLAT, x, width: recoveryWidth });
      x += recoveryWidth;
      lastType = SEG.FLAT;
    }
  }

  segments.push({ type: SEG.FLAT, x, width: width - x });

  return { segments, elevationAt, isGapAt, hazardAt, platformCols, gaps, START_MARGIN, END_MARGIN };
}

function applySegment(type, x, width, rng, out) {
  switch (type) {
    case SEG.FLAT:
      break; // 既定(elevation0・ハザード無し)のまま
    case SEG.HILL: {
      const elevation = randInt(rng, 1, 2);
      const buffer = 2;
      for (let i = x + buffer; i < x + width - buffer; i++) {
        out.elevationAt[i] = elevation;
      }
      break;
    }
    case SEG.PLATFORMS: {
      // 頭上装飾: セグメント内に間隔を空けて数個の浮遊ブロックを置く(進行には影響しない)。
      const count = Math.max(2, Math.floor(width / 5));
      for (let i = 0; i < count; i++) {
        const px = x + 1 + Math.floor(((i + 0.5) * (width - 2)) / count);
        const yOffset = -1 * randInt(rng, 3, 4);
        out.platformCols.push({ x: px, yOffset });
      }
      break;
    }
    case SEG.SPIKE: {
      for (let i = x; i < x + width; i++) out.hazardAt[i] = 'S';
      break;
    }
    case SEG.BREAKABLE: {
      const char = rng() < 0.5 ? 'B' : 'F';
      for (let i = x; i < x + width; i++) out.hazardAt[i] = char;
      break;
    }
    case SEG.GAP: {
      for (let i = x; i < x + width; i++) out.isGapAt[i] = true;
      out.gaps.push({ x, width });
      break;
    }
    default:
      break;
  }
}

// --- タイル組み立て ---------------------------------------------------------------------

function buildTiles(width, height, layout) {
  const baseFloorTopY = height - 2;
  const baseFloorBottomY = height - 1;
  const rows = Array.from({ length: height }, () => new Array(width).fill('.'));

  for (let x = 0; x < width; x++) {
    if (layout.isGapAt[x]) continue; // '.'のまま(橋が架けられるまで完全に空)
    const topY = baseFloorTopY - layout.elevationAt[x];
    for (let y = topY; y <= baseFloorBottomY; y++) {
      rows[y][x] = 'N';
    }
    const hazard = layout.hazardAt[x];
    if (hazard) {
      rows[topY][x] = hazard; // floorTop相当の行だけ置き換え、floorBottomは安全網としてNのまま
    }
  }

  for (const { x, yOffset } of layout.platformCols) {
    if (layout.isGapAt[x]) continue;
    const topY = baseFloorTopY - layout.elevationAt[x];
    const y = topY + yOffset;
    if (y >= 0 && y < baseFloorTopY) rows[y][x] = 'N';
  }

  breakLongFlatRuns(rows, baseFloorTopY, width);

  return rows;
}

/**
 * 「装飾の無い完全平坦な列」(floorTopがNかつfloorTopより上が全て空)が一定長(MAX_FLAT_RUN)を
 * 超えて連続する区間があれば、その中に一定間隔で1タイルの段差(floorTopの1つ上をNにする)を
 * 差し込み、単調な直線区間が生まれないことを機械的に保証する。セグメント側の隣接ルールだけに
 * 頼らない最終的な安全網(флat同士の直接連続は既に防いでいるが、hill/platformsのバッファ区間が
 * 連鎖して長い平坦列になるケースへの保険)。
 */
const MAX_FLAT_RUN = 18;

function breakLongFlatRuns(rows, floorTopY, width) {
  const isPlainFlat = (x) => {
    if (rows[floorTopY][x] !== 'N') return false;
    for (let y = 0; y < floorTopY; y++) {
      if (rows[y][x] !== '.') return false;
    }
    return true;
  };

  let runStart = null;
  for (let x = 0; x <= width; x++) {
    const flat = x < width && isPlainFlat(x);
    if (flat) {
      if (runStart === null) runStart = x;
      continue;
    }
    if (runStart !== null) {
      const runLen = x - runStart;
      if (runLen > MAX_FLAT_RUN) {
        for (let bx = runStart + MAX_FLAT_RUN; bx < x; bx += MAX_FLAT_RUN + 1) {
          rows[floorTopY - 1][bx] = 'N';
        }
      }
      runStart = null;
    }
  }
}

// --- エンティティ配置(局所地形の高さを考慮) --------------------------------------------

/** 指定x列の「局所floorTop行」を返す(gap内はnull)。エンティティのY座標算出に使う。 */
function localTopY(x, height, layout) {
  if (x < 0 || x >= layout.isGapAt.length || layout.isGapAt[x]) return null;
  return height - 2 - layout.elevationAt[x];
}

function nearestNonGapX(x, layout) {
  const width = layout.isGapAt.length;
  for (let d = 0; d < width; d++) {
    const right = x + d;
    const left = x - d;
    if (right < width && !layout.isGapAt[right]) return right;
    if (left >= 0 && !layout.isGapAt[left]) return left;
  }
  return x;
}

// チェックポイント/敵の y は「床の2タイル上(floorTopY-2)」に置く。start/goalと同じ規約
// (2タイル上から重力で落ちて着地する)で、ジャンプマンのAABB(高さ1.5)が実際に接地して
// 静止する位置(概ね floorTopY-1.5)と確実に重なるようにするため。floorTopYそのものを
// 指定すると、接地時のAABB下端(floorTopYちょうど)と判定の等号境界がズレて
// overlapsTile()が一切trueにならず、チェックポイントが永久に発火しない(その場しのぎで
// 発見しづらいバグになる)。
function buildCheckpoints(width, height, layout) {
  const checkpoints = [];
  const gaps = layout.gaps;
  if (gaps.length > 0) {
    const first = gaps[0];
    const preX = nearestNonGapX(Math.floor((layout.START_MARGIN + first.x) / 2), layout);
    if (preX > layout.START_MARGIN + 2) {
      const topY = localTopY(preX, height, layout);
      if (topY !== null) checkpoints.push({ x: preX, y: topY - 2 });
    }
  }
  for (const gap of gaps) {
    const cpX = nearestNonGapX(Math.min(width - layout.END_MARGIN - 2, gap.x + gap.width + 2), layout);
    const topY = localTopY(cpX, height, layout);
    if (topY !== null) checkpoints.push({ x: cpX, y: topY - 2 });
  }
  return checkpoints;
}

// HPは全ステージ共通で基礎値5固定・回復手段が無いため、敵の接触ダメージも(トゲ等と合わせて)
// ステージ全体で積み重なりうる。厳密に接触確率を解析するのは難しいため、安全側に倒して
// 敵の総数にも上限を設ける(既存5ステージの実績値3〜7体からの緩やかな増加に留める)。
const MAX_ENEMIES = (difficulty) => 4 + Math.round(difficulty * 6); // 4(stage01)〜10(stage10)

function buildEnemies(rng, width, height, layout, difficulty) {
  const enemies = [];
  const baseProb = 0.1 + difficulty * 0.16;
  const maxEnemies = MAX_ENEMIES(difficulty);
  for (const seg of layout.segments) {
    if (enemies.length >= maxEnemies) break;
    if (seg.type === SEG.GAP) continue;
    if (seg.width < 6) continue;
    const attempts = 1;
    for (let i = 0; i < attempts; i++) {
      if (enemies.length >= maxEnemies) break;
      if (rng() >= baseProb) continue;
      const x = nearestNonGapX(seg.x + randInt(rng, 2, Math.max(2, seg.width - 3)), layout);
      const topY = localTopY(x, height, layout);
      if (topY === null) continue;
      const dir = rng() < 0.5 ? 1 : -1;
      let type;
      switch (seg.type) {
        case SEG.HILL:
          type = 'frog';
          break;
        case SEG.PLATFORMS:
          type = 'bird';
          break;
        case SEG.SPIKE:
        case SEG.BREAKABLE:
          type = rng() < 0.5 ? 'slime' : 'bird';
          break;
        default:
          type = rng() < 0.75 ? 'slime' : 'bird';
      }
      // 地上の敵(slime/frog)はstart/goal/チェックポイントと同じ規約(floorTopYの2タイル上)で
      // 配置し、重力で自然に着地させる。鳥は元々飛行(重力無効)なので頭上に浮かせたままでよい。
      const y = type === 'bird' ? Math.max(1, topY - randInt(rng, 3, 6)) : topY - 2;
      enemies.push({ type, x, y, dir });
    }
  }
  return enemies;
}

function buildCoins(rng, width, height, layout) {
  const nonGapSegments = layout.segments.filter((s) => s.type !== SEG.GAP && s.width >= 4);
  const usedX = new Set();

  function fallbackX() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const seg = nonGapSegments[randInt(rng, 0, nonGapSegments.length - 1)];
      const x = nearestNonGapX(seg.x + randInt(rng, 1, Math.max(1, seg.width - 2)), layout);
      if (!usedX.has(x)) return x;
    }
    return nearestNonGapX(Math.floor(width / 2), layout);
  }

  const hillSeg = layout.segments.find((s) => s.type === SEG.HILL);
  const hazardSeg = layout.segments.find((s) => s.type === SEG.SPIKE || s.type === SEG.BREAKABLE);
  const firstGap = layout.gaps[0];

  const candidateXs = [
    nearestNonGapX(layout.START_MARGIN + 8, layout), // 序盤の寄り道
    hillSeg ? nearestNonGapX(hillSeg.x + Math.floor(hillSeg.width / 2), layout) : fallbackX(), // 高台の上
    firstGap ? firstGap.x + Math.floor(firstGap.width / 2) : fallbackX(), // 穴の上(橋の上、局所floorはgap内なので基準floorを使う)
    hazardSeg ? nearestNonGapX(hazardSeg.x + hazardSeg.width - 2, layout) : fallbackX(), // 危険地帯の先
    nearestNonGapX(width - layout.END_MARGIN - 8, layout), // 終盤
  ];

  const baseFloorTopY = height - 2;
  return candidateXs.map((x) => {
    usedX.add(x);
    const isGapColumn = layout.isGapAt[x];
    const topY = isGapColumn ? baseFloorTopY : (localTopY(x, height, layout) ?? baseFloorTopY);
    return { x, y: topY - 1 };
  });
}

// --- ステージ組み立て --------------------------------------------------------------------

function buildStage({ id, name, theme, seed, width, height, difficulty, mana, eraseCost }) {
  const rng = mulberry32(seed);
  const layout = buildLayout(rng, width, difficulty);
  const tiles = buildTiles(width, height, layout).map((row) => row.join(''));

  const baseFloorTopY = height - 2;
  const startTopY = localTopY(3, height, layout) ?? baseFloorTopY;
  const goalX = width - 4;
  const goalTopY = localTopY(goalX, height, layout) ?? baseFloorTopY;

  const checkpoints = buildCheckpoints(width, height, layout);
  const enemies = buildEnemies(rng, width, height, layout, difficulty);
  const coins = buildCoins(rng, width, height, layout);

  return {
    stage: {
      version: 1,
      id,
      name,
      theme,
      width,
      height,
      tiles,
      start: { x: 3, y: startTopY - 2 },
      goal: { x: goalX, y: goalTopY - 2 },
      checkpoints,
      enemies,
      mana,
      eraseCost,
      coins,
    },
    gaps: layout.gaps.map((g) => ({ x: g.x, width: g.width, y: baseFloorTopY })),
  };
}

// --- 10ステージ分のパラメータ ------------------------------------------------------------

const BASE_SEED = 20260710;

const STAGE_DEFS = [
  { idx: 1, name: 'はじまりの草原' },
  { idx: 2, name: '洞窟の試練' },
  { idx: 3, name: '草原の回廊' },
  { idx: 4, name: '深部の坑道' },
  { idx: 5, name: '大草原の丘陵' },
  { idx: 6, name: '暗闇の隘路' },
  { idx: 7, name: '花咲く難路' },
  { idx: 8, name: '奈落の坑道' },
  { idx: 9, name: '大草原の最終試練' },
  { idx: 10, name: '深淵の最終坑道' },
];

const WIDTHS = [400, 420, 440, 460, 480, 510, 540, 560, 580, 600];

const stagesOut = {};
const gapsOut = {};

for (const def of STAGE_DEFS) {
  const id = `stage${String(def.idx).padStart(2, '0')}`;
  const difficulty = (def.idx - 1) / (STAGE_DEFS.length - 1);
  const theme = def.idx % 2 === 1 ? 'grass' : 'cave';
  const height = theme === 'grass' ? 20 : 16;
  const width = WIDTHS[def.idx - 1];
  // 難易度が上がるほどgap(橋必須の穴)の総数も増えるため、マナは「渋くする」のではなく
  // 総所要量に見合うように緩やかに増やす(regenPerSecを大きく下げない)。gap直後に強制の
  // 回復区間(flat、幅10〜16)を挟んでいるので、隣接gap間の実際の回復時間は概ね確保されている。
  const mana = {
    initial: Math.round(8 + difficulty * 2),
    max: Math.round(55 + difficulty * 45),
    regenPerSec: Number((1.3 - difficulty * 0.2).toFixed(2)),
  };

  const { stage, gaps } = buildStage({
    id,
    name: def.name,
    theme,
    seed: BASE_SEED + def.idx,
    width,
    height,
    difficulty,
    mana,
    eraseCost: 3,
  });

  stagesOut[id] = stage;
  gapsOut[id] = gaps;
}

for (const [id, data] of Object.entries(stagesOut)) {
  const outPath = join(OUT_DIR, `${id}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath} (width=${data.width}, height=${data.height}, gaps=${gapsOut[id].length}, enemies=${data.enemies.length})`);
}

const gapsOutPath = join(OUT_DIR, 'gaps.generated.json');
writeFileSync(gapsOutPath, JSON.stringify(gapsOut, null, 2) + '\n', 'utf8');
console.log(`wrote ${gapsOutPath}`);
