/* Twitter Ripper — app logic (ripper.3mdash.net) */

const ui = {
  input: document.getElementById('target-url'),
  btn: document.getElementById('trigger-btn'),
  results: document.getElementById('results')
};

async function fetchFileSize(url) {
  try {
    const res = await fetch('/dl?url=' + encodeURIComponent(url), { method: 'HEAD' });
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
    const res = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`);

    if (!res.ok) throw new Error(`Network failure. HTTP ${res.status}`);

    const data = await res.json();

    if (!data.media_extended || data.media_extended.length === 0) {
      throw new Error("No media payload detected in target.");
    }

    ui.results.innerHTML = '';

    for (const [i, media] of data.media_extended.entries()) {
      const type = media.type.toUpperCase();
      const duration = media.duration_millis ? (media.duration_millis / 1000).toFixed(1) + 's' : 'N/A';
      const dims = media.size ? `${media.size.width}x${media.size.height}` : 'N/A';
      const size = await fetchFileSize(media.url);
      const fmt = formatOf(type, media.url);
      const dlUrl = '/dl?url=' + encodeURIComponent(media.url) +
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
