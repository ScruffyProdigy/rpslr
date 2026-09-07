import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { GAME_NAME, GAME_VERSION, type AppConfig } from './config.js';
import { buildGameModesPayload } from './gameModes.js';
import { buildLaunchUrlsForAssignment } from './launchUrls.js';
import {
  ConflictError,
  NotFoundError,
  ReservationError,
} from './repository.js';
import { reportMatchResult } from './lobbyClient.js';
import { parseLobbyProvision, verifyLobbyProvisionAuth } from './provision.js';
import { BannedPlayerError, ValidationError, type GameService } from './service.js';
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
  app.get('/api/v1/game-modes', (_req, res) => {
    res.json(buildGameModesPayload(GAME_NAME));
  });

  const api = express.Router();

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
      const result = await service.createStandaloneMatch({
        gameMode: body.gameMode,
        name: body.name,
        bestOf: body.bestOf,
        hostName: body.hostName,
        hostLobbyUserId: body.lobbyUserId,
      });
      return res.status(201).json(result);
    }),
  );

  api.get(
    '/matches/:ref',
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await service.getState(req.params.ref));
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
        return res.status(201).json(result);
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
      return res.status(201).json(result);
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

  app.use('/api/v1', api);

  // --- Error handling --------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof BannedPlayerError) {
      return res.status(403).json({ error: err.message, bannedLobbyUserIds: err.bannedLobbyUserIds });
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
