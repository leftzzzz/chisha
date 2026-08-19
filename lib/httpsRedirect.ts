const LOCAL_HTTP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
]);

/**
 * Public HTTP requests cannot carry the production Secure owner cookie. Upgrade
 * them before any application or session code runs; 308 preserves POST bodies.
 */
export function redirectPublicHttpToHttps(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== 'http:' || isLocalHttpHost(url.hostname)) {
    return null;
  }

  url.protocol = 'https:';
  return Response.redirect(url.toString(), 308);
}

function isLocalHttpHost(hostname: string): boolean {
  return LOCAL_HTTP_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}
