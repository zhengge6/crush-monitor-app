# Crush Monitor data (server-side)

- `redeem-codes.json` — admin-editable seed / companion list of redeem codes.
  On first boot the server merges these into `usage.json`.
  Prefer `POST /api/admin/codes` with header `X-Admin-Token: $ADMIN_TOKEN`.
- `usage.json` — runtime store of codes, device bindings, sessions, and daily run quotas
  (3 analyses / device / Asia-Shanghai day when using the built-in key).

Private/incognito browsers reset localStorage + cookies, so device id and quota reset.
