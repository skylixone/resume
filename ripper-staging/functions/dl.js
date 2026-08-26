// Server-side proxy for *.twimg.com media.
//
// Why: video.twimg.com hotlink-protects against non-twitter Referers.
// A browser tab navigating to a twimg mp4 sends Referer: ripper.3mdash.net
// and gets 403 "Unauthorized." A plain server fetch (no Referer) gets 200.
// So we fetch upstream here and stream the bytes back as an attachment
// download. Same path also serves HEAD (used by the page for file sizes).
//
// Never an open proxy: only https://*.twimg.com targets are allowed.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function onRequest(context) {
  const { request } = context;
  const q = new URL(request.url).searchParams;
  const target = q.get('url') || '';

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (parsed.protocol !== 'https:' || !/(^|\.)twimg\.com$/.test(parsed.hostname)) {
    return new Response('forbidden', { status: 403 });
  }

  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const upstream = await fetch(parsed.toString(), {
    method,
    headers: { 'User-Agent': UA }
    // deliberately no Referer / Origin / Sec-Fetch headers
  });

  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('Content-Type', ct);
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (!upstream.ok) {
    return new Response(upstream.statusText, { status: upstream.status, headers });
  }

  if (method === 'GET') {
    const name = (q.get('name') || 'ripper-media.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
    headers.set('Content-Disposition', `attachment; filename="${name}"`);
    return new Response(upstream.body, { status: 200, headers });
  }

  return new Response(null, { status: 200, headers });
}
