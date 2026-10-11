/* Kamishibai engine — vanilla JS, no build step.
 * Standing images: one whole full-body image per expression (assets/manifest.json -> characters.<key>.full{expr:path}
 * or any listed path named full_<expr>.png). Only manifest-listed files are requested (zero speculative requests).
 * Missing expressions are substituted by another available expression of the same character (fallbackOrder).
 * All listed images are fetched and decoded (Image.decode) before first display; expressions are swapped by toggling
 * pre-built stacked layers, so there is no flicker. Legacy base+face manifests are still rendered as a fallback.
 * URL params: ?assetManifest=<url> (testing)  ?scenario=<path>  ?line=<1-based global line no.>  ?instant=1  ?speed=<ms per char>
 */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const DEFAULT_SCENARIO = 'scenario/fumikiri-zatsugaku.json';
  // ?scenario=<path relative to the served root>, e.g. x-trends/foo.json. Only .json files under the root; no protocol / .. / absolute paths.
  function resolveScenarioParam(raw) {
    if (raw == null || raw === '') return { path: DEFAULT_SCENARIO, url: '../' + DEFAULT_SCENARIO };
    const p = String(raw).trim().replace(/^\.\//, '');
    const bad = (why) => ({ error: `?scenario の指定が不正です（${why}）: "${raw}"` });
    if (/^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//')) return bad('プロトコル/外部URLは不可');
    if (p.startsWith('/')) return bad('先頭の / は不可。公開ルートからの相対パスで指定（例 x-trends/foo.json）');
    if (/[\\?#%\u0000-\u001f]/.test(p)) return bad('使用できない文字を含む');
    const segs = p.split('/');
    if (segs.some((x) => x === '' || x === '.' || x === '..')) return bad('空・. ・.. のパス要素は不可');
    if (!/\.json$/i.test(p)) return bad('.json ファイルのみ');
    return { path: p, url: '../' + segs.map(encodeURIComponent).join('/') };
  }
  const SCENARIO = resolveScenarioParam(params.get('scenario'));
  const SCENARIO_URL = SCENARIO.url;
  const MANIFEST_URL = 'assets-manifest.json';
  const TYPE_MS = Number(params.get('speed') || 32);
  const INSTANT = params.get('instant') === '1';
  const IMG_TIMEOUT_MS = Number(params.get('imgTimeout') || 15000);   // per image
  const DECODE_WAIT_MS = 3000;                                        // max wait for decode() after load
  const FIRST_PAINT_WAIT_MS = Number(params.get('firstPaintWait') || 2500); // max wait for the first line's images
  const SHOW_SUBST_BADGE = params.get('badge') === '1';   // ?badge=1 shows a small 代用 label on substituted expressions

  const $ = (id) => document.getElementById(id);
  const el = { stage: $('stage'), bg: $('bg'), title: $('title'), page: $('page-indicator'), chars: $('chars'),
    speaker: $('speaker'), text: $('text'), next: $('next-mark'), back: $('btn-back'), log: $('btn-log'),
    restart: $('btn-restart'), end: $('end-overlay'), logOv: $('log-overlay'), logList: $('log-list'), err: $('error') };

  const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

  let scenario, manifest, assetManifest = null, assetBase = '../assets/', canonical = [], legacyMap = {}, labels = {}, lines = [], chars = {}, aliasMap = new Map(), exprMap = new Map();
  let assets = {};           // assets[char] = { base, face:{expr:url}, full:{expr:url} }
  let idx = 0, typing = null, fullText = '', totalPages = 0;
  const charEls = {};

  // ---------- loading ----------
  async function loadJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url} を読み込めません (HTTP ${r.status})`);
    const t = await r.text();
    try { return JSON.parse(t); } catch (e) { throw new Error(`${url} は JSON として不正です: ${e.message}`); }
  }
  // Load + decode an image that IS listed in the asset manifest. Never rejects, never hangs:
  // resolves to the decoded <img>, or null on error/timeout (caller falls back to substitute/placeholder).
  function loadDecoded(url, timeoutMs = IMG_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const im = new Image(); im.decoding = 'async'; im.draggable = false; im.alt = '';
      let done = false;
      const finish = (val, why) => { if (done) return; done = true; clearTimeout(t); if (why) console.warn(`[kamishibai] 画像 ${why}: ${url}`); resolve(val); };
      const t = setTimeout(() => finish(im.complete && im.naturalWidth ? im : null, `読み込みタイムアウト(${timeoutMs}ms)`), timeoutMs);
      im.onerror = () => finish(null, '読み込み失敗');
      im.onload = () => {
        // decode() can stall in some environments; the image is usable once loaded, so cap the wait.
        const d = typeof im.decode === 'function' ? im.decode().catch(() => {}) : Promise.resolve();
        Promise.race([d, new Promise((r) => setTimeout(r, DECODE_WAIT_MS))]).then(() => finish(im));
      };
      im.src = url;
    });
  }
  const assetUrl = (rel) => assetBase + String(rel).replace(/^\/+/, '');

  function buildMaps() {
    const scChars = scenario.characters || {};
    canonical = manifest.expressions || ['joy', 'normal', 'surprised', 'angry', 'sad'];
    legacyMap = Object.fromEntries(Object.entries(manifest.legacyExpressionMap || {}).filter(([k]) => !k.startsWith('_')));
    const keys = new Set([...Object.keys(manifest.characters || {}), ...Object.keys(scChars)]);
    for (const key of keys) {
      const m = (manifest.characters || {})[key] || {};
      const s = scChars[key] || {};
      chars[key] = { key, name: s.name || m.name || key, fullName: m.fullName || s.name || key,
        color: m.color || '#888', position: m.position || 'center' };
      for (const a of [key, s.name, m.name, m.fullName, ...(m.aliases || [])]) if (a) aliasMap.set(norm(a), key);
    }
    labels = { ...(manifest.expressionLabels || {}), ...(scenario.expression_labels || {}) };
    for (const e of canonical) exprMap.set(norm(e), { id: e, legacy: false });
    for (const [id, label] of Object.entries(labels)) if (canonical.includes(id)) exprMap.set(norm(label), { id, legacy: false });
    for (const [old, id] of Object.entries(legacyMap)) if (!exprMap.has(norm(old))) exprMap.set(norm(old), { id, legacy: true, old });
  }
  const resolveSpeaker = (s) => aliasMap.get(norm(s)) || null;
  const resolveExpr = (e) => exprMap.get(norm(e)) || null;
  const exprLabel = (e) => labels[e] || e;

  function flatten() {
    const warn = [], legacyUse = [];
    (scenario.pages || []).forEach((pg, pi) => {
      const pageNo = pg.page ?? pi + 1;
      (pg.lines || []).forEach((ln, li) => {
        const key = ln.speaker ? resolveSpeaker(ln.speaker) : null;
        const r = ln.expression ? resolveExpr(ln.expression) : null;
        let expr = r ? r.id : null;
        if (key && r && r.legacy) legacyUse.push(`p${pageNo}#${li + 1}: ${r.old}→${r.id}`);
        if (ln.speaker && !key) warn.push(`p${pageNo}#${li + 1}: 未知の speaker "${ln.speaker}"（ナレーション扱い）`);
        if (key && ln.expression && !expr) warn.push(`p${pageNo}#${li + 1}: 未知の expression "${ln.expression}"（normal で代替）`);
        if (key && !expr) expr = 'normal';
        lines.push({ pageNo, pageIndex: pi, key, rawSpeaker: ln.speaker || '', expr, text: ln.text ?? '', bg: pg.background || ln.background || null });
      });
    });
    totalPages = (scenario.pages || []).length;
    if (legacyUse.length) console.warn(`[kamishibai] シナリオに旧表情ID ${legacyUse.length} 件（一時的に読み替え）:\n  ` + legacyUse.join('\n  '));
    if (warn.length) console.warn('[kamishibai] シナリオ警告:\n' + warn.join('\n'));
  }

  // Plan from the manifest (sync, cannot block), then preload in the background.
  // Substitution is decided from manifest availability; a listed image that fails/times out is substituted too.
  function planAssets() {
    const L = window.KamishibaiAssets;
    const amChars = (assetManifest && assetManifest.characters) || {};
    const subst = [], legacyNotes = [];
    const usedExprs = {};
    for (const l of lines) if (l.key) (usedExprs[l.key] ||= new Set()).add(l.expr);
    for (const c of Object.values(chars)) {
      let variants = {}, mode = 'none', unknown = [];
      try { ({ variants, mode, unknown } = L.buildVariants(amChars[c.key], canonical, legacyMap)); }
      catch (e) { console.error(`[kamishibai] ${c.key}: マニフェスト解析エラー`, e); }
      const a = assets[c.key] = { mode, variants, layers: {}, failed: new Set(), resolve: {} };
      a.resolve = L.resolveAll(variants, canonical, manifest.fallbackOrder || {});
      if (unknown.length) console.warn(`[kamishibai] ${c.key}: マニフェストに未知の表情ID: ${unknown.join(', ')}`);
      if (mode === 'legacy') legacyNotes.push(`${c.key}: ` + Object.entries(variants).map(([e, v]) => e === v.from ? e : `${e}←${v.from}`).join(', '));
      for (const e of canonical) {
        const r = a.resolve[e]; if (r && !r.substitute) continue;
        subst.push(`${c.key}.${e} → ${r ? r.use : 'プレースホルダー'}${(usedExprs[c.key] || new Set()).has(e) ? '（シナリオで使用）' : ''}`);
      }
    }
    if (!assetManifest) console.warn('[kamishibai] アセットマニフェストが読めないため全てプレースホルダー表示です');
    if (legacyNotes.length) console.warn('[kamishibai] 旧形式マニフェスト（base+face）を一時利用中:\n  ' + legacyNotes.join('\n  '));
    if (subst.length) console.warn(`[kamishibai] 未納品の表情を代用表示 ${subst.length} 件:\n  ` + subst.join('\n  '));
    window.__kamishibai = { assets, subst, chars, lines, canonical };
  }

  // Start loading every listed image. Returns {all, forLine(i)} promises (allSettled-style: never reject).
  function preloadAssets() {
    const L = window.KamishibaiAssets;
    const cache = new Map();
    const get = (rel) => { const u = assetUrl(rel); if (!cache.has(u)) cache.set(u, loadDecoded(u)); return cache.get(u); };
    const jobs = {}; const failed = []; const t0 = performance.now();
    for (const c of Object.values(chars)) {
      const a = assets[c.key];
      for (const [e, v] of Object.entries(a.variants)) {
        let files = []; try { files = L.variantFiles(v); } catch { /* malformed entry */ }
        jobs[`${c.key}.${e}`] = Promise.all(files.map(get)).then((imgs) => {
          if (files.length && imgs.every(Boolean)) { a.layers[e] = { v, imgs }; attachLayer(c, e); }
          else { a.failed.add(e); failed.push(`${c.key}.${e}: ${files.join(' + ') || '(パスなし)'}`); }
          onAssetSettled(c.key);
        }).catch((err) => { a.failed.add(e); console.error(`[kamishibai] ${c.key}.${e}`, err); });
      }
    }
    assets.__bg = {};
    const bgDef = assetManifest && assetManifest.background;   // string path, or {name: path}
    const bgJobs = [];
    const addBg = (n, rel) => bgJobs.push(get(rel).then((im) => { if (im) { assets.__bg[n] = im.src; if (lines[idx]) applyBg(lines[idx]); } else failed.push(`background ${n}: ${rel}`); }));
    if (typeof bgDef === 'string') addBg('__default', bgDef);
    else if (bgDef && typeof bgDef === 'object') for (const [n, rel] of Object.entries(bgDef)) if (typeof rel === 'string') addBg(n, rel);
    const all = Promise.all([...Object.values(jobs), ...bgJobs]).then(() => {
      if (failed.length) console.warn(`[kamishibai] マニフェスト掲載だが読み込めなかった画像 ${failed.length} 件（代用表示）:\n  ` + failed.join('\n  '));
      console.info(`[kamishibai] 画像 ${cache.size} 件の読み込み完了 ${Math.round(performance.now() - t0)}ms（${Object.values(chars).map((c) => `${c.key}:${assets[c.key].mode}`).join(', ')}）`);
      document.body.dataset.assets = 'done';
    });
    // images needed to paint line i (each character's current target expression)
    const forLine = (i) => { const st = statesAt(i); return Promise.all(onStage().map((k) => { const r = assets[k].resolve[st[k]]; return r ? jobs[`${k}.${r.use}`] : null; }).filter(Boolean)); };
    return { all, forLine };
  }

  // ---------- rendering ----------
  // One stacked layer per expression, added as soon as its images are decoded; swapping = toggling .active.
  function charEl(c) {
    let d = charEls[c.key]; if (d) return d;
    d = document.createElement('div');
    d.className = `char pos-${c.position}`; d.dataset.char = c.key; d.style.setProperty('--c', c.color);
    el.chars.appendChild(d); charEls[c.key] = d; d._expr = null; d._shown = undefined;
    for (const e of Object.keys(assets[c.key].layers)) attachLayer(c, e);
    return d;
  }
  function attachLayer(c, e) {
    const d = charEls[c.key]; if (!d || d.querySelector(`.layer[data-expr="${e}"]`)) return;
    const { v, imgs } = assets[c.key].layers[e];
    const layer = document.createElement('div'); layer.className = 'layer'; layer.dataset.expr = e; layer.dataset.kind = v.kind;
    imgs.forEach((im, i) => { const n = im.isConnected || im._used ? im.cloneNode() : im; im._used = true; n.className = v.kind === 'full' ? 'full' : (i === 0 ? 'base' : 'face'); layer.appendChild(n); });
    d.appendChild(layer);
  }
  // Called whenever an expression finishes (success or failure): repaint if it affects what is on screen.
  function onAssetSettled(key) {
    const d = charEls[key]; if (!d || d._expr == null) return;
    const e = d._expr; d._expr = null; drawChar(chars[key], e);
  }
  // Which decoded layer to show for expr: manifest target, else (still loading / failed) nearest decoded by fallbackOrder.
  function pickLayer(key, expr) {
    const a = assets[key]; const r = a.resolve[expr];
    if (r && a.layers[r.use]) return { use: r.use, substitute: r.substitute, pending: false };
    const order = [...((manifest.fallbackOrder || {})[expr] || []), ...canonical];
    const alt = order.find((x) => a.layers[x]);
    const pending = !!(r && !a.failed.has(r.use));
    if (alt) return { use: alt, substitute: true, pending };
    return { use: null, substitute: false, pending };
  }
  function drawChar(c, expr) {
    const d = charEl(c);
    if (d._expr === expr) return;
    d._expr = expr;
    const p = pickLayer(c.key, expr);
    for (const layer of d.querySelectorAll('.layer')) layer.classList.toggle('active', layer.dataset.expr === p.use);
    d.querySelector('.ph')?.remove(); d.querySelector('.badge')?.remove();
    d.dataset.shown = p.use || (p.pending ? 'loading' : 'placeholder'); d.dataset.substitute = p.substitute ? '1' : '0';
    if (!p.use && !p.pending) {
      d.insertAdjacentHTML('beforeend', `<div class="ph"><div class="head"></div><div class="body"></div>
        <div class="label"><b>${esc(c.fullName)}</b><br>${esc(exprLabel(expr))}<br><small>${esc(expr)}</small></div></div>`);
    } else if (!p.use && p.pending) {
      d.insertAdjacentHTML('beforeend', `<div class="ph loading"><div class="head"></div><div class="body"></div></div>`);
    } else if (p.substitute && SHOW_SUBST_BADGE) {
      d.insertAdjacentHTML('beforeend', `<div class="badge">代用: ${esc(exprLabel(expr))} → ${esc(exprLabel(p.use))}</div>`);
    }
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // character states at line i (replay so going back restores last expressions)
  function statesAt(i) {
    const st = {}; for (const k of Object.keys(chars)) st[k] = 'normal';
    for (let j = 0; j <= i; j++) if (lines[j].key) st[lines[j].key] = lines[j].expr;
    return st;
  }
  const onStage = () => Object.keys(chars).filter((k) => lines.some((l) => l.key === k));

  function show(i) {
    idx = Math.max(0, Math.min(i, lines.length - 1));
    const l = lines[idx];
    const st = statesAt(idx);
    for (const k of onStage()) {
      drawChar(chars[k], st[k]);
      const d = charEls[k];
      d.classList.toggle('speaking', l.key === k);
      d.classList.toggle('dim', !!l.key && l.key !== k);
    }
    applyBg(l);
    const c = l.key && chars[l.key];
    el.speaker.textContent = c ? c.name : l.rawSpeaker;
    el.speaker.style.setProperty('--sc', c ? c.color : '#555');
    el.page.textContent = `${l.pageNo}/${totalPages}`;
    el.back.disabled = idx === 0;
    el.end.classList.add('hidden');
    typeText(l.text);
  }
  function applyBg(l) {
    const bgUrl = (assets.__bg || {})[l.bg] || (assets.__bg || {}).__default;
    el.bg.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : ''; el.bg.classList.toggle('has-image', !!bgUrl);
  }
  function typeText(t) {
    stopTyping(); fullText = t; el.next.classList.remove('on');
    if (INSTANT || TYPE_MS <= 0) { el.text.textContent = t; el.next.classList.add('on'); return; }
    const chs = [...t]; let n = 0; el.text.textContent = '';
    typing = setInterval(() => { n++; el.text.textContent = chs.slice(0, n).join(''); if (n >= chs.length) finishTyping(); }, TYPE_MS);
  }
  function stopTyping() { if (typing) clearInterval(typing); typing = null; }
  function finishTyping() { stopTyping(); el.text.textContent = fullText; el.next.classList.add('on'); }

  function advance() {
    if (!el.logOv.classList.contains('hidden')) return;
    if (!el.end.classList.contains('hidden')) return;
    if (typing) return finishTyping();
    if (idx < lines.length - 1) show(idx + 1);
    else if (pollOn()) window.KamishibaiPoll.open();   // scripts with a poll: poll screen before おしまい
    else showEnd();
  }
  function back() {
    if (!el.end.classList.contains('hidden')) { el.end.classList.add('hidden'); if (pollOn()) window.KamishibaiPoll.open(); return; }
    if (idx > 0) show(idx - 1);
  }
  function showEnd() { el.end.classList.remove('hidden'); }
  function restart() { if (pollOn()) window.KamishibaiPoll.close(); el.logOv.classList.add('hidden'); for (const k in charEls) charEls[k]._expr = null; show(0); }
  const pollOn = () => !!(window.KamishibaiPoll && window.KamishibaiPoll.available());
  function openLog() {
    el.logList.innerHTML = lines.slice(0, idx + 1).map((l, j) => {
      const who = l.key ? chars[l.key].name : l.rawSpeaker;
      return `<div class="log-item${j === idx ? ' current' : ''}" data-i="${j}"><span class="pg">p${l.pageNo}</span><span class="who">${esc(who)}</span>${esc(l.text)}</div>`;
    }).join('');
    el.logOv.classList.remove('hidden');
    el.logList.scrollTop = el.logList.scrollHeight;
  }
  const closeLog = () => el.logOv.classList.add('hidden');

  function bind() {
    // blur any button after it is clicked so Enter/Space go back to advancing text
    el.stage.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); }, true);
    el.stage.addEventListener('click', (e) => { if (e.target.closest('button, .log-overlay, .end-overlay')) return; advance(); });
    el.back.onclick = back; el.log.onclick = openLog; el.restart.onclick = restart;
    $('btn-end-restart').onclick = restart; $('btn-end-log').onclick = openLog; $('btn-log-close').onclick = closeLog;
    el.logOv.addEventListener('click', (e) => { if (e.target === el.logOv) closeLog(); });
    // click a log entry to jump back to it
    el.logList.addEventListener('click', (e) => { const it = e.target.closest('.log-item'); if (it) { closeLog(); show(+it.dataset.i); } });
    document.addEventListener('keydown', (e) => {
      if (pollOn() && window.KamishibaiPoll.handleKey(e)) return;   // poll / result screen owns the keyboard while open
      if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') e.target.blur(); // keys never re-trigger a focused button
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); advance(); }
      else if (e.key === 'Backspace' || e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'l' || e.key === 'L') { el.logOv.classList.contains('hidden') ? openLog() : closeLog(); }
      else if (e.key === 'Escape') closeLog();
      else if (e.key === 'r' || e.key === 'R') restart();
    });
    window.addEventListener('wheel', (e) => { if (!el.logOv.classList.contains('hidden')) return; if (e.deltaY < 0) openLog(); }, { passive: true });
  }

  const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} タイムアウト(${ms}ms)`)), ms))]);

  async function main() {
    try {
      // scenario is mandatory; app defs + asset manifest are optional (fall back to defaults/placeholders)
      if (SCENARIO.error) throw new Error(SCENARIO.error);
      const [sc, defs] = await Promise.allSettled([withTimeout(loadJSON(SCENARIO_URL), 10000, 'シナリオ'), withTimeout(loadJSON(MANIFEST_URL), 5000, 'キャラ定義')]);
      if (sc.status !== 'fulfilled') throw sc.reason;
      scenario = sc.value;
      if (defs.status === 'fulfilled') manifest = defs.value;
      else { console.error('[kamishibai] app/assets-manifest.json を読めません（既定値で続行）:', defs.reason); manifest = { characters: {} }; }
      const amUrl = params.get('assetManifest') || manifest.assetManifest || '../assets/manifest.json';
      try { assetManifest = await withTimeout(loadJSON(amUrl), 5000, 'アセットマニフェスト'); assetBase = new URL('./', new URL(amUrl, location.href)).href; }
      catch (e) { console.error('[kamishibai] アセットマニフェストを読めません（プレースホルダーで続行）: ' + e.message); assetManifest = null; }
      buildMaps(); flatten();
      if (!lines.length) throw new Error('シナリオにセリフがありません');
      document.title = `${scenario.title || '紙芝居'} — 紙芝居`;
      el.title.textContent = scenario.title || '';
      try { planAssets(); } catch (e) { console.error('[kamishibai] アセット計画エラー（プレースホルダーで続行）', e); for (const k in chars) assets[k] ||= { mode: 'none', variants: {}, layers: {}, failed: new Set(), resolve: {} }; }
      bind();
      const start = Number(params.get('line') || 1) - 1;
      const startIdx = isNaN(start) ? 0 : Math.max(0, Math.min(start, lines.length - 1));
      let pre = null;
      try { pre = preloadAssets(); } catch (e) { console.error('[kamishibai] プリロード開始エラー', e); }
      // wait briefly for the first line's images so the first frame is complete, but never longer than FIRST_PAINT_WAIT_MS
      if (pre) await Promise.race([pre.forLine(startIdx).catch(() => {}), new Promise((r) => setTimeout(r, FIRST_PAINT_WAIT_MS))]);
      show(startIdx);
      if (scenario.poll != null && window.KamishibaiPoll) {
        try {
          window.KamishibaiPoll.init({ poll: scenario.poll, scenarioPath: SCENARIO.path,
            backToLastLine: () => show(lines.length - 1), showEnd, restart, hideEnd: () => el.end.classList.add('hidden') });
        } catch (e) { console.error('[kamishibai] poll の初期化に失敗（投票なしで続行）', e); }
      }
      document.body.dataset.ready = '1';
    } catch (err) {
      console.error(err);
      el.err.innerHTML = `<b>シナリオを開けませんでした</b><br>${esc(err.message)}<br><small>指定: ${esc(SCENARIO.path || params.get('scenario') || '')}　／　<a href="./" style="color:#fff">既定のシナリオを開く</a></small>`;
      el.err.classList.remove('hidden'); el.page.textContent = '!/!'; document.body.dataset.error = '1';
    }
  }
  main();
})();
