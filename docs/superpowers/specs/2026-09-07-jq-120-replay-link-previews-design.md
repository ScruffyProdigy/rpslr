# JQ-120 — Link-preview cards for replay URLs

Source: [JQ-120](https://linear.app/joinquest/issue/JQ-120). Depends on
[JQ-117](https://linear.app/joinquest/issue/JQ-117), the spectator replay view,
which is merged on `main` (`d5fac91`). Blocks
[JQ-122](https://linear.app/joinquest/issue/JQ-122), the story-format share card.

## Problem

`ShareReplayButton` hands someone an absolute `/replay/:ref` URL and the whole
point of it is to be pasted somewhere else. Everywhere it lands — iMessage,
Discord, Slack, WhatsApp, X, Facebook, LinkedIn, Telegram — the platform fetches
that URL server-side, with no JavaScript, and reads `og:*` / `twitter:*` from the
`<head>`.

The client is static nginx serving one SPA shell for every path
(`client/nginx.conf`), so a crawler gets a document that says nothing about the
match. The link renders as a bare grey URL. A replay that took two people five
rounds to make looks, in the place it gets shared, like nothing happened.

Every platform caches its card by URL and most never re-fetch. A finished match
never changes, so the card for it is stable by nature — but a card served wrong
once is served wrong for good.

## Non-goals

- Video / player cards. X requires approval for them and a five-round match is
  not worth the review.
- Story-format 1080×1920 cards for Instagram and Snapchat. Those platforms do
  not render link previews at all; they are JQ-122's problem.
- Cards for anything but a replay. The match page is not shared.

## Decisions

| Question | Decision |
| --- | --- |
| Who serves `/replay/:ref` | The API, for humans and crawlers alike |
| How the SPA still loads | API injects meta into the client's own `index.html`, fetched from the client service and revalidated by ETag |
| Rasteriser | `@resvg/resvg-js`, one SVG template |
| When the PNG is made | On first request, cached in process by ref + perspective |
| Unknown / unfinished ref | Generic card, HTTP 200, never an error |
| Who sets `?by=` | `ShareReplayButton`, with the sharer's own seat |

### Why the API serves the page rather than sniffing user agents

The alternative was leaving nginx to serve humans and proxying only known
crawler user-agents to a meta endpoint. That keeps the API out of the request
path for real browsers, but it puts the correctness of the whole feature in a
list of user-agent strings — iMessage's has changed more than once — and a
missed agent fails silently, as a blank card, on a URL that is already in
someone's chat history. It also puts the branch in per-environment nginx config,
where no test in this repo can reach it.

Serving both from one Express handler means one code path, exercised by the same
supertest suite that already covers `app.ts`, and the "never an error page"
requirement becomes a `try`/`catch` in TypeScript rather than a hope about nginx.

The cost is real and worth naming: the API now depends on the client service at
runtime, and a stale cached `index.html` would serve last release's bundle to
anyone opening a replay. That is exactly the failure `91c12d7` was written to
stop, so the template cache revalidates with `If-None-Match` on a 60s TTL rather
than holding a copy blind.

### Why on-demand rendering rather than pre-rendering at match end

Pre-rendering into Postgres would survive restarts and outlive a single replica.
It also costs a migration and renders a card for every match that finishes,
almost none of which are ever shared. Rendering on the first crawl and keeping
the bytes in process is proportional to how often this actually happens; a cold
render after a restart is one extra ~100ms, once, per shared match.

## Routes

```
GET /replay/:ref[?by=seatKey]                   → text/html
GET /api/v1/replay/:ref/card.png[?by=seatKey]   → image/png
```

`:ref` is what `replayRef()` already produces: an `externalMatchId` for a
Lobby-provisioned match, a room code for a standalone one. `service.getState`
resolves either, so both make a working card.

`og:url` and the absolute `og:image` are built from `config.playUrl`
(`https://rpsls-duel.win` in production, `http://localhost:5174` locally). One
new config value, `clientOrigin`, defaults to `playUrl` and is set to the
in-cluster `http://rps-game-client` in `k8s/base/api.yaml`.

## Modules

New directory `api/src/replayCard/`, each file with one job and no knowledge of
Express:

| File | Responsibility |
| --- | --- |
| `cardModel.ts` | `MatchState` + optional `by` → `CardModel`. Pure. Owns every string. |
| `cardLayout.ts` | `CardModel` → boxes on the 1200×630 canvas. Pure. |
| `cardSvg.ts` | model + layout → SVG. Pure. |
| `cardImage.ts` | SVG → PNG through resvg; loads fonts once. |
| `avatars.ts` | Lobby avatar URL → data URI, or `null`. |
| `metaHtml.ts` | `CardModel` + client shell → document with meta injected. |
| `clientTemplate.ts` | Fetch + ETag-revalidate the client's `index.html`. |
| `cache.ts` | TTL map: models, PNG bytes, template. |

`app.ts` gains two thin handlers that wire these together and catch everything.

## What the card says

Perspective is a property of the URL, so the two variants cache separately and
never collide.

| URL | `og:title` | Card headline |
| --- | --- | --- |
| `/replay/abc` | `Ana beat Ben 3–1 in RPSLR` | `Ana vs Ben · 3–1` |
| `/replay/abc?by=<Ana's seat>` | `Ana wins 3–1!` | `Ana wins 3–1` |
| `/replay/abc?by=<Ben's seat>` | `Ana beat Ben 3–1 in RPSLR` | `Ana vs Ben · 3–1` |

`?by=` names the person who shared, not the person who won. When the sharer won,
the card celebrates. When the sharer lost, it falls back to neutral wording
rather than announcing their defeat to everyone they sent it to — a link someone
forwards after losing should not read as a scoreboard rubbing it in.

`og:description` is the round-by-round line, deterministic and built from the
recorded results: `1 Rock over Scissors · 2 Paper over Rock · 3 draw · 4 Robot
over Rock`, truncated at 200 characters on a separator. A match that ended on a
forfeit says so instead of inventing rounds: `Ana won on forfeit after 2 rounds`.

The five moves are rock, paper, scissors, lizard and **robot** — the game
replaced Spock. Labels are capitalised from `MOVES` in `api/src/game.ts`; the
client's `BEAT_VERBS` rules copy ("crushes", "vaporizes") is deliberately not
duplicated here, which is why the line reads `over` rather than a verb.

## Layout and the safe square

The canvas is 1200×630. WhatsApp, LinkedIn and iMessage's compact form crop to
the centre square, so every piece of content — both avatars, both names, the
score, the headline, the wordmark — sits inside x ∈ [285, 915]. Outside that
band there is background and nothing else: the surface gradient and a faint
pentagon motif, both of which can be cropped away without losing meaning.

Colour comes from the tokens in `client/src/styles.css`, copied into a constants
module rather than imported across the client/API boundary: `--you` `#6c8cff`
for the left seat, `--opp` `#f5a524` for the right, `--trophy` `#f5c518` on the
winner's ring, the surface ladder for the ground. The two seats keep the colours
they wore during the match.

Avatars are fetched from the Lobby URL on the seat's `lobbyProfile`, in parallel,
with a 400ms timeout and a 200KB cap, and inlined as data URIs. Anything that
misses — no URL, slow host, dead link, oversized file — falls back to the
initial-on-disc that `PlayerAvatar` already draws on the board.

## Fonts

resvg cannot read the `.woff2` files the client ships, and its variable-font
support is partial, so static TTF instances of the same two families — Archivo
(the display face) and Atkinson Hyperlegible (the body face) — are vendored
under `api/assets/fonts/` with their OFL licence, loaded once as buffers at
module init. Both are already the game's faces; this is a second format of the
same fonts, not a second typeface.

## Failure and degradation

Neither route reaches the error middleware. Every failure has a card:

| Situation | Response |
| --- | --- |
| Unknown ref | Generic `RPSLR on JoinQuest` card, 200 |
| Match not finished | Generic card, 200, `Cache-Control: no-store` so the real card lands once it is |
| Database or service throws | Generic card, 200 |
| Client service unreachable | Meta plus a minimal built-in shell that links to the SPA |
| Render throws | Generic card; if that throws, a static fallback PNG |

The unfinished case is the one that needs `no-store`: it is the only card whose
content is going to change, and a platform that caches it would show "a match on
JoinQuest" forever on a link to a match that has since been decided.

## Performance

iMessage's crawler gives up quickly, so the meta response has a budget of under
one second and does not wait on the image — the crawler fetches `og:image`
separately. A cold card is one `getState`, two parallel avatar fetches capped at
400ms, and a resvg render. Warm, it is a map lookup.

Cache-Control: the PNG for a finished match is immutable for a year; the HTML is
`public, max-age=300`; anything generic or unfinished is `no-store`.

## Client change

`buildReplayUrl` takes an optional seat key and appends `?by=`.
`ShareReplayButton` passes the sharer's own seat, so the link a player shares
from their own match-end screen carries their perspective, while a link anyone
forwards afterwards stays exactly as they received it.

## Testing

- `cardModel` — neutral, winner-perspective, loser-perspective, draws, forfeit
  endings, unfinished match, unknown ref, a name that is only emoji.
- `cardLayout` — every content box inside the centre 630×630. The acceptance
  criterion as an assertion, not an eyeball.
- `cardImage` — PNG header reports 1200×630; bytes ≤ 300KB with two real avatars
  embedded.
- `metaHtml` — every required tag present (six `og:`, two `twitter:`),
  `twitter:card` is `summary_large_image`, the SPA's script tags survive
  injection, and a player named `<img onerror=…>` comes out escaped.
- Routes, through supertest as `app.test.ts` already does — including a stalled
  avatar host still answering under a second, and a 200 for a ref that does not
  exist.
- `npm run card:preview`, from `api/`, writes a PNG to disk, because a card that passes
  every assertion can still look wrong.

## Verified elsewhere

The six-platform check in the ticket — iMessage, Discord, WhatsApp, Slack, the X
card validator, the Facebook sharing debugger — needs a public HTTPS origin and
a phone. It happens after a staging deploy, by hand, and is the one acceptance
criterion this branch cannot close on its own.
