import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { GAME_NAME, GAME_VERSION, type AppConfig } from './config.js';
import { buildGameModesPayload, getGameMode } from './gameModes.js';
import { optionSourceFor } from './helpers/queueOptions.js';
import { buildLaunchUrlsForAssignment } from './launchUrls.js';
import {
  ConflictError,
  NotFoundError,
  ReservationError,
} from './repository.js';
import {
  parseLobbyProvision,
  parseStandaloneSeats,
  verifyLobbyProvisionAuth,
} from './provision.js';
import {
  BannedPlayerError,
  PreQueueError,
  ValidationError,
  type GameService,
} from './service.js';
import { registerReplayCardRoutes } from './replayCard/routes.js';
import {
  clearSeatBindingCookie,
  decodeSeatBinding,
  readCookie,
  seatBindingCookie,
  SEAT_BINDING_COOKIE,
} from './seatBinding.js';
import { createTokenVerifier, TokenError, type TokenVerifier } from './tokens.js';

/**
 * Build the Express app around an injected GameService (and optional token
 * verifier). The same service instance is shared with the WebSocket layer so
 * REST and WS mutations stay consistent. Tests inject a service backed by the
 * in-memory repo + a fake verifier — no database or live Lobby JWKS needed.
 */
export function createApp(
  service: GameService,
  config: AppConfig,
  tokenVerifier?: TokenVerifier,
  opts: { fetchImpl?: typeof fetch } = {},
): Express {
  const app = express();
  // Lazily build the JWKS verifier so standalone/test paths never touch it.
  let verifier = tokenVerifier;
  const getVerifier = () => (verifier ??= createTokenVerifier(config.tokenAudiences));

  app.use(express.json());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsAllowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // false = deny without throwing (avoids 500 on preflight)
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  // --- Platform/health endpoints --------------------------------------------
  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

  app.get('/api/v1/status', (_req, res) => {
    res.json({
      game: GAME_NAME,
      version: GAME_VERSION,
      appEnv: config.appEnv,
      standalone: !config.requireLobbyAuth,
      launchUrlsOnProvision: true,
    });
  });

  // Game-mode manifest: Lobby catalog sync reads this (see lobby game-catalog-architecture.md).
  // Declaring `preQueue` on a mode here is also what tells Lobby to send `options`
  // on provision for it, so the catalog gains duel-helpers by this route alone.
  app.get('/api/v1/game-modes', (_req, res) => {
    res.json(buildGameModesPayload(GAME_NAME));
  });

  const api = express.Router();

  // The pre-queue roster Lobby's picker renders. A fixed conventional path, matching
  // the mode-eligibility endpoint, so Lobby SSRF-validates one origin rather than a
  // path each game declares for itself.
  //
  // The roster is the same for every player: no progression, so `lobbyUserId` is
  // read only to keep the path shape Lobby already knows. It is generated from
  // `roster.ts`, never hand-written — see `helpers/queueOptions.ts`.
  //
  // This endpoint does not fail open. If it errors or times out, Lobby makes the
  // mode unjoinable rather than inventing a roster, so it must not sit behind
  // anything with a cold start.
  api.get('/players/:lobbyUserId/queue-options', (req: Request, res: Response) => {
    const modeKey = typeof req.query.modeKey === 'string' ? req.query.modeKey.trim() : '';
    if (!modeKey) return res.status(400).json({ error: 'modeKey is required' });

    const mode = getGameMode(modeKey);
    if (!mode) return res.status(404).json({ error: `unknown mode: ${modeKey}` });

    // A mode with no pre-queue pick answers 200 with an empty roster, not 404: the
    // mode exists and is joinable, it just asks nothing before the queue.
    const groups = mode.preQueue?.groups ?? [];
    const choices = groups.flatMap((group) => optionSourceFor(group)?.choices() ?? []);
    return res.json({ modeKey: mode.key, choices });
  });

  // Create a match — either a Lobby-pushed assignment or a standalone self-serve.
  api.post(
    '/matches',
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body ?? {};
      if (body.assignment) {
        const parsed = parseLobbyProvision(body);
        if (typeof parsed === 'string') {
          return res.status(400).json({ error: parsed });
        }
        const authErr = verifyLobbyProvisionAuth(req.header('authorization'), parsed.lobby.serviceToken);
        if (authErr) {
          return res.status(401).json({ error: authErr });
        }
        const state = await service.ensureMatchFromAssignment(parsed);
        const launchUrls = buildLaunchUrlsForAssignment(config.playUrl, parsed.assignment);
        console.info(
          JSON.stringify({
            event: 'provision.launch_urls',
            externalMatchId: parsed.assignment.externalMatchId,
            gameMode: parsed.assignment.gameMode,
            seatCount: parsed.assignment.seats.length,
            launchUrlCount: Object.keys(launchUrls).length,
            playUrl: config.playUrl,
          }),
        );
        return res.status(201).json({ ...state, launchUrls });
      }
      // A mode with a pre-queue pick needs one here too: standalone has no lobby to
      // pick in, so the caller names the loadouts rather than getting a default.
      const standaloneSeats = parseStandaloneSeats(body.seats);
      if (typeof standaloneSeats === 'string') {
        return res.status(400).json({ error: standaloneSeats });
      }
      const result = await service.createStandaloneMatch({
        gameMode: body.gameMode,
        name: body.name,
        bestOf: body.bestOf,
        hostName: body.hostName,
        hostLobbyUserId: body.lobbyUserId,
        seats: standaloneSeats,
      });
      return res.status(201).json(result);
    }),
  );

  // `?playerId=` says whose seat is asking. It changes only the seat-private
  // `abilities`; without it the response is the shared view, which is what a
  // spectator or a link preview should get anyway.
  api.get(
    '/matches/:ref',
    asyncHandler(async (req: Request, res: Response) => {
      const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : null;
      res.json(await service.getState(req.params.ref, playerId));
    }),
  );

  // Claim a seat. With a Bearer token the seat is dictated by Lobby's signed
  // assignment; standalone callers pass a seatKey (or we auto-pick an open one).
  api.post(
    '/matches/:ref/claim',
    asyncHandler(async (req: Request, res: Response) => {
      const token = bearer(req);

      if (token) {
        const claims = await getVerifier().verify(token);
        if (req.params.ref !== claims.externalMatchId) {
          throw new NotFoundError('match not found');
        }
        await service.assertMatchProvisioned(claims);
        const result = await service.claimSeatWithLobbyClaims(
          claims.externalMatchId,
          claims,
          req.body?.playerName,
        );
        // Recovery path 1: the game writes down browser → seat on its own
        // origin, so a refresh or a tab crash comes back here with no token and
        // no Lobby round trip. See `GET /resume` below.
        res.setHeader(
          'Set-Cookie',
          seatBindingCookie(
            {
              externalMatchId: claims.externalMatchId,
              seatKey: result.you.seatKey,
              lobbyUserId: claims.lobbyUserId,
              playerId: result.you.playerId,
            },
            { secure: config.cookieSecure },
          ),
        );
        // 200 for a re-claim, 201 for a first sitting: the player who already
        // holds this seat is reconnecting, and nothing was created for them.
        return res.status(result.reclaimed ? 200 : 201).json(result);
      }

      if (config.requireLobbyAuth) {
        return res.status(401).json({ error: 'lobby token required' });
      }

      const { playerName, lobbyUserId } = req.body ?? {};
      let seatKey: string | undefined = req.body?.seatKey;
      if (!seatKey) {
        // Auto-pick the first open, unreserved seat (standalone convenience).
        const state = await service.getState(req.params.ref);
        const open = state.seats.find((s) => !s.player && !s.reservedForLobbyUser);
        if (!open) return res.status(409).json({ error: 'no open seats' });
        seatKey = open.seatKey;
      }
      const result = await service.claimSeat(req.params.ref, {
        seatKey,
        name: playerName?.trim() || 'Challenger',
        lobbyUserId: lobbyUserId ?? null,
      });
      return res.status(result.reclaimed ? 200 : 201).json(result);
    }),
  );

  // Recovery path 1: resume this browser's seat from the game's own binding.
  //
  // No token, no Lobby request, nothing but a cookie this API set on its own
  // origin — which is the point: it is the path that still works when Lobby is
  // unreachable or the player's Lobby session is gone. The other half (the
  // Rejoin button) is Lobby's, and the two fail independently on purpose.
  //
  // The binding names a seat; the match decides. A cookie naming a finished
  // match, or a seat someone else now holds, resumes nothing and is cleared, so
  // the browser stops presenting a binding that can never work again.
  //
  // @see docs/lobby-protocol-handoff.md#reconnecting-a-player
  api.get(
    '/resume',
    asyncHandler(async (req: Request, res: Response) => {
      const binding = decodeSeatBinding(readCookie(req.header('cookie'), SEAT_BINDING_COOKIE));
      if (!binding) return res.status(404).json({ error: 'no seat binding' });

      const result = await service.resumeFromBinding(binding);
      if (!result) {
        res.setHeader('Set-Cookie', clearSeatBindingCookie({ secure: config.cookieSecure }));
        return res.status(404).json({ error: 'no resumable seat' });
      }
      return res.json(result);
    }),
  );

  api.post(
    '/matches/:ref/move',
    asyncHandler(async (req: Request, res: Response) => {
      const { playerId, move, round } = req.body ?? {};
      if (!playerId) return res.status(400).json({ error: 'playerId is required' });
      res.json(await service.submitMove(req.params.ref, playerId, move, round));
    }),
  );

  // Spending a charge is a separate act from committing a move, so it is a
  // separate route — see `GameService.fireAbility` for why.
  api.post(
    '/matches/:ref/fire',
    asyncHandler(async (req: Request, res: Response) => {
      const { playerId, helperId, target, source, round } = req.body ?? {};
      if (!playerId) return res.status(400).json({ error: 'playerId is required' });
      res.json(await service.fireAbility(req.params.ref, playerId, {
        helperId,
        target,
        source,
        round,
      }));
    }),
  );

  // Replay link previews (JQ-120). Registered before the error middleware:
  // these routes answer with a card rather than an error, always.
  registerReplayCardRoutes(app, { service, config, fetchImpl: opts.fetchImpl });

  app.use('/api/v1', api);

  // --- Error handling --------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof BannedPlayerError) {
      return res.status(403).json({ error: err.message, bannedLobbyUserIds: err.bannedLobbyUserIds });
    }
    // 400, never 403 — Lobby parses 403 as the banlist shape and would re-matchmake
    // forever on a selection it can only fix by not sending it again.
    if (err instanceof PreQueueError) {
      return res
        .status(400)
        .json({ error: 'invalid pre-queue selection', seatKey: err.seatKey, reason: err.reason });
    }
    if (err instanceof ReservationError) return res.status(403).json({ error: err.message });
    if (err instanceof ConflictError) return res.status(409).json({ error: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof TokenError) return res.status(401).json({ error: err.message });
    // eslint-disable-next-line no-console
    console.error('[api] unhandled error:', err);
    return res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

function bearer(req: Request): string | null {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
