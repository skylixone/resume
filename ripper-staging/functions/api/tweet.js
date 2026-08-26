// Server-side fallback provider: X's guest syndication API.
//
// Why server-side: cdn.syndication.twimg.com locks CORS to
// platform.twitter.com, so the browser can never call it directly.
// We proxy it here and normalize to the same media_extended shape
// vxtwitter uses, so the frontend render code is unchanged.
//
// token=a: the endpoint currently accepts a dummy token for public
// tweets (no validation). If X ever starts validating, this function
// 404s and the frontend chain reports failure cleanly.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

// parse 1280x720 out of /vid/avc1/1280x720/... paths
const dimsFromPath = (url) => {
  const m = url.match(/\/vid\/avc1\/(\d+)x(\d+)\//);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
};

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get('id');
  if (!/^\d{1,25}$/.test(id || '')) return json({ error: 'bad id' }, 400);

  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a&lang=en`, {
    headers: { 'User-Agent': UA }
  });
  if (!res.ok) return json({ error: `syndication HTTP ${res.status}` }, 502);

  const data = await res.json();
  const out = [];

  for (const md of data.mediaDetails || []) {
    if (md.type === 'photo') {
      const sz = md.sizes?.large || md.sizes?.orig || md.sizes?.small;
      out.push({
        type: 'image',
        url: md.media_url_https,
        size: sz ? { width: sz.w, height: sz.h } : null,
        duration_millis: null
      });
    } else if (md.type === 'video' || md.type === 'animated_gif') {
      const mp4s = (md.video_info?.variants || [])
        .filter((v) => v.content_type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const best = mp4s[0];
      if (!best) continue;
      out.push({
        type: md.type === 'animated_gif' ? 'gif' : 'video',
        url: best.url,
        size: dimsFromPath(best.url),
        duration_millis: null
      });
    }
  }

  if (!out.length) return json({ error: 'no media' }, 404);
  return json({ media_extended: out });
}
