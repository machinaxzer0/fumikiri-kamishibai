# 踏切紙芝居（ミカとつばめの 踏切まめちしき）

ブラウザだけで読める紙芝居です。ビルドは不要で、HTML / CSS / JavaScript の静的サイトとして GitHub Pages に公開しています。

ミカとつばめが踏切で待っているあいだに、踏切の豆知識を話すお話です。クリックやキーでセリフを送りながら読み進めます。

## 公開 URL

- 通常のお話: https://machinaxzer0.github.io/fumikiri-kamishibai/
- 投票画面のデモ: https://machinaxzer0.github.io/fumikiri-kamishibai/app/?scenario=x-trends/_test-poll.json

トップの URL は `app/` へ移ります。`?scenario=` などのクエリ文字列はそのまま引き継ぎます。

## 公開のしかた

**main が公開サイトです。** GitHub Pages へ出るのは `main` への push と、手動実行（workflow_dispatch）だけです。

変更は別ブランチで行い、プルリクエストで確認してから `main` に入れてください。`main` に入った内容が、そのまま公開サイトになります。

## 投票の集計

公開サイトでは投票の集計を止めています。`app/config.js` の `apiEnabled` は `false` です。訪問者の選択はこのブラウザの localStorage にだけ残り、「みんなの結果」は出ません。

集計用のサーバができるまで、`apiEnabled` は `false` のままにしてください。`true` にすると同一オリジンの `/api/vote` と `/api/results` を呼びます。GitHub Pages にはその API がないため、集計は使えません。
