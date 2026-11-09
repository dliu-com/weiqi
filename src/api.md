# Weiqi API

This reference is for trusted tools, scripts and AI agents working with the Go (weiqi) site at https://weiqi.dliu.com. This plain Markdown file (https://weiqi.dliu.com/docs/api.md) is the full reference; people get a plain-language overview in the API tab at https://weiqi.dliu.com/docs#api.

The managed API accepts Microsoft-issued user access tokens. It can read the live game, the recording draft, the game library and AI reports; save new games; edit a saved game's info; and delete saved games — each only when the token has the matching permission.

**Authentication is required:** configure your requester using the [Auth API documentation](https://auth.dliu.com/docs#api). That is the canonical guide for credentials, token acquisition, the token file, expiry and renewal, and building the `Authorization: Bearer` header.

## Quick rules

1. The managed API origin (deployment output `MicrosoftApiUrl`) is `__WEIQI_API_URL__`. Send every request to that origin. All nine managed routes are listed below.
2. Configure authentication according to the [Auth API documentation](https://auth.dliu.com/docs#api) before using any managed route. The website's own `https://weiqi.dliu.com/api/...` routes are for browsers: they never accept bearer tokens, and guests there can only read and play — they cannot edit or delete games.
3. Request bodies are JSON objects with `Content-Type: application/json`. Managed requests do not need `Origin`, website cookies or `x-amz-content-sha256`.
4. Request only user-authorized operations. Do not run write or delete examples just to check a token.
5. `weiqi.write` does not include `weiqi.delete`: `DELETE` needs `weiqi.delete`, which is granted separately.
6. Errors are JSON `{"message":"..."}`, from either the gateway or the Weiqi function.

## Endpoint summary

| Method and path | Required scope | Operation |
| --- | --- | --- |
| [GET /api/me](#get-api-me) | `weiqi.read` | Read the authenticated user identity |
| [GET /api/game](#get-api-game) | `weiqi.read` | Read the live game on /play |
| [GET /api/draft](#get-api-draft) | `weiqi.read` | Read the shared recording draft on /record |
| [GET /api/library](#get-api-library) | `weiqi.read` | List saved games, newest first |
| [GET /api/library/{gameId}](#get-api-library-gameid) | `weiqi.read` | Read one game: metadata, original SGF and analysis |
| [GET /api/library/{gameId}/report](#get-api-library-gameid-report) | `weiqi.read` | Read the game's AI report data |
| [POST /api/library](#post-api-library) | `weiqi.write` | Save a new game and queue its AI analysis |
| [PATCH /api/library/{gameId}](#patch-api-library-gameid) | `weiqi.write` | Edit a saved game's info |
| [DELETE /api/library/{gameId}](#delete-api-library-gameid) | `weiqi.delete` | Delete a saved game |

`{gameId}` is the 10–14 digit game ID shown in a game's address, for example `2026101001` in `https://weiqi.dliu.com/game/2026101001`.

## Authentication and access

The gateway validates the Microsoft signature, the tenant-specific v2 issuer, the audience, token times and the route's scope. The Weiqi function then checks again: the configured gateway, tenant, audience, token version, the approved client (`azp`), the user object ID and an explicit assignment of the shared `api.access` role (shown in Entra as "dliu API user"), plus the route's scope.

**API versus website:** the website's "Admin sign in" is a separate Microsoft sign-in for the site owner only; it gives no API rights, and API tokens are never accepted by the website. Guests (not signed in) keep exactly the public website features: play, record, save new games within the public limits, and read the library and reports. They cannot edit game info or delete games.

**Access model:** there is no per-game owner. An authorized caller can read every game and, within its scopes, edit or delete any game except the protected sample game. Writes are logged with the caller's Microsoft object ID. The API keeps no tokens and never logs bearer headers.

**Rate limit:** 10 requests a second with bursts of 20 across the API; above that the gateway answers `429`.

## Request examples

These examples assume `TOKEN` holds a dliu API access token obtained as the [Auth API documentation](https://auth.dliu.com/docs#api) describes.

```bash
export WEIQI_API_URL='__WEIQI_API_URL__'
curl -sS -H "Authorization: Bearer $TOKEN" "$WEIQI_API_URL/api/me"
curl -sS -H "Authorization: Bearer $TOKEN" "$WEIQI_API_URL/api/library?limit=5"
curl -sS -H "Authorization: Bearer $TOKEN" "$WEIQI_API_URL/api/library/2026101001"
# Only when explicitly asked to change this game:
curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Club final","players":{"black":"Ke Jie"},"result":"B+R"}' "$WEIQI_API_URL/api/library/GAME_ID"
```

## Reading

### GET /api/me

Returns `{"user":"<object id>","name":"<display name>"}`.

### GET /api/game

Returns `{"state":{...},"serverTime":<ms>}`: the live game on https://weiqi.dliu.com/play, the same state the website shows.

### GET /api/draft

Returns `{"draft":{...}}`: the shared recording draft on https://weiqi.dliu.com/record, including its SGF (`draft.sgf`) and `revision`.

### GET /api/library

Lists saved games, newest first. Query: `limit` (whole number 1–50, default 20) and `cursor` (the previous page's `cursor`). Returns `{"games":[metadata...],"cursor":"..." | null,"total":<count or null>}`.

### GET /api/library/{gameId}

Returns `{"metadata":{...},"sgf":"...","analysis":{...} | null}`.

- `metadata` holds the game info shown on the site (`name`, `players`, `playerRanks`, `date`, `venue`, `result`, `komi`, `rules`, `handicap`, `moves`, …) and the analysis status (`analysis.status`: `queued`, `running`, `retry_wait`, `ready`, `failed`, `limited` or `paused`).
- `sgf` is the game exactly as it was saved. If the info was edited (`metadata.infoEditedAt` is set), `metadata` is authoritative for those fields; the SGF downloaded from the website already includes the edits.
- `analysis` is the KataGo result once a pass has finished, otherwise `null`.

### GET /api/library/{gameId}/report

Returns the AI report data used by https://weiqi.dliu.com/game/{gameId}/report. Answers `409` until the deep analysis has finished and while the report is being prepared (for example a few minutes after an info edit); try again later.

## Changing

### POST /api/library

Saves a new game, with the same rules as **Save game** on /record. Body:

| Field | Required | Meaning |
| --- | --- | --- |
| `sgf` | yes | One 19 × 19 game whose main line is a legal sequence of 50–400 moves. |
| `filename` | no | 1–255 characters; default `api-upload.sgf`. |
| `deep` | no | `false` for a quick analysis only; default `true` (quick, then deep, while today's deep allowance lasts). |
| `requestId` | no | 1–100 letters, digits, dots, dashes or underscores. The same caller and `requestId` always return the same game, so a retry never saves twice. |

The whole request may be at most 1.6 MB. Returns `201` with `{"id":"...","url":"https://weiqi.dliu.com/game/...","metadata":{...}}`. Answers `429` when the site-wide limit of 100 new games a day (shared with the website) is used up.

### PATCH /api/library/{gameId}

Edits a saved game's info. Send only the fields to change:

| Field | Meaning |
| --- | --- |
| `name` | Game name; cannot be empty. |
| `players` | `{"black":"...","white":"..."}`; either side may be left out. |
| `playerRanks` | `{"black":"...","white":"..."}`, for example `"9p"` or `"3d"`. |
| `date` | Game date as text, for example `2026-11-01`. |
| `venue` | Where it was played; `""` clears it. |
| `result` | Result as text, for example `B+R`, `W+2.5` or `Draw`; `""` clears it. |

Each text is trimmed, may be at most 200 characters and cannot contain control characters; the whole request may be at most 10 KB. Komi, rules, handicap and moves cannot be edited (`400`). The saved SGF is never changed: the edit is stored with the game's metadata, and the website, SGF downloads and the share preview use it.

Returns `200` with `{"id":"...","metadata":{...},"report":"..."}`. `report` says what happens to the AI report:

- `updating` — the analysis is complete, and the report is being prepared again with the new info (a few minutes).
- `after-analysis` — the game is still being analysed (or has only a quick analysis); the report will include the new info when it is built.
- `updated` / `failed` — the report data was refreshed, or refreshing it failed; the edit itself is saved either way.

Repeating the same edit changes nothing.

### DELETE /api/library/{gameId}

Deletes a saved game and its report, using the same guarded delete as the website's admin. Returns `200` with `{"deleted":"<gameId>"}`. Answers `409` while AI analysis is still running and for the protected sample game `2026101001`. Storage keeps earlier versions, so the site owner can recover a game deleted by mistake.

## Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, field or query value; the message says which. |
| `401` | No token, or an invalid, expired or wrong-tenant token. |
| `403` | A valid token without the `api.access` role, the approved client or the route's scope. |
| `404` | Unknown route or game. |
| `409` | The report is not ready yet, or the game cannot be deleted now (analysis still running) or ever (sample game). |
| `413` | The request is too large. |
| `415` | The body is not JSON. |
| `429` | Too many requests, or today's save limit is used up. |
| `500` | Something went wrong; retry later. |
