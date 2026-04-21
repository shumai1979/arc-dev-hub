// ─────────────────────────────────────────────────────────────────────
// ArcHub Circle Proxy — Cloudflare Worker
// ─────────────────────────────────────────────────────────────────────
// Why: @circle-fin/swap-kit hits api.circle.com with x-user-agent header,
// which is not in Circle's CORS preflight allow-headers, so browsers
// block it. This worker proxies requests server-side (no CORS preflight
// issue) and returns a permissive CORS response.
// Deploy: see README.md in this folder.
// ─────────────────────────────────────────────────────────────────────

const UPSTREAM = 'https://api.circle.com';
const ALLOW_ORIGIN = '*'; // tighten to your Pages URL in prod if desired

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Access-Control-Max-Age': '86400',
    ...extra
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const incoming = new URL(request.url);
    const target = UPSTREAM + incoming.pathname + incoming.search;
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.delete('host');
    const init = {
      method: request.method,
      headers: fwdHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow'
    };
    let upstream;
    try { upstream = await fetch(target, init); }
    catch (e) {
      return new Response(
        JSON.stringify({ error: 'upstream_fetch_failed', message: String(e) }),
        { status: 502, headers: corsHeaders({ 'content-type': 'application/json' }) }
      );
    }
    const outHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(corsHeaders())) outHeaders.set(k, v);
    return new Response(upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: outHeaders
    });
  }
};