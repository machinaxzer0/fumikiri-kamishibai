/* Poll screen for kamishibai scripts with an optional top-level "poll".
 *   "poll": { "question": "...", "options": [{ "id", "label", "summary" }, ...], "none_option": { "id", "label" } }
 * Flow: last line → poll (select a card, then press 決定) → 「あなたの選択」 → おしまい.
 * The choice is saved only in this browser: localStorage["kamishibai:poll:v1:<scenario path>"] = {"id","label","at"}.
 * Aggregation (optional): when config.js apiEnabled is not false, after confirming,
 * POST {apiBase}/api/vote and GET {apiBase}/api/results. apiEnabled: false never calls the network
 * (GitHub Pages). Anonymous voter id: localStorage["kamishibai:voterId"], only when the API is enabled.
 * If the API fails/times out → local-only result.
 * Enter/Space never cast a vote by themselves: a card must be clicked or chosen with arrow/number keys first;
 * Enter then confirms only a selection made in this visit (a restored previous choice needs a click / key first).
 */
(function () {
  'use strict';
  let api = null, poll = null, storageKey = null, scenarioPath = null;
  let root = null, phase = null;          // phase: null | 'poll' | 'chosen'
  let selected = null, kbArmed = false, voteSeq = 0;   // kbArmed: user actively selected in this visit → Enter may confirm

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const str = (v) => typeof v === 'string' && v.trim() !== '';

  // Validate/normalise; throws on unusable shape (engine then continues without a poll).
  function normalise(p) {
    if (!p || typeof p !== 'object') throw new Error('poll がオブジェクトではありません');
    if (!str(p.question)) throw new Error('poll.question が空です');
    const seen = new Set();
    const options = (Array.isArray(p.options) ? p.options : []).filter((o) => {
      const ok = o && str(String(o.id ?? '')) && str(o.label) && !seen.has(String(o.id));
      if (!ok) console.warn('[kamishibai] poll: 不正/重複のため無視した選択肢', o); else seen.add(String(o.id));
      return ok;
    }).map((o) => ({ id: String(o.id), label: o.label, summary: typeof o.summary === 'string' ? o.summary : '' }));
    if (options.length < 2) throw new Error('poll.options が 2 件未満です');
    let none = null;
    if (p.none_option && str(String(p.none_option.id ?? '')) && str(p.none_option.label)) {
      if (seen.has(String(p.none_option.id))) console.warn('[kamishibai] poll: none_option.id が選択肢と重複（none_option を無視）');
      else none = { id: String(p.none_option.id), label: p.none_option.label, summary: typeof p.none_option.summary === 'string' ? p.none_option.summary : '', none: true };
    }
    return { question: p.question, options, none };
  }
  const all = () => [...poll.options, ...(poll.none ? [poll.none] : [])];
  const byId = (id) => all().find((o) => o.id === id) || null;

  function load() {
    try { const v = JSON.parse(localStorage.getItem(storageKey) || 'null'); return v && byId(v.id) ? v : null; } catch { return null; }
  }
  function save(o) {
    try { localStorage.setItem(storageKey, JSON.stringify({ id: o.id, label: o.label, at: new Date().toISOString() })); return true; }
    catch (e) { console.warn('[kamishibai] poll: localStorage に保存できません', e); return false; }
  }

  // ---------- vote API (only used by scripts that have a poll) ----------
  const CFG = window.KAMISHIBAI_CONFIG || {};
  // false disables every request. Omitted or true keeps POST/GET against apiBase (local serve.py).
  const apiEnabled = () => CFG.apiEnabled !== false;
  const apiUrl = (p) => String(CFG.apiBase || '').replace(/\/+$/, '') + p;
  function voterId() {
    const K = 'kamishibai:voterId';
    try {
      let v = localStorage.getItem(K);
      if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
        const b = new Uint8Array(16); crypto.getRandomValues(b);
        v = 'v_' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(K, v);
      }
      return v;
    } catch { return null; }
  }
  async function api_(path, opts = {}) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), CFG.apiTimeoutMs || 4000);
    try {
      const r = await fetch(apiUrl(path), { ...opts, signal: ctl.signal, cache: 'no-store' });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error((body && body.error && body.error.message) || `HTTP ${r.status}`);
      return body;
    } finally { clearTimeout(t); }
  }
  async function submitAndFetch(o) {
    const vid = voterId(); if (!vid) throw new Error('匿名IDを保存できません');
    await api_('/api/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: scenarioPath, option: o.id, voterId: vid }) });
    return api_('/api/results?scenario=' + encodeURIComponent(scenarioPath));
  }
  function renderResults(res, mineId) {
    const box = root && root.querySelector('.poll-results'); if (!box) return;
    const rows = (res.results || []).map((r) => {
      const o = byId(r.id); const label = o ? o.label : r.label || r.id;
      const cls = [r.id === mineId ? 'mine' : '', (poll.none && r.id === poll.none.id) ? 'none' : ''].join(' ');
      return `<div class="res-row ${cls}" data-id="${esc(r.id)}"><div class="res-label">${esc(label)}${r.id === mineId ? '（あなた）' : ''}</div>
        <div class="res-bar"><i style="width:${Math.max(0, Math.min(100, +r.percent || 0))}%"></i></div>
        <div class="res-num">${(+r.percent || 0).toFixed(1)}%（${r.count | 0}票）</div></div>`;
    }).join('');
    box.innerHTML = `<h3>みんなの結果</h3>${rows}<div class="res-total">合計 ${res.total | 0} 票</div>`;
    box.dataset.state = 'ok';
  }
  function renderOffline(why) {
    const box = root && root.querySelector('.poll-results'); if (!box) return;
    box.innerHTML = `<div class="res-status">集計につながらないため、自分の選択だけ表示しています。</div>`;
    box.dataset.state = 'offline';
    console.warn('[kamishibai] 投票APIに接続できません（ローカル保存のみで続行）:', why);
  }
  function build() {
    root = document.createElement('div');
    root.id = 'poll-screen'; root.className = 'poll-screen hidden';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      setTimeout(() => b.blur(), 0);                      // blur rule: keys never re-trigger a clicked button
      const card = b.closest('.poll-card');
      if (card) { select(card.dataset.id, true); return; }
      const act = b.dataset.act;
      if (act === 'confirm') confirm();
      else if (act === 'back') { close(); api.backToLastLine(); }
      else if (act === 'restart') { close(); api.restart(); }
      else if (act === 'change') open();
      else if (act === 'end') { close(); api.showEnd(); }
    });
  }

  function renderPoll() {
    const prev = load();
    const n = poll.options.length;
    root.innerHTML = `
      <div class="poll-panel">
        <div class="poll-head"><div class="poll-kicker">みんなはどう思う？</div><div class="poll-question">${esc(poll.question)}</div>
          ${prev ? `<div class="poll-prev">前回の選択: <b>${esc(byId(prev.id).label)}</b>（選び直せます）</div>` : ''}</div>
        <div class="poll-body">
          <div class="poll-grid n${n}">
            ${poll.options.map((o, i) => `<button class="poll-card" data-id="${esc(o.id)}" aria-pressed="false">
              <span class="poll-num">${i + 1}</span><span class="poll-label">${esc(o.label)}</span>
              ${o.summary ? `<span class="poll-summary">${esc(o.summary)}</span>` : ''}</button>`).join('')}
          </div>
          ${poll.none ? `<div class="poll-none-wrap"><button class="poll-card poll-none" data-id="${esc(poll.none.id)}" aria-pressed="false">
              <span class="poll-num">0</span><span class="poll-label">${esc(poll.none.label)}</span></button></div>` : ''}
        </div>
        <div class="poll-foot">
          <button data-act="back" title="最後のセリフに戻る (Backspace)">◀ 戻る</button>
          <button data-act="restart" title="最初から (R)">最初から</button>
          <span class="poll-hint">カードを選んで「決定」（キー: 1〜${n}${poll.none ? '・0' : ''} / ↑↓ で選択 → Enter）</span>
          <button data-act="confirm" class="poll-confirm" disabled>決定</button>
        </div>
      </div>`;
    selected = null; kbArmed = false;
    if (prev) select(prev.id, false);   // preselect previous choice (not armed: Enter alone will not re-vote)
  }

  function renderChosen(o, saved) {
    const on = apiEnabled();
    const note = !saved
      ? '※ このブラウザでは選択を保存できませんでした。'
      : on
        ? 'あなたの選択はこのブラウザに保存されました。集計には個人情報を含まない匿名IDだけを送ります。'
        : 'あなたの選択はこのブラウザに保存されました。';
    const results = on
      ? `<div class="poll-results" data-state="loading"><div class="res-status">みんなの結果を読み込み中…</div></div>`
      : `<div class="poll-results" data-state="off"><div class="res-status">この公開版では投票の集計は行っていません。あなたの選択だけ、このブラウザに保存しています。</div></div>`;
    root.innerHTML = `
      <div class="poll-panel poll-chosen">
        <div class="poll-head"><div class="poll-kicker">あなたの選択</div></div>
        <div class="poll-body">
          <div class="poll-result ${o.none ? 'is-none' : ''}">
            <div class="poll-label">${esc(o.label)}</div>
            ${o.summary ? `<div class="poll-summary">${esc(o.summary)}</div>` : ''}
          </div>
          <div class="poll-note">${note}</div>
          ${results}
        </div>
        <div class="poll-foot">
          <button data-act="change" title="選び直す (Backspace)">◀ 選び直す</button>
          <span class="poll-hint">Enter / Space / クリックで次へ</span>
          <button data-act="end" class="poll-confirm">おしまいへ ▶</button>
        </div>
      </div>`;
  }

  function select(id, armed) {
    const o = byId(id); if (!o) return;
    selected = o.id; kbArmed = kbArmed || armed;
    root.querySelectorAll('.poll-card').forEach((c) => { const on = c.dataset.id === selected; c.classList.toggle('selected', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const btn = root.querySelector('.poll-confirm'); if (btn) btn.disabled = false;
    const cur = root.querySelector('.poll-card.selected'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function confirm() {
    const o = byId(selected); if (!o) return;
    const saved = save(o);
    phase = 'chosen'; renderChosen(o, saved);
    root.dataset.phase = phase;
    if (!apiEnabled()) return;   // GitHub Pages: no /api/vote or /api/results
    const token = ++voteSeq;
    submitAndFetch(o).then((res) => { if (token === voteSeq && phase === 'chosen') renderResults(res, o.id); })
      .catch((e) => { if (token === voteSeq && phase === 'chosen') renderOffline(e && e.message); });
  }

  function open() {
    api.hideEnd();
    phase = 'poll'; renderPoll();
    root.dataset.phase = phase; root.classList.remove('hidden');
  }
  function close() { phase = null; if (root) { root.classList.add('hidden'); root.dataset.phase = ''; } }

  // Returns true when the key was consumed by the poll/result screen.
  function handleKey(e) {
    if (!phase) return false;
    if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') e.target.blur();
    const k = e.key;
    e.preventDefault();
    if (phase === 'poll') {
      const ids = all().map((o) => o.id);
      if (/^[1-9]$/.test(k) && poll.options[+k - 1]) select(poll.options[+k - 1].id, true);
      else if (k === '0' && poll.none) select(poll.none.id, true);
      else if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowLeft') {
        const d = (k === 'ArrowDown' || k === 'ArrowRight') ? 1 : -1;
        const i = selected == null ? (d > 0 ? 0 : ids.length - 1) : (ids.indexOf(selected) + d + ids.length) % ids.length;
        select(ids[i], true);
      }
      else if (k === 'Enter' && kbArmed && selected) confirm();   // Space never confirms
      else if (k === 'Backspace' || k === 'Escape') { close(); api.backToLastLine(); }
      else if (k === 'r' || k === 'R') { close(); api.restart(); }
      return true;
    }
    if (phase === 'chosen') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowRight') { close(); api.showEnd(); }
      else if (k === 'Backspace' || k === 'ArrowLeft' || k === 'Escape') open();
      else if (k === 'r' || k === 'R') { close(); api.restart(); }
      return true;
    }
    return false;
  }

  window.KamishibaiPoll = {
    init(a) {
      poll = normalise(a.poll);
      api = a; scenarioPath = a.scenarioPath; storageKey = 'kamishibai:poll:v1:' + a.scenarioPath;
      build();
      console.info(`[kamishibai] 投票あり: 選択肢 ${poll.options.length} 件${poll.none ? ' + none_option' : ''}（保存キー ${storageKey}）`);
    },
    available: () => !!(poll && root),
    open, close, handleKey,
    get phase() { return phase; }, get storageKey() { return storageKey; },
  };
})();
