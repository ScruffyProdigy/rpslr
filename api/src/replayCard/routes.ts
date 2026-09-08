/**
 * The two public surfaces of a shared replay link.
 *
 * Neither may fail. A crawler caches by URL and most never come back, so a 500
 * served once is a dead card for good — every path below ends in a card.
 */
import type { Express, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { GameService } from '../service.js';
import { withAvatars } from './avatars.js';
import { TtlCache } from './cache.js';
import { renderCardPng, renderStoryPng } from './cardImage.js';
import { buildCardModel, genericCardModel, type CardModel } from './cardModel.js';
import { cardSvg } from './cardSvg.js';
import { FALLBACK_SHELL, getClientShell } from './clientTemplate.js';
import { injectMeta } from './metaHtml.js';
import { storySvg } from './storySvg.js';

export interface ReplayCardDeps {
  service: Pick<GameService, 'getState'>;
  config: Pick<AppConfig, 'playUrl' | 'clientOrigin'>;
  fetchImpl?: typeof fetch;
}

const MODEL_TTL_MS = 10 * 60_000;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=300';
const NO_STORE = 'no-store, no-cache, must-revalidate';

export function registerReplayCardRoutes(app: Express, deps: ReplayCardDeps): void {
  const models = new TtlCache<CardModel>(MODEL_TTL_MS);
  const images = new TtlCache<Buffer>(MODEL_TTL_MS);
  // Stories are ten times the pixels of a link card; a smaller shelf keeps the
  // two from together holding more than a card server has any business holding.
  const stories = new TtlCache<Buffer>(MODEL_TTL_MS, 60);
  const origin = deps.config.playUrl.replace(/\/$/, '');

  /**
   * The short link the story card prints and encodes. It resolves the same way
   * every other ref does — `getState` has always taken a join code — so it
   * serves the page rather than redirecting to the long URL. A redirect would
   * move the og: card onto the long URL, and the short one is the one people
   * type.
   */
  app.get('/r/:ref', replayPage);
  app.get('/replay/:ref', replayPage);

  async function replayPage(req: Request, res: Response): Promise<void> {
    const ref = req.params.ref;
    const by = seatParam(req);
    const query = by ? `?by=${encodeURIComponent(by)}` : '';
    let model = genericCardModel(ref);
    let shell = FALLBACK_SHELL;

    // Anything at all can go wrong here; the answer is a card either way.
    try {
      model = await modelFor(ref, by);
      shell = await getClientShell(deps.config.clientOrigin, { fetchImpl: deps.fetchImpl });
    } catch {
      model = genericCardModel(ref);
    }

    res
      .type('text/html')
      .set('Cache-Control', model.cacheable ? HTML_CACHE : NO_STORE)
      .send(
        injectMeta(shell, {
          model,
          // The URL the reader is actually on. A short link shared onward stays
          // short, and the two forms cache apart on every platform rather than
          // one of them previewing as the other.
          pageUrl: `${origin}${req.path}${query}`,
          imageUrl: `${origin}/api/v1/replay/${encodeURIComponent(ref)}/card.png${query}`,
        }),
      );
  }

  /**
   * The story card. Not an og:image — nothing crawls this — but the file the
   * share sheet hands to Instagram, so the same rule applies: it may never fail.
   * A share button that reports an error is worse than one that shares a
   * generic card.
   */
  app.get('/replay/:ref/story.png', async (req: Request, res: Response) => {
    const ref = req.params.ref;
    const by = seatParam(req);
    const key = cacheKey(ref, by);

    let png = stories.get(key);
    let cacheable = png !== undefined;

    if (!png) {
      try {
        const model = await withAvatars(await modelFor(ref, by), { fetchImpl: deps.fetchImpl });
        png = renderStoryPng(storySvg(model, { origin }));
        cacheable = model.cacheable;
        if (cacheable) stories.set(key, png);
      } catch {
        png = renderStoryPng(storySvg(genericCardModel(ref), { origin }));
        cacheable = false;
      }
    }

    res
      .type('image/png')
      .set('Cache-Control', cacheable ? IMMUTABLE : NO_STORE)
      .send(png);
  });

  app.get('/api/v1/replay/:ref/card.png', async (req: Request, res: Response) => {
    const ref = req.params.ref;
    const by = seatParam(req);
    const key = cacheKey(ref, by);

    let png = images.get(key);
    // A cached PNG is only ever a cacheable one, so a hit is immutable by
    // construction; a miss has to ask the model it just built.
    let cacheable = png !== undefined;

    if (!png) {
      try {
        const model = await withAvatars(await modelFor(ref, by), { fetchImpl: deps.fetchImpl });
        png = renderCardPng(cardSvg(model));
        cacheable = model.cacheable;
        if (cacheable) images.set(key, png);
      } catch {
        png = renderCardPng(cardSvg(genericCardModel(ref)));
        cacheable = false;
      }
    }

    res
      .type('image/png')
      .set('Cache-Control', cacheable ? IMMUTABLE : NO_STORE)
      .send(png);
  });

  async function modelFor(ref: string, by: string | null): Promise<CardModel> {
    const key = cacheKey(ref, by);
    const cached = models.get(key);
    if (cached) return cached;
    try {
      const state = await deps.service.getState(ref);
      const model = buildCardModel(state, { ref, by });
      if (model.cacheable) models.set(key, model);
      return model;
    } catch {
      // Unknown ref, unreachable database — the card is the same either way.
      return genericCardModel(ref);
    }
  }
}

function cacheKey(ref: string, by: string | null): string {
  return by ? `${ref}?by=${by}` : ref;
}

/** A seat key is a short opaque string; anything else is not one. */
function seatParam(req: Request): string | null {
  const raw = req.query.by;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= 64 ? value : null;
}
