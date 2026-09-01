# JOLLY ROGER Monitor

Cloudflare Worker + Durable Object + Cron + Pushover.

## Runtime Secrets

Configure these as Cloudflare **Runtime variables and secrets** (Secret):

- `JOLLY_ID`
- `JOLLY_PASSWORD`
- `PUSHOVER_APP_TOKEN`
- `PUSHOVER_USER_KEY`

Do not place secret values in this repository.

## Monitoring

Cron runs every minute and checks the authenticated JOLLY ROGER Ajax response.

Notifications currently enabled:

- Ruby becomes full (`full_recovery_date` becomes empty)
- Collection becomes available (`gold_collect >= 1`)
- A previously active construction disappears from the active build IDs

Raid state (`raid_monster_flg`) is retained for later live-event verification; automatic raid notification should remain disabled until validated during an active raid event.

## Public endpoint

- `/health` only

Test/debug notification endpoints have been removed for production use.

## Deployment

Production branch: `main`

Cloudflare build/deploy command:

`npx wrangler deploy`
