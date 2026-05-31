// Local dev defaults for window.env. In production this file is OVERWRITTEN by
// the nginx docker-entrypoint script from container env vars (see Dockerfile).
// Mirrors the Lobby frontend's runtime-config pattern.
window.env = {
  GAME_APP_ENV: "local",
  GAME_API_BASE_URL: "http://localhost:3001",
  // WebSocket URL is derived from GAME_API_BASE_URL when blank (http->ws).
  GAME_WS_BASE_URL: "",
};
