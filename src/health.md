# DL Weiqi health checks

How status.dliu.com (or anyone) can test https://weiqi.dliu.com as an anonymous guest. This is the full technical version of https://weiqi.dliu.com/docs/health. The site has no sign-in.

## Functions

| Key | Name | Critical | What a guest gets | Down means |
|---|---|---|---|---|
| `pages` | Pages (网页) | yes | The home, play, record, library, guide and docs pages open. | The site does not load. |
| `live-game` | Live game and shared draft (现场对局和共享草稿) | yes | The live game, the shared recording draft and the game list can be read. | Nobody can play or record a game. |
| `library` | Game library (棋谱库) | yes | The saved-game list and a single saved game open. | Saved games cannot be viewed. |
| `reports` | Game reports (棋局报告) | no | Prepared AI game reports open, the report renderer is ready, and no failed reports are waiting. | New reports are not made, and existing ones may not open. |
| `analysis` | AI game analysis (AI 棋局分析) | no | AI analysis is not paused by the spending guard. The check never starts an analysis. | New games get no AI analysis for now; it catches up later. |
| `position` | Photo recognition and position analysis (照片识别和局面分析) | no | The photo-recognition and position-analysis functions are ready and not paused by the spending guard. The check never reads a photo or analyses a position. | Photos and positions cannot be analysed. |

## Guest checks

One row per check. Method GET, no cookies. "Type" is a prefix of `Content-Type`. "Marker" is a fixed string in the body (a JSON key for JSON). For redirects, `Location` must equal the given value. "Slow" is the time above which the check counts as slow.

| Function | Method | URL | Status | Type | Marker or Location | Slow (ms) |
|---|---|---|---|---|---|---|
| `pages` | GET | https://weiqi.dliu.com/ | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/play | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/record | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/guide | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/docs | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/docs/health | 200 | `text/html` | `dl-header` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/docs/health.md | 200 | `text/markdown` | `# DL Weiqi health checks` | 2000 |
| `pages` | GET | https://weiqi.dliu.com/about | 301 | — | Location: `/docs` | — |
| `pages` | GET | http://weiqi.dliu.com/ | 301 | — | Location: `https://weiqi.dliu.com/` | — |
| `live-game` | GET | https://weiqi.dliu.com/api/game | 200 | `application/json` | `"state"` | 3000 |
| `live-game` | GET | https://weiqi.dliu.com/api/draft | 200 | `application/json` | `"draft"` | 3000 |
| `live-game` | GET | https://weiqi.dliu.com/api/games | 200 | `application/json` | `"games"` | 3000 |
| `library` | GET | https://weiqi.dliu.com/game | 200 | `text/html` | `dl-header` | 2000 |
| `library` | GET | https://weiqi.dliu.com/api/library | 200 | `application/json` | `"games"` | 3000 |
| `library` | GET | https://weiqi.dliu.com/game/2026101001 | 200 | `text/html` | `dl-header` | 2000 |
| `library` | GET | https://weiqi.dliu.com/api/library/2026101001 | 200 | `application/json` | `"metadata"` | 3000 |
| `reports` | GET | https://weiqi.dliu.com/game/2026101001/report | 200 | `text/html` | `dl-header` | 2000 |
| `reports` | GET | https://weiqi.dliu.com/api/library/2026101001/report | 200 | `application/json` | `"availableLanguages"` | 3000 |
| `reports` | GET | https://weiqi.dliu.com/prepared-reports/2026101001/index.json | 200 | `application/json` | `"id"` | 3000 |
| `analysis` | GET | https://weiqi.dliu.com/api/library/2026101001 | 200 | `application/json` | `"analysis"` | 3000 |
| `position` | GET | https://weiqi.dliu.com/analysis | 200 | `text/html` | `dl-header` | 2000 |
| `health` | GET | https://weiqi.dliu.com/health | 200 or 503 | `application/health+json` | `"status"` | 5000 |

## Health endpoint

`GET https://weiqi.dliu.com/health`

- CloudFront caches it for 60 s (cache key: nothing; `Cache-Control: public, max-age=60`). The `/health` behavior forwards no cookies, no `Authorization` header and no query string, and the handler reads no part of the request.
- Each read has its own 2 s timeout (reported as `timeout`); the response returns within 5 s.
- `Content-Type: application/health+json`. HTTP 200 when `status` is `pass` or `warn`, 503 when it is `fail`. The top-level `status` is the worst function status.
- Read only: one cheap read per dependency, no writes, no S3 LIST, and it never starts analysis, recognition, report rendering, GPU or Fargate work. Nothing private: no resource names, counts or user data; `output` is only one of the values below.
- `output` values: `timeout`, `read failed`, `function not ready`, `paused by spending guard`, `failed reports waiting`.

| Key | What /health reads | pass | warn | fail |
|---|---|---|---|---|
| `pages` | Site bucket: HeadObject of index.html. | object found | — | `timeout`, `read failed` |
| `live-game` | DynamoDB game table: GetItem of the fixed live-game key (key only). | read succeeded | — | `timeout`, `read failed` |
| `library` | Library bucket: GetObject of one small fixed control file. | read succeeded | — | `timeout`, `read failed` |
| `reports` | Report renderer state (Lambda GetFunctionConfiguration); whether the failed-report queue is empty (SQS GetQueueAttributes). | renderer ready and queue empty | `failed reports waiting`, or the renderer is updating (`function not ready`) | `timeout`, `read failed`, `function not ready` |
| `analysis` | The same control-file read as the library: its paused flag. | not paused | `paused by spending guard` | `timeout`, `read failed` |
| `position` | State of both functions (Lambda GetFunctionConfiguration); the control file's paused flag. | both functions ready and not paused | `paused by spending guard`, or a function is updating (`function not ready`) | `timeout`, `read failed`, `function not ready` |

Example response:

```json
{
  "status": "warn",
  "time": "2026-11-03T23:00:00.000Z",
  "functions": [
    {
      "key": "pages",
      "name": "Pages",
      "status": "pass"
    },
    {
      "key": "live-game",
      "name": "Live game and shared draft",
      "status": "pass"
    },
    {
      "key": "library",
      "name": "Game library",
      "status": "pass"
    },
    {
      "key": "reports",
      "name": "Game reports",
      "status": "warn",
      "output": "failed reports waiting"
    },
    {
      "key": "analysis",
      "name": "AI game analysis",
      "status": "pass"
    },
    {
      "key": "position",
      "name": "Photo recognition and position analysis",
      "status": "pass"
    }
  ]
}
```

## Not tested

- Playing moves, recording and saving games: these change shared content, so guest checks never do them.
- Actually running AI analysis, photo recognition or position analysis: each run costs money. /health only confirms they are ready and not paused.
- The site has no sign-in, so there are no signed-in features.

## Rules

- Only GET, with no cookies, no `Authorization` header and no request body. (Pages also accept HEAD, but `/api/` answers HEAD with 405.)
- Never POST, never change content and never start paid work (analysis, recognition, report rendering).
- Send the user agent `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`.
- Reading `/api/game` may finish publishing a game its players already ended, exactly as any visitor's page load would. It never changes a game in progress.
- The library API (`/api/library…`) allows 120 reads a minute per connection; one check run uses a handful.
