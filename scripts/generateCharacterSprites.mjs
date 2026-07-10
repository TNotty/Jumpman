// キャラクター(ジャンプマン+敵)のSVGスプライトを生成するスクリプト(手書きの代わり)。
// 各フレームの関節角度を三角関数で計算することで、フレーム間の一貫性を保ちつつ
// 「腕振り・足の交互」等のサイクルを座標の手入力なしで作る。
// 実行: node scripts/generateCharacterSprites.mjs
//
// 見た目の方針(既存アセットのスタイルを踏襲しつつ拡張):
// - ジャンプマン: 頭(円)+体幹(2トーンの楕円: 塗り+ハイライト)+四肢(線、太さを変えて
//   「線の強弱」を出す。脚は体重を支えるため太め、腕は細め)。
// - 敵: 既存の単色ベタ+ストロークの塗りに、明るめのハイライト楕円を重ねて2トーン化する。
//
// マニフェスト(public/assets/manifest.json)のframes/frameWと1対1で対応させること
// (フレーム数が変わるたびに両方を更新する)。
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'public', 'assets');

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

/** (cx,cy)を起点に、角度angleDeg(0=右方向、90=下方向)・長さlengthの終点座標を返す */
function polar(cx, cy, angleDeg, length) {
  const rad = deg2rad(angleDeg);
  return { x: cx + Math.cos(rad) * length, y: cy + Math.sin(rad) * length };
}

function fmt(n) {
  return Math.round(n * 100) / 100;
}

// --- ジャンプマン -------------------------------------------------------------------------

const JM_W = 32;
const JM_H = 48;
const SKIN = '#f1c27d';
const SKIN_STROKE = '#333333';
const SHIRT = '#2c3e50';
const SHIRT_HILIGHT = '#3d5a75';
const LEG_STROKE = '#1b2733';
const ARM_STROKE = '#34495e';

/**
 * 1フレーム分のジャンプマンを<g>で返す。
 * @param {object} pose
 * @param {number} pose.headDx 頭のX方向オフセット(のけぞり等の表現用)
 * @param {number} pose.headDy 頭のY方向オフセット
 * @param {number} pose.torsoRy 体幹楕円の縦半径(呼吸・しゃがみ表現用)
 * @param {number} pose.armLAngle 左腕の角度(度、90=真下)
 * @param {number} pose.armRAngle 右腕の角度
 * @param {number} pose.armLen 腕の長さ
 * @param {number} pose.legLAngle 左脚の角度
 * @param {number} pose.legRAngle 右脚の角度
 * @param {number} pose.legLen 脚の長さ
 * @param {boolean} [pose.deadFace] 死亡ポーズ用のバツ目を描くか
 */
function jumpmanFrame(pose) {
  const shoulder = { x: 16 + pose.headDx * 0.3, y: 18 };
  const hip = { x: 16, y: 31 };
  const headCx = 16 + pose.headDx;
  const headCy = 10 + pose.headDy;

  const armL = polar(shoulder.x, shoulder.y, pose.armLAngle, pose.armLen);
  const armR = polar(shoulder.x, shoulder.y, pose.armRAngle, pose.armLen);
  const legL = polar(hip.x, hip.y, pose.legLAngle, pose.legLen);
  const legR = polar(hip.x, hip.y, pose.legRAngle, pose.legLen);

  const face = pose.deadFace
    ? `<line x1="${fmt(headCx - 2.5)}" y1="${fmt(headCy - 2.5)}" x2="${fmt(headCx - 0.5)}" y2="${fmt(headCy - 0.5)}" stroke="#333333" stroke-width="1"/>` +
      `<line x1="${fmt(headCx - 0.5)}" y1="${fmt(headCy - 2.5)}" x2="${fmt(headCx - 2.5)}" y2="${fmt(headCy - 0.5)}" stroke="#333333" stroke-width="1"/>` +
      `<line x1="${fmt(headCx + 2.5)}" y1="${fmt(headCy - 2.5)}" x2="${fmt(headCx + 0.5)}" y2="${fmt(headCy - 0.5)}" stroke="#333333" stroke-width="1"/>` +
      `<line x1="${fmt(headCx + 0.5)}" y1="${fmt(headCy - 2.5)}" x2="${fmt(headCx + 2.5)}" y2="${fmt(headCy - 0.5)}" stroke="#333333" stroke-width="1"/>`
    : '';

  return `  <g>
    <ellipse cx="16" cy="${fmt(24)}" rx="7" ry="${fmt(pose.torsoRy)}" fill="${SHIRT}" stroke="#16202a" stroke-width="1.2"/>
    <ellipse cx="13.3" cy="${fmt(24 - pose.torsoRy * 0.3)}" rx="2.6" ry="${fmt(pose.torsoRy * 0.45)}" fill="${SHIRT_HILIGHT}" opacity="0.55"/>
    <line x1="${fmt(shoulder.x)}" y1="${fmt(shoulder.y)}" x2="${fmt(armL.x)}" y2="${fmt(armL.y)}" stroke="${ARM_STROKE}" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="${fmt(shoulder.x)}" y1="${fmt(shoulder.y)}" x2="${fmt(armR.x)}" y2="${fmt(armR.y)}" stroke="${ARM_STROKE}" stroke-width="2.6" stroke-linecap="round"/>
    <line x1="${fmt(hip.x)}" y1="${fmt(hip.y)}" x2="${fmt(legL.x)}" y2="${fmt(legL.y)}" stroke="${LEG_STROKE}" stroke-width="3.6" stroke-linecap="round"/>
    <line x1="${fmt(hip.x)}" y1="${fmt(hip.y)}" x2="${fmt(legR.x)}" y2="${fmt(legR.y)}" stroke="${LEG_STROKE}" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="${fmt(headCx)}" cy="${fmt(headCy)}" r="6" fill="${SKIN}" stroke="${SKIN_STROKE}" stroke-width="1.5"/>
    ${face}
  </g>`;
}

function buildSvg(width, height, frames) {
  const groups = frames
    .map((frame, i) => `  <g transform="translate(${i * 32},0)">\n${frame}\n  </g>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>\n`;
}

// idle: 2フレーム(呼吸。体幹のryがわずかに変化する)
const idleFrames = [
  jumpmanFrame({ headDx: 0, headDy: 0, torsoRy: 9, armLAngle: 100, armRAngle: 80, armLen: 12, legLAngle: 100, legRAngle: 80, legLen: 14 }),
  jumpmanFrame({ headDx: 0, headDy: -0.6, torsoRy: 9.6, armLAngle: 97, armRAngle: 83, armLen: 12, legLAngle: 100, legRAngle: 80, legLen: 14 }),
];
writeFileSync(join(ASSETS_DIR, 'jumpman', 'idle.svg'), buildSvg(64, JM_H, idleFrames), 'utf8');

// run: 8フレーム(腕振り・足の交互のサイクル。接地感を出すため脚の振幅を大きめにする)
const runFrames = [];
for (let i = 0; i < 8; i++) {
  const phase = (i / 8) * 360;
  const legL = 90 + 34 * Math.sin(deg2rad(phase));
  const legR = 90 + 34 * Math.sin(deg2rad(phase + 180));
  const armL = 90 + 26 * Math.sin(deg2rad(phase + 180));
  const armR = 90 + 26 * Math.sin(deg2rad(phase));
  // 脚が前後に伸びているフレームほど脚を短く(膝を曲げている風)、直立に近いほど長く
  const legLenL = 14 - 1.5 * Math.abs(Math.sin(deg2rad(phase)));
  const legLenR = 14 - 1.5 * Math.abs(Math.sin(deg2rad(phase + 180)));
  const bob = -Math.abs(Math.sin(deg2rad(phase * 2))) * 1.2; // 2歩に1回接地するイメージの上下動
  runFrames.push(
    jumpmanFrame({
      headDx: 0,
      headDy: bob,
      torsoRy: 9,
      armLAngle: armL,
      armRAngle: armR,
      armLen: 12,
      legLAngle: legL,
      legRAngle: legR,
      legLen: (legLenL + legLenR) / 2,
    }),
  );
}
writeFileSync(join(ASSETS_DIR, 'jumpman', 'run.svg'), buildSvg(32 * 8, JM_H, runFrames), 'utf8');

// jump: 2フレーム(上昇ポーズ/落下ポーズ。vyの符号で選ぶのはrenderer側)
const jumpFrames = [
  // 上昇: 腕を上げ、脚を体に引きつける
  jumpmanFrame({ headDx: 0, headDy: -1, torsoRy: 9.2, armLAngle: -15, armRAngle: 195, armLen: 12, legLAngle: 60, legRAngle: 120, legLen: 11 }),
  // 落下: 腕を前に、脚を着地に備えて下へ伸ばす
  jumpmanFrame({ headDx: 0, headDy: 0.5, torsoRy: 8.6, armLAngle: 70, armRAngle: 110, armLen: 12, legLAngle: 78, legRAngle: 102, legLen: 15 }),
];
writeFileSync(join(ASSETS_DIR, 'jumpman', 'jump.svg'), buildSvg(64, JM_H, jumpFrames), 'utf8');

// hit: 1フレーム(のけぞりポーズ。ノックバック/無敵点滅中に表示)
const hitFrames = [
  jumpmanFrame({ headDx: -4, headDy: -1, torsoRy: 8.6, armLAngle: -30, armRAngle: 210, armLen: 12, legLAngle: 65, legRAngle: 70, legLen: 13 }),
];
writeFileSync(join(ASSETS_DIR, 'jumpman', 'hit.svg'), buildSvg(32, JM_H, hitFrames), 'utf8');

// dead: 1フレーム(やられポーズ。死亡→リスポーンまでの短時間表示)
const deadFrames = [
  jumpmanFrame({
    headDx: 3,
    headDy: 4,
    torsoRy: 7,
    armLAngle: 110,
    armRAngle: 75,
    armLen: 11,
    legLAngle: 105,
    legRAngle: 80,
    legLen: 11,
    deadFace: true,
  }),
];
writeFileSync(join(ASSETS_DIR, 'jumpman', 'dead.svg'), buildSvg(32, JM_H, deadFrames), 'utf8');

// --- 敵 ------------------------------------------------------------------------------------

const ENEMY_W = 32;

function slimeFrame(rx, ry, cy, bodyFill, bodyStroke, hilightFill) {
  return `  <g>
    <ellipse cx="16" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${bodyFill}" stroke="${bodyStroke}" stroke-width="1.5"/>
    <ellipse cx="${fmt(16 - rx * 0.35)}" cy="${fmt(cy - ry * 0.4)}" rx="${fmt(rx * 0.3)}" ry="${fmt(ry * 0.3)}" fill="${hilightFill}" opacity="0.6"/>
    <circle cx="${fmt(16 - rx * 0.32)}" cy="${fmt(cy - ry * 0.15)}" r="2" fill="#000000"/>
    <circle cx="${fmt(16 + rx * 0.32)}" cy="${fmt(cy - ry * 0.15)}" r="2" fill="#000000"/>
  </g>`;
}

// slime: 4フレーム(ぷるぷる潰れ↔伸び。下端(接地面)がy=24でほぼ一定になるようcyを調整する)
const GROUND_Y = 24;
const slimeShapes = [
  { rx: 14, ry: 8 },
  { rx: 17, ry: 5 },
  { rx: 15, ry: 8.5 },
  { rx: 11, ry: 11 },
];
const slimeFrames = slimeShapes.map((s) => slimeFrame(s.rx, s.ry, GROUND_Y - s.ry, '#2ecc71', '#1e8449', '#a9f5c9'));
writeFileSync(join(ASSETS_DIR, 'enemies', 'slime.svg'), buildSvg(ENEMY_W * 4, 24, slimeFrames), 'utf8');

function frogFrame({ rx, ry, cy, legSpread, legLen }) {
  const eyeY = cy - ry * 0.85;
  return `  <g>
    <path d="M${fmt(16 - legSpread)} ${fmt(cy + ry * 0.7)} Q${fmt(16 - legSpread - legLen * 0.5)} ${fmt(cy + ry * 0.7 - legLen * 0.3)} ${fmt(16 - legSpread - legLen)} ${fmt(cy + ry * 0.7 - legLen * 0.7)}" stroke="#145a32" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M${fmt(16 + legSpread)} ${fmt(cy + ry * 0.7)} Q${fmt(16 + legSpread + legLen * 0.5)} ${fmt(cy + ry * 0.7 - legLen * 0.3)} ${fmt(16 + legSpread + legLen)} ${fmt(cy + ry * 0.7 - legLen * 0.7)}" stroke="#145a32" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="16" cy="${fmt(cy)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="#27ae60" stroke="#145a32" stroke-width="1.5"/>
    <ellipse cx="${fmt(16 - rx * 0.3)}" cy="${fmt(cy - ry * 0.4)}" rx="${fmt(rx * 0.28)}" ry="${fmt(ry * 0.28)}" fill="#8fe3a8" opacity="0.55"/>
    <circle cx="${fmt(16 - rx * 0.55)}" cy="${fmt(eyeY)}" r="3" fill="#27ae60" stroke="#145a32" stroke-width="1.2"/>
    <circle cx="${fmt(16 + rx * 0.55)}" cy="${fmt(eyeY)}" r="3" fill="#27ae60" stroke="#145a32" stroke-width="1.2"/>
    <circle cx="${fmt(16 - rx * 0.55)}" cy="${fmt(eyeY)}" r="1.2" fill="#000000"/>
    <circle cx="${fmt(16 + rx * 0.55)}" cy="${fmt(eyeY)}" r="1.2" fill="#000000"/>
  </g>`;
}

// frog: 3フレーム(0=しゃがみ溜め、1=伸び上がり、2=空中/通常。rendererが接地/上昇/下降で選ぶ)
const frogFrames = [
  frogFrame({ rx: 13, ry: 6.5, cy: 18.5, legSpread: 9, legLen: 4 }), // しゃがみ溜め: 平たく低い
  frogFrame({ rx: 9, ry: 11, cy: 11, legSpread: 6, legLen: 9 }), // 伸び上がり: 縦に伸びる、脚を後ろへ蹴り伸ばす
  frogFrame({ rx: 11, ry: 8, cy: 14, legSpread: 8, legLen: 5 }), // 空中/通常: 中間的な姿勢
];
writeFileSync(join(ASSETS_DIR, 'enemies', 'frog.svg'), buildSvg(ENEMY_W * 3, 28, frogFrames), 'utf8');

function birdFrame(wingAngleDeg) {
  const bodyCx = 16;
  const bodyCy = 14;
  const wingRoot = { x: bodyCx - 4, y: bodyCy - 1 };
  const wingTip = polar(wingRoot.x, wingRoot.y, wingAngleDeg, 11);
  const wingMid = {
    x: (wingRoot.x + wingTip.x) / 2 + Math.cos(deg2rad(wingAngleDeg - 90)) * 3,
    y: (wingRoot.y + wingTip.y) / 2 + Math.sin(deg2rad(wingAngleDeg - 90)) * 3,
  };
  return `  <g>
    <path d="M${fmt(wingRoot.x)} ${fmt(wingRoot.y)} Q${fmt(wingMid.x)} ${fmt(wingMid.y)} ${fmt(wingTip.x)} ${fmt(wingTip.y)}" stroke="#922b21" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="${fmt(bodyCx)}" cy="${fmt(bodyCy)}" rx="9" ry="6" fill="#e74c3c" stroke="#922b21" stroke-width="1.5"/>
    <ellipse cx="${fmt(bodyCx - 2)}" cy="${fmt(bodyCy - 2.4)}" rx="2.6" ry="1.8" fill="#ff9d8a" opacity="0.6"/>
    <circle cx="${fmt(bodyCx + 8)}" cy="${fmt(bodyCy - 4)}" r="3" fill="#e74c3c" stroke="#922b21" stroke-width="1.2"/>
    <circle cx="${fmt(bodyCx + 9)}" cy="${fmt(bodyCy - 5)}" r="0.9" fill="#000000"/>
    <polygon points="${fmt(bodyCx + 11)},${fmt(bodyCy - 4)} ${fmt(bodyCx + 16)},${fmt(bodyCy - 3)} ${fmt(bodyCx + 11)},${fmt(bodyCy - 2)}" fill="#f39c12"/>
  </g>`;
}

// bird: 4フレーム(羽ばたき上下。角度を1周させて上→水平→下→水平のサイクルにする)
const birdWingAngles = [-50, -10, 40, -10];
const birdFrames = birdWingAngles.map((angle) => birdFrame(angle));
writeFileSync(join(ASSETS_DIR, 'enemies', 'bird.svg'), buildSvg(ENEMY_W * 4, 24, birdFrames), 'utf8');

console.log('generated jumpman idle/run/jump/hit/dead and enemies slime/frog/bird');
