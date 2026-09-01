# JOLLY ROGER Monitor

すべてのファイルをGitHubリポジトリ直下に置きます。


RPC fix: JollyState extends DurableObject.


Ruby fix: uses Ajax `full_recovery_date`; empty means full.


Build fix: tracks active build IDs (`last_time > 0`) and notifies when a previously active ID disappears.


## iPhone通知（ntfy）

CloudflareのSecretに `NTFY_TOPIC` を追加してください。
値は第三者に推測されにくい英数字・`_`・`-` の8〜128文字。

iPhoneのntfyアプリで同じtopicを購読します。

テスト:
`/test-notification`
