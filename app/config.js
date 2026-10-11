/* Kamishibai runtime config — the ONLY place to set the vote API.
 * apiEnabled: false = never call the network. The visitor's own choice is still
 *             saved in localStorage, and 「みんなの結果」 is replaced by a short
 *             note that aggregation is unavailable.
 *             GitHub Pages has no vote server, so this MUST stay false until a
 *             separate vote server exists.
 *             true, or omitting the key, keeps the local-server behaviour:
 *             POST {apiBase}/api/vote and GET {apiBase}/api/results.
 * apiBase: '' = same origin as this page (served by app/serve.py on :8091).
 *          e.g. 'https://votes.example.com' to use another server (that server must send CORS headers
 *          allowing this page's origin for GET /api/results and POST /api/vote with Content-Type: application/json).
 * apiTimeoutMs: per request; on timeout/error the poll keeps working with localStorage only.
 */
window.KAMISHIBAI_CONFIG = {
  apiEnabled: false,
  apiBase: '',
  apiTimeoutMs: 4000,
};
