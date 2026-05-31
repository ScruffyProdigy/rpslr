import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MatchHub } from './matchHub.js';
import { PgGameRepository } from './pgRepository.js';
import { GameService } from './service.js';
import { attachWebsocketServer } from './ws.js';

const config = loadConfig();
const repo = PgGameRepository.fromUrl(config.databaseUrl);
const hub = new MatchHub();
const service = new GameService(repo, { bannedLobbyUsers: config.bannedLobbyUsers, hub });

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
