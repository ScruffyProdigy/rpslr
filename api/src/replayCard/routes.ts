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
import { renderCardPng } from './cardImage.js';
import { buildCardModel, genericCardModel, type CardModel } from './cardModel.js';
import { cardSvg } from './cardSvg.js';
import { FALLBACK_SHELL, getClientShell } from './clientTemplate.js';
import { injectMeta } from './metaHtml.js';

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
  const origin = deps.config.playUrl.replace(/\/$/, '');

  app.get('/replay/:ref', async (req: Request, res: Response) => {
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
          pageUrl: `${origin}/replay/${encodeURIComponent(ref)}${query}`,
          imageUrl: `${origin}/api/v1/replay/${encodeURIComponent(ref)}/card.png${query}`,
        }),
      );
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
