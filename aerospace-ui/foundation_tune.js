/* Foundation Tuner
   Provides real-time adjustment of CSS variables and export functionality.
*/

(function() {
    // Inject the tuner UI
    const tunerHTML = `
    <div id="foundation-tuner" style="
        position: fixed;
        top: 20px;
        right: 20px;
        transform: translateZ(0);
        will-change: transform;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        padding: 16px;
        width: 300px;
        z-index: 9999;
        font-family: var(--font-mono);
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        display: none;
    ">
        <div style="display: flex; justify-content: space-between; margin-bottom: 16px;">
            <div class="type-overline bright">Foundation Tuner</div>
            <button id="tuner-close" style="background:none; border:none; color:var(--text-dim); cursor:pointer;">✕</button>
        </div>

        <div class="input-group" style="margin-bottom: 12px;">
            <label class="input-label">ACCENT COLOR</label>
            <input type="color" id="tune-accent" class="input" style="height: 40px; padding: 0;">
        </div>
        
        <div class="input-group" style="margin-bottom: 12px;">
            <label class="input-label">BACKGROUND</label>
            <input type="color" id="tune-bg" class="input" style="height: 40px; padding: 0;">
        </div>

        <div class="input-group" style="margin-bottom: 24px;">
            <label class="input-label">BORDER RADIUS (px)</label>
            <input type="range" id="tune-radius" min="0" max="12" step="1" style="width: 100%">
        </div>

        <div style="display: flex; gap: 8px;">
            <button id="tuner-export" class="btn btn-primary btn-sm" style="flex:1">Export CSS</button>
            <button id="tuner-reset" class="btn btn-ghost btn-sm">Reset</button>
        </div>
    </div>
    
    <button id="tuner-toggle" style="
        position: fixed;
        top: 20px;
        right: 20px;
        transform: translateZ(0);
        will-change: transform;
        background: var(--bg-surface);
        border: 1px solid var(--border-dim);
        color: var(--text-dim);
        padding: 8px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        text-transform: uppercase;
        cursor: pointer;
        z-index: 9998;
    ">Tune Kit</button>
    `;

    const container = document.createElement('div');
    container.innerHTML = tunerHTML;
    document.body.appendChild(container);

    // Logic
    const root = document.documentElement;
    const style = getComputedStyle(root);
    
    const elements = {
        tuner: document.getElementById('foundation-tuner'),
        toggle: document.getElementById('tuner-toggle'),
        close: document.getElementById('tuner-close'),
        accent: document.getElementById('tune-accent'),
        bg: document.getElementById('tune-bg'),
        radius: document.getElementById('tune-radius'),
        exportBtn: document.getElementById('tuner-export'),
        resetBtn: document.getElementById('tuner-reset')
    };

    // Init values
    elements.accent.value = style.getPropertyValue('--accent').trim();
    elements.bg.value = style.getPropertyValue('--bg').trim();
    elements.radius.value = parseInt(style.getPropertyValue('--radius-sm')) || 0;

    // Toggle
    elements.toggle.onclick = () => {
        elements.tuner.style.display = 'block';
        elements.toggle.style.display = 'none';
        // Hide review overlay if present to avoid overlap? 
        // Note: Review overlay is usually bottom right too.
    };

    elements.close.onclick = () => {
        elements.tuner.style.display = 'none';
        elements.toggle.style.display = 'block';
    };

    // Listeners
    elements.accent.oninput = (e) => {
        root.style.setProperty('--accent', e.target.value);
        // Also update derived
        const hex = e.target.value;
        root.style.setProperty('--accent-dim', hex + '55');
        root.style.setProperty('--accent-bg', hex + '11');
    };

    elements.bg.oninput = (e) => {
        root.style.setProperty('--bg', e.target.value);
    };

    elements.radius.oninput = (e) => {
        root.style.setProperty('--radius-sm', e.target.value + 'px');
    };
    
    // Reset
    elements.resetBtn.onclick = () => {
        root.removeAttribute('style');
        elements.accent.value = style.getPropertyValue('--accent').trim();
        elements.bg.value = style.getPropertyValue('--bg').trim();
        elements.radius.value = parseInt(style.getPropertyValue('--radius-sm')) || 0;
    };

    // Export
    elements.exportBtn.onclick = () => {
        const textToExport = `
:root {
  --accent: ${elements.accent.value};
  --accent-dim: ${elements.accent.value}55;
  --accent-bg: ${elements.accent.value}11;
  --bg: ${elements.bg.value};
  --radius-sm: ${elements.radius.value}px;
}
        `;
        navigator.clipboard.writeText(textToExport).then(() => {
            elements.exportBtn.textContent = 'Copied!';
            setTimeout(() => elements.exportBtn.textContent = 'Export CSS', 2000);
        });
    };

})();
