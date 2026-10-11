# 紙芝居アプリ（ミカとつばめの 踏切まめちしき）

プレーン HTML/CSS/JS（ビルド不要）のビジュアルノベル風プレイヤー。

## 起動

```bash
cd /workspace/kamishibai
nohup setsid python3 app/serve.py 8091 > /tmp/kamishibai-server.log 2>&1 < /dev/null &
# → http://localhost:8091/  （/ は /app/ へリダイレクト）
```

`serve.py` は `/workspace/kamishibai` をドキュメントルートとして配信し、`Cache-Control: no-cache` を付けます。
アセットを追加したら**ブラウザを再読み込みするだけ**で反映されます（コード変更不要）。
停止: `pkill -f "app/serve.py 8091"`

代替: `python3 -m http.server 8091 --directory /workspace/kamishibai` → http://localhost:8091/app/

## 操作

ボタン（戻る／ログ／最初から、終了時の「もう一度はじめから／ログを見る」）はテキストボックス内の下段中央にあり、立ち絵には重なりません（全表情・全ページで幾何チェック済み）。

| 操作 | 動作 |
|---|---|
| クリック / Enter / Space / → | 次へ（文字送り中はクリックで全文表示） |
| ◀戻る / Backspace / ← | ひとつ前のセリフへ |
| ログ / L / ホイール上 | バックログ（項目クリックでそこへジャンプ） |
| 最初から / R | リスタート（最終セリフの後は「おしまい」画面からも） |

URL パラメータ: `?line=N`（N 番目のセリフから開始・1始まり）, `?instant=1`（文字送りなし）, `?speed=ms`, `?scenario=パス`（下記）, `?assetManifest=URL`（テスト用）

## スクリプト切り替え（?scenario=）

`?scenario=<公開ルート /workspace/kamishibai からの相対パス>`。省略時は `scenario/fumikiri-zatsugaku.json`（従来どおり）。

- 例: http://localhost:8091/app/?scenario=x-trends/_test-poll.json 、 `...&line=3&instant=1` と併用可
- `.json` のみ。`http://` 等のプロトコル、先頭 `/`、`..`・`.`・空のパス要素、`\ ? # %` は拒否
- 読み込み失敗（不正パス・404・JSON 不正・タイムアウト 10 秒）は画面中央にエラーと「既定のシナリオを開く」リンクを表示（固まらない）
- タイトル・ページ数は読み込んだスクリプトから表示

## 投票画面（poll）

スクリプトのトップレベルに任意で `poll` を置くと、最後のセリフの後・「おしまい」の前に投票画面が出ます（無いスクリプトは従来どおり）。

```json
"poll": {
  "question": "あなたの意見に一番近いのは？",
  "options": [
    { "id": "a", "label": "見出し", "summary": "要約" },
    { "id": "b", "label": "見出し", "summary": "要約" }
  ],
  "none_option": { "id": "none", "label": "どれにも当てはまらない" }
}
```

- 流れ: 最後のセリフ → 投票画面（カードを選ぶ →「決定」）→「あなたの選択」＋「みんなの結果」→「おしまい」
- 誤投票防止: Enter/Space だけでは投票されません。クリックで選んで「決定」、またはキー `1〜9`（`0` = none_option）/ `↑↓` で選んで Enter。
  前回の選択は復元・プリセレクトされますが、Enter だけでは再投票されません（選び直す操作が必要）。
- 投票画面: `◀ 戻る`/Backspace = 最後のセリフへ、`最初から`/R。「あなたの選択」: Enter/Space = おしまいへ、Backspace = 選び直す。
  「おしまい」で戻る → 投票画面（前回の選択つき）。
- none_option は破線の別枠カードで、他の選択肢と区切って表示。
- 保存: `localStorage["kamishibai:poll:v1:<scenario パス>"] = {"id","label","at"}`（例 `kamishibai:poll:v1:x-trends/_test-poll.json`）。
  匿名投票者ID: `localStorage["kamishibai:voterId"]`（`v_` + 32 桁 16 進のランダム値）。
- 画面サイズ: 投票画面はビューポート全体の不透明パネル（立ち絵の上に重なるのは仕様）。文字は clamp で最小 11〜13px を確保、
  カード一覧は縦スクロール、長い summary はカード内で折り返し＋スクロール（最大約 10 行）。
- 推奨: 選択肢 2〜6 件（3〜5 件が見やすい）、label 20 字以内、summary 40〜120 字。check.js は label 30 字超・summary 160 字超・7 件以上で注意を出します。

## 投票集計 API

`app/config.js` の **`apiEnabled`** で集計のオン/オフを切り替えます。

- `false` — ネットワークを呼びません。選択は localStorage のみ。「みんなの結果」は出さず、集計できない旨を表示します。GitHub Pages には投票サーバがないため、公開版では必ず `false` のままにしてください。
- `true`、またはキーを省略 — 従来どおり `POST /api/vote` と `GET /api/results`。ローカルの serve.py で集計するときは `true` にします。

app/serve.py が静的ファイルと同じポート（8091）で提供。投票画面のあるスクリプトで、かつ `apiEnabled` が有効なときだけ呼ばれます（fumikiri など poll なしでは一切リクエストしない）。
API の場所は **`app/config.js` の `apiBase`** だけで設定（空 = 同一オリジン）。別サーバに移す場合、そのサーバは
このページのオリジンに対する CORS（`Access-Control-Allow-Origin`、POST の `Content-Type: application/json` プリフライト）を返す必要があります
（serve.py は環境変数 `KAMISHIBAI_CORS_ORIGIN=https://example.com` で対応）。タイムアウトは `apiTimeoutMs`（既定 4 秒）。

### POST /api/vote

```http
POST /api/vote
Content-Type: application/json

{"scenario": "x-trends/_test-poll.json", "option": "c", "voterId": "v_8677d360f8ea825d1592b0de25e4470e"}
```
→ `200 {"ok": true, "scenario": "x-trends/_test-poll.json", "option": "c", "replaced": false, "previous": null}`
（同じ voterId が同じ scenario に再投票すると上書き: `"replaced": true, "previous": "a"`）

### GET /api/results?scenario=x-trends/_test-poll.json

```json
{"scenario": "x-trends/_test-poll.json", "total": 7,
 "results": [{"id": "a", "label": "電車の種類", "none": false, "count": 1, "percent": 14.3},
             {"id": "none", "label": "どれにも当てはまらない", "none": true, "count": 1, "percent": 14.3}]}
```
選択肢は poll の順、none_option は最後（`"none": true`）。percent は小数 1 桁に丸め（合計が 100.0 にならないことがあります）。
poll から消えた選択肢への過去票は集計しません。

### エラー（`{"error": {"code": "...", "message": "..."}}`）

| HTTP | code | 条件 |
|---|---|---|
| 400 | bad_json / bad_scenario / bad_voter_id | JSON 不正、scenario パス不正（?scenario= と同じ規則）、voterId が `[A-Za-z0-9_-]{16,64}` でない |
| 404 | scenario_not_found / not_found | scenario ファイルなし、未知の API |
| 405 | method_not_allowed | GET /api/vote など |
| 411 | length_required | Content-Length なし |
| 413 | payload_too_large | 本文 2048 バイト超 |
| 415 | unsupported_media_type | Content-Type が application/json でない |
| 422 | invalid_option / no_poll / bad_scenario_json | poll に無い選択肢、poll なしのスクリプト、scenario が JSON でない |
| 500 | internal | 予期しないエラー（詳細は返さない） |

### 保存形式

SQLite `/workspace/kamishibai/votes/votes.sqlite3`（WAL）。テーブル `votes(scenario TEXT, voter_id TEXT, option_id TEXT, updated_at TEXT, PRIMARY KEY(scenario, voter_id))`。
1 投票者 × 1 スクリプト = 1 行（再投票は UPSERT で上書き）。IP・User-Agent は保存せず、アクセスログにも IP を出しません。
`/votes/` は HTTP では配信しません（404）。サーバは書き込みをロック＋SQLite トランザクションで直列化（並行 40 件の同時投票で欠損なしを確認）。
投票のリセット: `sqlite3 votes/votes.sqlite3 "DELETE FROM votes WHERE scenario='x-trends/foo.json'"`。

### 公開運用に向けて足りないもの

- 不正対策: voterId は localStorage の自己申告なので、ストレージ消去・別ブラウザ・スクリプトで何票でも投票可能（ボット対策・重複検知・ログイン等なし）
- レート制限（IP/ID ごとの投票頻度制限）、リクエストサイズ以外の DoS 対策
- 認証・CSRF 対策（現状は Content-Type: application/json 必須のみ）、管理者用のリセット/閲覧 API なし
- CORS 設定（別オリジン配置時）、HTTPS での公開先（現状は http://localhost の開発サーバ。Python の http.server は本番用途非推奨）
- バックアップ／保持期間ポリシー、DB の監視
- プライバシー表示（匿名 ID と選択を保存・集計する旨、保存期間、問い合わせ先）
- 集計値のキャッシュ（アクセス増加時）、結果の公開タイミング制御（投票前に結果を見せない等）

## 立ち絵の仕様（全身差し替え方式）

表情ごとに**全身1枚絵**を丸ごと差し替えます（base+face の重ね合わせは廃止。旧形式マニフェストのときだけ互換表示）。
表情 ID は両キャラ共通の 5 種: `joy`（喜び） / `normal`（通常） / `surprised`（驚き） / `angry`（怒り） / `sad`（悲しみ）。

```
assets/
  manifest.json
  characters/mika/full_{joy,normal,surprised,angry,sad}.png
  characters/tsubame/full_{joy,normal,surprised,angry,sad}.png
```

- キャンバスは全表情で同サイズ（例 900×1600）・同位置。足元＝下端中央。
- エンジンは **`assets/manifest.json` に掲載されたファイルだけ**を読み込みます（推測リクエストなし＝404 ゼロ）。
  画像パスは `characters.<key>.full` の `{表情: パス}` に書くのが推奨。それ以外の場所でも `full_<表情>.png` という名前のパスなら認識します。

```json
{
  "version": 2,
  "characters": {
    "mika": {
      "expressions": {
        "joy":    { "path": "characters/mika/full_joy.png", "status": "delivered" },
        "normal": { "path": "characters/mika/full_normal.png", "status": "delivered" }
      }
    }
  },
  "background": null      // または "bg/fumikiri.png"、または {"名前": "bg/x.png"}（pages[].background で切替）
}
```

- パスは manifest.json のあるディレクトリ（`assets/`）からの相対。
- v2 形式（`characters.<id>.expressions.<expr>.path`）が正式。`status` が delivered 以外（pending 等）のものは未納品扱いで代用。
- 互換: `characters.<id>.full{expr: path}`、`full_<expr>.png` という名前の任意パス、旧 `base`+`faces` も読めます。

- 新しい画像は manifest に追記してブラウザを再読み込みするだけで反映されます（コード変更不要）。

### 未納品の表情の代用

manifest に無い表情は、同じキャラの別の表情で一時代用します（コンソールに 1 回だけ一覧表示。`?badge=1` で画面にも「代用」表示）。
順序は `app/assets-manifest.json` の `fallbackOrder` で変更可:

| 表情 | 代用順 |
|---|---|
| normal | joy → surprised → sad → angry |
| joy | normal → surprised → sad → angry |
| surprised | normal → joy → angry → sad |
| angry | normal → surprised → sad → joy |
| sad | normal → surprised → angry → joy |

どれも無いキャラはプレースホルダー（色付きシルエット＋名前＋表情）。

### 起動の堅牢性

- シナリオ以外（キャラ定義・アセットマニフェスト・画像）の読み込み失敗やタイムアウトでアプリ全体が止まることはありません。
  マニフェストが読めなければ全キャラをプレースホルダーで表示し、エラーをコンソールに出します。
- 画像は 1 枚ごとにタイムアウト（既定 15 秒、`?imgTimeout=ms`）。`decode()` は読み込み後最大 3 秒まで待ちます。
- 最初の表示は「開始セリフで必要な画像」を最大 2.5 秒（`?firstPaintWait=ms`）だけ待ち、その後は必ず描画します。
  読み込み中の表情は、読み込み済みの同キャラ別表情か薄いシルエットで仮表示し、読み込み完了時に差し替えます。

### ちらつき防止

manifest 掲載の画像はすべて最初に読み込み `Image.decode()` 済みにしてから表示開始。表情ごとに重ねた `<img>` レイヤーの
表示/非表示を切り替えるだけなので、再生中のネットワーク要求・デコード待ちはありません。

### 旧形式への互換（一時措置）

- manifest に `full_*.png` が 1 つも無いキャラは、旧 `base` + `faces` を重ねて表示（smile→joy, cry/troubled→sad などに読み替え）。
- シナリオの旧表情 ID は `legacyExpressionMap` で読み替え（smile→joy, cry/troubled→sad, shy/eyes_closed→normal）。check.js が警告します。

## ファイル

- `index.html`, `style.css`, `engine.js` — 本体
- `assetlib.js` — manifest 解析と代用解決（ブラウザと check.js で共有）
- `poll.js` — 投票画面・あなたの選択・みんなの結果（poll のあるスクリプトのみ動作）
- `config.js` — 投票 API のオン/オフ（apiEnabled）、場所（apiBase）、タイムアウト
- `assets-manifest.json` — キャラ定義（表示名・別名 aliases・色・立ち位置・表情 ID）と命名パターン
- `check.js` — 検証スクリプト: `node app/check.js [シナリオ...] [--x-trends] [--asset-manifest=パス]`（既定は fumikiri。`--x-trends` で x-trends/*.json 全件。5 ID 検証・poll の形式検証・立ち絵の掲載/実在・代用一覧。エラーがあれば exit 1）
- `serve.py` — 開発サーバ＋投票集計 API（/api/vote, /api/results）
- `screenshot.png` — ヘッドレス Chrome による確認スクショ

## シナリオ形式

`scenario/fumikiri-zatsugaku.json`: `title`, `characters{key:{name,expressions}}`, `expression_labels{id:日本語}`,
`pages[{page, lines[{speaker, expression, text}]}]`。
speaker はキャラキー・表示名・フルネーム・aliases のいずれでも可（NFKC 正規化・大文字小文字/空白無視）。
expression は ID か日本語ラベル（例「笑顔」）でも可。未知の speaker はナレーション扱い、未知の expression は normal で代替（コンソール警告）。
`pages[].background` / `lines[].background` があれば `assets/bg/<名前>.png` を背景に使用します。
