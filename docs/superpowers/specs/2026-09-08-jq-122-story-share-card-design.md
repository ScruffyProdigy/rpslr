# JQ-122 — Story-format share card

Linear: [JQ-122](https://linear.app/joinquest/issue/JQ-122/story-format-share-card-10801920-via-web-share-with-files-instagram)
Depends on: JQ-119 (share button), JQ-120 (card renderer) — both merged.

## Problem

Instagram Stories, Snapchat and TikTok do not render link previews. An IG link
sticker is a URL chip; the image on screen is whatever the person put there. So
JQ-120's work — a card a *crawler* fetches — buys us nothing on those three. To
be shareable there the game has to hand the player an actual image file.

`navigator.share({ files })` does exactly that: on iOS Safari and Android Chrome
it drops a PNG straight into the IG/Snapchat share sheet, and the person lands in
the Stories composer with the card already placed.

A story card also has to survive being *screenshotted*. A viewer who sees the
story cannot tap it. Whatever route back into the game the card offers has to
work from a static image on someone else's phone.

## Non-goals

- Video or animated cards. A 5-round match is not worth an encoder.
- Posting to Instagram on the player's behalf. There is no such API for Stories
  outside the share sheet, and we would not want it.
- A separate story card for unfinished matches. An unfinished match has nothing
  to brag about; it gets the generic card at story size.

## Decisions

### One model, two layouts

`CardModel` from JQ-120 already says everything a card needs. The story card
needs two things more — the deciding round's showdown, and the short code — so
those become fields on the same model rather than a parallel `StoryModel`.

The OG card ignores them. This is what keeps the two cards visually honest with
each other: they cannot drift apart in what they *know*, only in how they draw
it. `buildCardModel` stays pure and stays the single place a match is translated
into words.

### The short route reuses the join code, not a new one

Every match already carries a unique short code — `RPS-K7M2`, from `makeCode()`
in `api/src/repository.ts`. It is four characters from a 32-letter alphabet with
the confusable ones (I, O, 0, 1) already removed, it is `UNIQUE` in the schema,
and `getMatch()` — hence `service.getState()` — already resolves it.

So `/r/:code` needs no migration, no second code space, and no collision story.
It is a route and an ingress rule.

`/r/:code` **serves the replay page** rather than redirecting to `/replay/:id`.
A redirect would move the og: card onto the long URL, so a short link pasted into
Discord would preview as the long one — and the short link is the one people will
type. It answers with the same HTML and the same meta, with `og:url` set to the
short URL.

### The showdown is the deciding round, not the last round

The card shows the round that *won the match* — the last round the winner took —
not simply the final round, which may have been a draw. `Paper covers Rock` under
two icons says more about the match than the score alone does.

Three cases have no showdown and must not invent one:

| Case | What the card shows instead |
|---|---|
| Drawn match | The score, no showdown line |
| Forfeit (`endReason !== 'played'`) | "Won on forfeit" |
| A round whose moves we cannot resolve | The score, no showdown line |

### Move icons are copied into the API, deliberately

The five silhouettes live in `client/src/components/MoveIcon.tsx` as JSX. The API
cannot import across the package boundary, so `moveArt.ts` carries the same path
data as SVG strings — the same deliberate copy, for the same reason, as
`tokens.ts` already makes of the colours. Both files say so at the top.

The client draws its cut-outs with a luminance mask so an icon works on any
surface. The card always draws on a known dark ground, so the API's copy paints
the cut-outs in the ground colour instead. Same shape, one less indirection, and
no `<mask>` for resvg to get wrong.

### QR code as well as the short URL

Decided with Ryan, 2026-09-08. The card carries both a QR and `/r/RPS-K7M2` in
large type. iOS Live Text and Android Lens both find a QR *inside a screenshot*,
which is the case the short URL alone serves worst — and a viewer who would
rather type four characters still can.

`qrcode-generator` (MIT, zero dependencies) produces the module grid; `qrSvg.ts`
turns it into one `<path>`. Error correction level M, which tolerates the story
being re-compressed by Instagram.

## Routes

| Route | Answers |
|---|---|
| `GET /replay/:ref/story.png` | 1080×1920 PNG. `?by=<seatKey>` for the winner's own view |
| `GET /r/:code` | The replay page, with meta, for a short code |

`/replay/:ref/story.png` sits under the `/replay` ingress prefix, which already
reaches the API. `/r` is a new prefix and must be added to **both**
`k8s/base/ingress.yaml` and `k8s/env/production-ingress.yaml` — the production
overlay replaces the base rules wholesale, so a path added only to base never
reaches production.

Like every route JQ-120 added, neither may return an error status. A story card
that 500s is a share button that does nothing.

## Layout and Instagram's safe zone

The canvas is **1080×1920**. Instagram overlays its own chrome on the top and
bottom of a story — the author header above, the reply bar and sticker row below
— so all content lives inside **y ∈ [250, 1670]**, and `storyLayout.test.ts`
asserts it box by box, the way `cardLayout.test.ts` asserts the centre square.

Reading down the safe zone:

| Band | Content |
|---|---|
| 250–420 | Headline — "Ana wins 3–1" or "Ana vs Ben · 3–1" |
| 440–800 | Two avatar discs, 260px, score between them |
| 800–900 | Names, in `--you` and `--opp` |
| 940–1190 | The showdown: two move icons and the verb between them |
| 1190–1270 | The showdown caption — "Paper covers Rock" |
| 1310–1570 | QR, 260px, and the short URL beside it in 46px type |
| 1600–1670 | "RPSLR on JoinQuest" |

Nothing overlaps: `contentBoxes()` is checked pairwise, because a name drawn over
a disc is unreadable and no safe-zone assertion would notice.

## Budget

**≤ 1 MB.** A 1080×1920 PNG of flat colour, two photographic avatars and a QR
lands well under that, but the ceiling is asserted in the test that renders a
real card rather than assumed.

The image is cached per `(ref, by)` in the same `TtlCache` shape JQ-120 uses, and
only ever when `model.cacheable` — an unfinished match must not be cached, or the
card would still say "in progress" an hour after the match ended.

## Client change

`ShareReplayButton` grows a fourth way down, above the three it has:

1. `navigator.canShare({ files })` → fetch `story.png`, `share({ files, url })`
2. `navigator.share({ url })` — today's path, for browsers without file sharing
3. clipboard
4. the bare link on screen

The file fetch is bounded (4s) and failure falls through to (2) rather than
surfacing. A share sheet that opens a second late is fine; a button that reports
an error because an image was slow is not.

The "Save image" fallback appears only where `canShare({ files })` is false *and*
the browser can download — an anchor with `download`. It is a link to
`story.png`, not a blob, so the browser handles it.

`?by=<seatKey>` is already threaded through from JQ-120's client change; the
story URL reuses it, so the sharer's own card celebrates and a forwarded one does
not.

## Failure and degradation

Same rule as JQ-120: **every path ends in an image.**

| Goes wrong | Answer |
|---|---|
| Unknown ref or code | Generic card at 1080×1920 |
| Match unfinished | Generic card, `no-store` |
| Avatar slow or gone | Initial on a disc (JQ-120's `withAvatars`, unchanged) |
| QR generation throws | Card without the QR; the short URL still reads |
| Database unreachable | Generic card |

## Testing

- `storyLayout.test.ts` — every box inside the safe zone; no two boxes overlap
- `moveVerbs.test.ts` — every winning pair in `BEATS` has a verb; no losing pair does
- `qrSvg.test.ts` — decodes back to the URL; a known string renders a stable path
- `storySvg.test.ts` — names escaped; showdown absent on a draw and on a forfeit
- `storyImage.test.ts` — renders 1080×1920 and lands under 1 MB
- `routes.test.ts` — `/replay/:ref/story.png` and `/r/:code` for: finished,
  unfinished, unknown, and `?by=` both ways. None may answer non-200.
- `ShareReplayButton.test.tsx` — all four ways down, and the abort case

## Verified elsewhere

The AC asks for an end-to-end check on iOS Safari → Instagram Stories and
Android Chrome → Instagram Stories. Neither is reachable from CI or from this
worktree; both are listed in the PR as a manual step for Ryan, with
`npm run story:preview` writing the card to disk so the layout can be checked
without a phone.
