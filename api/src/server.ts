import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MatchHub } from './matchHub.js';
import { PgGameRepository } from './pgRepository.js';
import { PresenceTracker } from './presence.js';
import { GameService } from './service.js';
import { attachWebsocketServer } from './ws.js';

const config = loadConfig();
const repo = PgGameRepository.fromUrl(config.databaseUrl);
const hub = new MatchHub();
const presence = new PresenceTracker();
const service = new GameService(repo, {
  bannedLobbyUsers: config.bannedLobbyUsers,
  hub,
  presence,
});

// The telemetry views are only as honest as the catalog behind them, and the
// migration leaves it empty on purpose. Boot is the second place it is filled —
// `npm run migrate` is the first — so a server started against a database someone
// else migrated still ends up with the roster this build ships.
void repo
  .syncHelperCatalog()
  .then((result) => {
    // eslint-disable-next-line no-console
    console.log(
      `[api] helper catalog: ${result.upserted} synced, ${result.removed} removed`,
    );
  })
  .catch((err) => {
    // A stale catalog mislabels telemetry; it does not stop anyone playing. So this
    // is logged loudly and not allowed to take the server down with it.
    // eslint-disable-next-line no-console
    console.error('[api] helper catalog sync failed:', err);
  });

const app = createApp(service, config);
const server = createServer(app);
const wss = attachWebsocketServer(server, { service, hub, config });

server.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[api] rock-paper-scissors listening on http://localhost:${config.port} ` +
      `(env=${config.appEnv}, lobbyAuth=${config.requireLobbyAuth}, ws=/api/v1/ws)`,
  );
});

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n[api] ${signal} received, shutting down...`);
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.close(() => {
    void repo.close().finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
