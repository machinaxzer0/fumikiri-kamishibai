/* Shared (browser + node) logic: parse assets/manifest.json into per-expression variants
 * and resolve substitutions. No I/O here.
 * Variant kinds: {kind:'full', src}  — new format (whole full-body image per expression)
 *                {kind:'layered', base, face, from} — legacy base+face manifest, used only while no full images exist
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KamishibaiAssets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FULL_RE = /(?:^|\/)full_([a-z0-9_]+)\.(png|webp|jpe?g|avif)$/i;

  // Collect {expr: path} for full images from a character entry. Supported shapes:
  //  v2:  expressions: { joy: { path: "characters/mika/full_joy.png", status: "delivered" }, ... }   (or expr: "path")
  //  v1+: full / fulls / images / sprites: { joy: "path" }
  //  any: any string anywhere in the entry named .../full_<expr>.png
  // Paths are relative to the directory containing manifest.json (assets/).
  function collectFull(entry) {
    const out = {};
    if (!entry || typeof entry !== 'object') return out;
    const ex = entry.expressions;
    if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
      for (const [e, v] of Object.entries(ex)) {
        const p = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.path || v.src || v.file || v.full) : null);
        const pending = v && typeof v === 'object' && v.status && !/^(delivered|done|ok|final|ready)$/i.test(v.status);
        if (typeof p === 'string' && p && !pending) out[e] = p;
      }
    }
    for (const key of ['full', 'fulls', 'full_images', 'images', 'sprites', 'standing']) {
      const v = entry[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [e, p] of Object.entries(v)) if (typeof p === 'string' && !(e in out)) out[e] = p;
    }
    (function walk(v, depth) {
      if (depth > 6) return;
      if (typeof v === 'string') { const m = v.match(FULL_RE); if (m && !(m[1] in out) && !Object.values(out).includes(v)) out[m[1]] = v; }
      else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k !== 'source' && k !== 'legacy') walk(x, depth + 1); }
    })(entry, 0);
    return out;
  }

  /** Build variants for one character.
   * returns { variants: {expr: variant}, mode: 'full'|'legacy'|'none', unknown: [ids not in canonical set] } */
  function buildVariants(entry, canonical, legacyMap) {
    const variants = {}, unknown = [];
    const full = collectFull(entry);
    const toCanon = (id) => canonical.includes(id) ? id : (legacyMap[id] && canonical.includes(legacyMap[id]) ? legacyMap[id] : null);
    for (const [id, src] of Object.entries(full)) {
      const c = toCanon(id);
      if (!c) { unknown.push(id); continue; }
      if (!variants[c] || id === c) variants[c] = { kind: 'full', src, from: id };
    }
    if (Object.keys(variants).length) return { variants, mode: 'full', unknown };
    // legacy base + faces
    if (entry && typeof entry.base === 'string' && entry.faces && typeof entry.faces === 'object') {
      // prefer exact id, then legacy ids in map order (e.g. sad <- cry before troubled)
      const prio = (id) => (canonical.includes(id) ? 0 : 1 + Object.keys(legacyMap).indexOf(id));
      const faces = Object.entries(entry.faces).filter(([, p]) => typeof p === 'string').sort((a, b) => prio(a[0]) - prio(b[0]));
      for (const [id, face] of faces) {
        const c = toCanon(id);
        if (!c) { unknown.push(id); continue; }
        if (!variants[c]) variants[c] = { kind: 'layered', base: entry.base, face, from: id };
      }
      if (!Object.keys(variants).length) variants.normal = { kind: 'layered', base: entry.base, face: null, from: 'base' };
      return { variants, mode: 'legacy', unknown };
    }
    return { variants, mode: 'none', unknown };
  }

  /** Map every canonical expr to {use, substitute:boolean} or null (placeholder). */
  function resolveAll(variants, canonical, fallbackOrder) {
    const res = {};
    for (const e of canonical) {
      if (variants[e]) { res[e] = { use: e, substitute: false }; continue; }
      const order = [...(fallbackOrder[e] || []), ...canonical];
      const alt = order.find((x) => variants[x]) || Object.keys(variants)[0];
      res[e] = alt ? { use: alt, substitute: true } : null;
    }
    return res;
  }

  function variantFiles(v) { return v.kind === 'full' ? [v.src] : [v.base, v.face].filter(Boolean); }
  return { collectFull, buildVariants, resolveAll, variantFiles, FULL_RE };
});
