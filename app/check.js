#!/usr/bin/env node
/* Validate scenario against the 5 expression IDs and report standing-image assets.
 * Usage: node app/check.js [scenario.json ...] [--x-trends] [--asset-manifest=path]
 *   scenario paths: relative to cwd or to the served root (/workspace/kamishibai), e.g. x-trends/foo.json
 *   --x-trends : also check every /workspace/kamishibai/x-trends/*.json
 *   default    : scenario/fumikiri-zatsugaku.json
 * Exit 1 on unknown speaker/expression or invalid poll.
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./assetlib.js');
const APP = __dirname, ROOT = path.resolve(APP, '..');
const args = process.argv.slice(2), amArg = args.find((a) => a.startsWith('--asset-manifest='));
const resolveScenario = (a) => { const c = path.resolve(a); return fs.existsSync(c) ? c : path.resolve(ROOT, a); };
let scenarioPaths = args.filter((a) => !a.startsWith('--')).map(resolveScenario);
if (args.includes('--x-trends')) {
  const dir = path.join(ROOT, 'x-trends');
  const xs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f)) : [];
  if (!xs.length) console.log('x-trends/*.json は 0 件です');
  scenarioPaths.push(...xs);
}
if (!scenarioPaths.length) scenarioPaths = [path.join(ROOT, 'scenario/fumikiri-zatsugaku.json')];
const defs = JSON.parse(fs.readFileSync(path.join(APP, 'assets-manifest.json'), 'utf8'));
const amPath = amArg ? path.resolve(amArg.split('=')[1]) : path.resolve(APP, defs.assetManifest || '../assets/manifest.json');
const am = fs.existsSync(amPath) ? JSON.parse(fs.readFileSync(amPath, 'utf8')) : null;
const assetRoot = path.dirname(amPath);
const IDS = defs.expressions;
const legacyMap = Object.fromEntries(Object.entries(defs.legacyExpressionMap || {}).filter(([k]) => !k.startsWith('_')));
const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const alias = new Map();
for (const [k, m] of Object.entries(defs.characters)) for (const a of [k, m.name, m.fullName, ...(m.aliases || [])]) alias.set(norm(a), k);
const errors = [], warns = [], used = {}, oldParts = [];

function checkScenario(scenarioPath) {
const rel = path.relative(ROOT, scenarioPath) || scenarioPath;
const tag = scenarioPaths.length > 1 ? `${rel} ` : '';
console.log(`\n=== シナリオ: ${path.relative(ROOT, scenarioPath)} ===`);
let sc;
try { sc = JSON.parse(fs.readFileSync(scenarioPath, 'utf8')); }
catch (e) { errors.push(`${rel}: 読み込み/JSON エラー: ${e.message}`); console.log('  ✘ 読み込めません: ' + e.message); return; }
console.log(`タイトル: ${sc.title ?? '(なし)'}`);
if (!Array.isArray(sc.pages) || !sc.pages.length) errors.push(`${rel}: pages が空または配列ではありません`);
let nLines = 0, legacyCount = 0;
(sc.pages || []).forEach((pg, pi) => (pg.lines || []).forEach((ln, li) => {
  nLines++;
  const where = `${tag}p${pg.page ?? pi + 1}#${li + 1}`;
  const key = alias.get(norm(ln.speaker));
  if (!key) return errors.push(`${where}: 未知の speaker "${ln.speaker}"`);
  let e = ln.expression;
  if (!IDS.includes(e)) {
    if (legacyMap[e]) { warns.push(`${where}: 旧表情ID "${e}" → "${legacyMap[e]}" に一時読み替え`); legacyCount++; e = legacyMap[e]; }
    else return errors.push(`${where}: 未知の expression "${ln.expression}"（有効: ${IDS.join('/')}）`);
  }
  if (typeof ln.text !== 'string' || !ln.text) warns.push(`${where}: text が空`);
  (used[key] ||= {})[e] = (used[key][e] || 0) + 1;
}));
console.log(`ページ数: ${(sc.pages || []).length}  セリフ数: ${nLines}`);
for (const [k, s] of Object.entries(sc.characters || {})) {
  const ex = (s.expressions || []).filter((e) => !IDS.includes(e));
  if (ex.length) { warns.push(`${tag}scenario.characters.${k} に旧/未知の表情ID: ${ex.join(', ')}`); }
}
const scOld = legacyCount > 0 || Object.values(sc.characters || {}).some((s) => (s.expressions || []).some((e) => !IDS.includes(e)));
if (scOld) oldParts.push(`シナリオ ${rel}: 旧表情IDが残っている（セリフ ${legacyCount} 件）`);
console.log(`シナリオ形式: ${scOld ? '旧（要更新）' : '新（5 ID: ' + IDS.join('/') + '）'}`);

validatePoll(sc, rel);
}

// poll: optional; when present must be well-formed
function validatePoll(sc, rel) {
  if (!('poll' in sc)) { console.log('poll: なし（投票画面は出ません）'); return; }
  const p = sc.poll, E = (m) => errors.push(`${rel} poll: ${m}`), before = errors.length;
  const str = (v) => typeof v === 'string' && v.trim() !== '';
  if (!p || typeof p !== 'object' || Array.isArray(p)) { E('オブジェクトではありません'); return; }
  if (!str(p.question)) E('question が空、または文字列ではありません');
  const ids = new Set(), labels = new Set();
  if (!Array.isArray(p.options) || p.options.length < 2) E('options は 2 件以上の配列が必要です');
  (Array.isArray(p.options) ? p.options : []).forEach((o, i) => {
    const w = `options[${i}]`;
    if (!o || typeof o !== 'object') return E(`${w} がオブジェクトではありません`);
    for (const f of ['id', 'label', 'summary']) if (!str(o[f])) E(`${w}.${f} が空、または文字列ではありません`);
    if (str(o.id)) { if (ids.has(o.id)) E(`${w}.id "${o.id}" が重複しています`); ids.add(o.id); }
    if (str(o.label)) { if (labels.has(o.label)) E(`${w}.label "${o.label}" が重複しています`); labels.add(o.label); }
    if (str(o.summary) && o.summary.length > 160) warns.push(`${rel} poll: ${w}.summary が ${o.summary.length} 文字（推奨 120 字以内。表示はスクロール）`);
    if (str(o.label) && o.label.length > 30) warns.push(`${rel} poll: ${w}.label が ${o.label.length} 文字（推奨 20 字以内）`);
  });
  if (Array.isArray(p.options) && p.options.length > 6) warns.push(`${rel} poll: options が ${p.options.length} 件（推奨 2〜6 件）`);
  if (p.none_option === undefined) warns.push(`${rel} poll: none_option がありません（任意）`);
  else if (!p.none_option || typeof p.none_option !== 'object') E('none_option がオブジェクトではありません');
  else {
    if (!str(p.none_option.id)) E('none_option.id が空、または文字列ではありません');
    if (!str(p.none_option.label)) E('none_option.label が空、または文字列ではありません');
    if (str(p.none_option.id) && ids.has(p.none_option.id)) E(`none_option.id "${p.none_option.id}" が options の id と重複しています`);
  }
  const n = Array.isArray(p.options) ? p.options.length : 0;
  console.log(`poll: ${errors.length === before ? '✔' : '✘'} 質問「${str(p.question) ? p.question : '?'}」 選択肢 ${n} 件${p.none_option ? ' + none_option' : ''}`);
}

for (const sp of scenarioPaths) checkScenario(sp);

// ---------- assets ----------
console.log(`\n=== 立ち絵 (${path.relative(ROOT, amPath)} 掲載分のみ, version ${am ? am.version ?? '?' : '-'}) ===`);
if (!am) { console.log('  ✘ マニフェストなし → 全てプレースホルダー'); oldParts.push('アセットマニフェストが存在しない'); }
const listed = new Set();
const exists = (rel) => fs.existsSync(path.join(assetRoot, rel));
const summary = [];
for (const k of Object.keys(defs.characters)) {
  const entry = am && am.characters && am.characters[k];
  const full = L.collectFull(entry);
  const { variants, mode, unknown } = L.buildVariants(entry, IDS, legacyMap);
  // keep only variants whose files exist (mirrors engine: failed load -> unavailable)
  const ok = {};
  for (const [e, v] of Object.entries(variants)) { L.variantFiles(v).forEach((f) => listed.add(f)); if (L.variantFiles(v).every(exists)) ok[e] = v; }
  Object.values(full).forEach((f) => listed.add(f));
  const res = L.resolveAll(ok, IDS, defs.fallbackOrder || {});
  console.log(`\n[${k}] ${defs.characters[k].fullName}  — マニフェスト形式: ${mode === 'full' ? '新（full_*.png）' : mode === 'legacy' ? '旧（base+face）' : 'なし'}`);
  if (mode !== 'full') oldParts.push(`manifest.characters.${k}: full_*.png の掲載なし（${mode === 'legacy' ? '旧 base+face 形式' : 'エントリなし'}）`);
  for (const e of IDS) {
    const rel = full[e];
    const st = rel ? (exists(rel) ? '✔ 掲載・実在' : '✘ 掲載・ファイルなし') : '– 未掲載';
    const r = res[e]; const n = (used[k] || {})[e] || 0;
    let shown;
    if (!r) shown = 'プレースホルダー';
    else if (r.substitute) shown = `代用 → ${r.use}` + (ok[r.use].kind === 'layered' ? `（旧 base+face_${ok[r.use].from}）` : '');
    else if (ok[e].kind === 'layered') shown = `旧 base+face_${ok[e].from} で表示` + (ok[e].from !== e ? '（旧ID読み替え）' : '');
    else shown = '本番画像';
    console.log(`  ${e.padEnd(10)} full: ${(rel || `characters/${k}/full_${e}.png`).padEnd(36)} ${st.padEnd(12)} 表示: ${shown.padEnd(30)} 使用${String(n).padStart(2)}回`);
    summary.push({ k, e, r, kind: r && ok[r.use] ? ok[r.use].kind : null, n });
  }
  if (unknown.length) warns.push(`manifest.characters.${k} に5 ID外の表情: ${unknown.join(', ')}`);
}
if (am) (function walk(v) { if (typeof v === 'string' && /\.(png|webp|jpe?g|avif)$/i.test(v)) listed.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(am.characters || {});
const stray = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else {
    const rel = path.relative(assetRoot, p).split(path.sep).join('/');
    if (rel !== 'manifest.json' && !listed.has(rel)) stray.push(rel);
  } } })(assetRoot);
if (stray.length) console.log(`\nマニフェスト未掲載のファイル（エンジンは読みません）:\n  ` + stray.join('\n  '));

console.log(`\n=== 結果 ===`);
const fullOk = summary.filter((s) => s.r && !s.r.substitute && s.kind === 'full').length;
const subs = summary.filter((s) => s.r && s.r.substitute);
const ph = summary.filter((s) => !s.r);
console.log(`本番 full 画像: ${fullOk}/${summary.length}  代用: ${subs.length}  プレースホルダー: ${ph.length}`);
console.log(subs.length ? '' : '代用中: なし');
if (subs.length) console.log('代用中: ' + subs.map((s) => `${s.k}.${s.e}→${s.r.use}${s.n ? `(使用${s.n})` : ''}`).join(', '));
if (ph.length) console.log('プレースホルダー: ' + ph.map((s) => `${s.k}.${s.e}`).join(', '));
console.log(oldParts.length ? '旧形式のまま: \n  - ' + oldParts.join('\n  - ') : '旧形式の残り: なし（マニフェスト・シナリオとも新形式）');
warns.forEach((w) => console.log('注意: ' + w));
if (errors.length) { errors.forEach((e) => console.log('エラー: ' + e)); console.log(`エラー（未知の speaker/expression・poll 不正など）: ${errors.length} 件`); process.exit(1); }
console.log('未知の speaker/expression: 0 件 ✔');
