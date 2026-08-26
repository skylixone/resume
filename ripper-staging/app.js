/* Twitter Ripper — app logic (staging build: vxtwitter → fxtwitter → syndication) */

const ui = {
  input: document.getElementById('target-url'),
  btn: document.getElementById('trigger-btn'),
  results: document.getElementById('results')
};

async function fetchFileSize(url) {
  try {
    const res = await fetch('dl?url=' + encodeURIComponent(url), { method: 'HEAD' });
    const len = Number(res.headers.get('content-length'));
    if (!res.ok || !len) return 'N/A';
    if (len >= 1048576) return (len / 1048576).toFixed(1) + 'MB';
    if (len >= 1024) return (len / 1024).toFixed(0) + 'KB';
    return len + 'B';
  } catch (err) {
    return 'N/A';
  }
}

function formatOf(type, url) {
  if (type === 'VIDEO') return 'MP4';
  if (type === 'GIF') return 'GIF';
  const m = url.match(/\.(jpe?g|png|webp|gif|avif)(\?|$)/i);
  return m ? m[1].toUpperCase() : type;
}

const PROVIDERS = [
  { name: 'VXTWITTER', fn: tryVxtwitter },
  { name: 'FXTWITTER', fn: tryFxtwitter },
  { name: 'SYNDICATION', fn: trySyndication }
];

async function tryVxtwitter(tweetId) {
  const res = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`);
  if (!res.ok) return null;
  const data = await res.json();
  const list = data.media_extended || [];
  return list.length ? list : null;
}

async function tryFxtwitter(tweetId) {
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`);
  if (!res.ok) return null;
  const data = await res.json();
  const media = data?.tweet?.media;
  if (!media) return null;
  const out = [];
  for (const v of media.videos || []) {
    out.push({
      type: (v.gif || v.type === 'animated_gif') ? 'gif' : 'video',
      url: v.url,
      size: v.width && v.height ? { width: v.width, height: v.height } : null,
      duration_millis: v.duration ? Math.round(v.duration * 1000) : null
    });
  }
  for (const p of media.photos || []) {
    out.push({
      type: 'image',
      url: p.url,
      size: p.width && p.height ? { width: p.width, height: p.height } : null,
      duration_millis: null
    });
  }
  return out.length ? out : null;
}

async function trySyndication(tweetId) {
  const res = await fetch(`api/tweet?id=${encodeURIComponent(tweetId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const list = data.media_extended || [];
  return list.length ? list : null;
}

async function extractMedia(tweetId) {
  for (const p of PROVIDERS) {
    ui.results.innerHTML = `<p class="status-line">QUERYING ${p.name}...</p>`;
    try {
      const list = await p.fn(tweetId);
      if (list) return { provider: p.name, mediaList: list };
    } catch (err) { /* fall through to next provider */ }
  }
  return { provider: null, mediaList: null };
}

async function executeExtraction() {
  const url = ui.input.value.trim() || ui.input.placeholder; // empty input → placeholder default
  if (!url) return;

  ui.btn.textContent = 'WORKING...';
  ui.btn.disabled = true;
  ui.results.innerHTML = '<p class="status-line">QUERYING EXTERNAL ENDPOINT...</p>';

  try {
    const match = url.match(/(?:twitter\.com|x\.com)\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/);
    if (!match) throw new Error("Malformed URL. Ensure standard status format.");

    const tweetId = match[3];
    const { provider, mediaList } = await extractMedia(tweetId);
    if (!mediaList) throw new Error("All providers failed — tweet deleted or suspended.");

    ui.results.innerHTML = `<p class="status-line">SOURCE: ${provider}</p>`;

    for (const [i, media] of mediaList.entries()) {
      const type = media.type.toUpperCase();
      const duration = media.duration_millis ? (media.duration_millis / 1000).toFixed(1) + 's' : 'N/A';
      const dims = media.size ? `${media.size.width}x${media.size.height}` : 'N/A';
      const size = await fetchFileSize(media.url);
      const fmt = formatOf(type, media.url);
      const dlUrl = 'dl?url=' + encodeURIComponent(media.url) +
        '&name=' + encodeURIComponent(`tweet-${tweetId}-${i}.mp4`);

      ui.results.insertAdjacentHTML('beforeend', `
        <a class="btn btn-dl" href="${dlUrl}" rel="noopener">
          <span>DOWNLOAD MEDIA</span>
          <span class="dl-meta">${duration} · ${dims} · ${size} · ${fmt}</span>
        </a>`);
    }

  } catch (err) {
    ui.results.innerHTML = `<p class="status-err">FAILURE — ${err.message}</p>`;
  } finally {
    ui.btn.textContent = 'EXECUTE';
    ui.btn.disabled = false;
  }
}

ui.btn.addEventListener('click', executeExtraction);
ui.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') executeExtraction();
});
