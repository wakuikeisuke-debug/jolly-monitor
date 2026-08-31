# JOLLY ROGER Monitor

Cloudflare Workers + Durable Object でJOLLY ROGERを毎分監視するプロジェクトです。

## GitHubへアップロードするファイル

- package.json
- wrangler.jsonc
- src/index.js

## Cloudflare側

1. Workers & Pages
2. Create application
3. Import a repository
4. GitHubを接続
5. リポジトリ `jolly-monitor` を選択
6. Save and Deploy

Worker名は `jolly-monitor` にしてください。
wrangler.jsonc の name と一致している必要があります。

## デプロイ後にSecretを追加

Worker > Settings > Variables and Secrets で以下を Secret として追加します。

- JOLLY_ID
- JOLLY_PASSWORD

値はチャットには送らず、Cloudflare画面へ直接入力してください。

## 動作確認

workers.dev URLをSafariで開きます。

成功時は JSON で `ok: true` が返ります。

`/health` を付けると認証処理をせずWorker自体の稼働確認だけできます。

例:
https://<worker>.workers.dev/health

## 現在の監視

- 紅玉満タン
- 集金が1つ以上可能
- 建築完了（last_time判定は建築中実測後に必要なら微調整）
- レイド状態は取得のみ。通知は未有効化。
- Push通知サービスは次段階で接続。
