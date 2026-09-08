/**
 * The app has two screens and no navigation between them, so a router would be
 * a dependency spent on one `if`. nginx serves index.html for every path
 * (`client/nginx.conf`), so this only has to say which screen the URL means.
 */
export type Route = { name: 'match' } | { name: 'replay'; id: string };

export function parseRoute(pathname: string = window.location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'replay') {
    try {
      const id = decodeURIComponent(parts[1]);
      if (id) return { name: 'replay', id };
    } catch {
      /* a malformed escape is not a replay link */
    }
  }
  return { name: 'match' };
}
