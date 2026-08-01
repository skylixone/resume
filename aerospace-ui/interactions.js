/**
 * interactions.js
 * Overlay interactivity: popover, hovercard, toast, cmd+k
 */

document.addEventListener('DOMContentLoaded', () => {

  // ── POPOVER ──────────────────────────────────────────
  // Any button with data-popover="id" toggles that popover
  document.querySelectorAll('[data-popover]').forEach(trigger => {
    const targetId = trigger.dataset.popover;
    const popover = document.getElementById(targetId);
    if (!popover) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains('popover-hidden');
      // Close all open popovers first
      document.querySelectorAll('.popover-content:not(.popover-hidden)').forEach(p => {
        p.classList.add('popover-hidden');
      });
      if (isHidden) {
        popover.classList.remove('popover-hidden');
      }
    });
  });

  // Click outside closes all popovers
  document.addEventListener('click', () => {
    document.querySelectorAll('.popover-content:not(.popover-hidden)').forEach(p => {
      p.classList.add('popover-hidden');
    });
  });

  // Prevent clicks inside popover from closing it
  document.querySelectorAll('.popover-content').forEach(p => {
    p.addEventListener('click', e => e.stopPropagation());
  });


  // ── HOVER CARD ───────────────────────────────────────
  let hovercardTimer = null;

  document.querySelectorAll('[data-hovercard-host]').forEach(host => {
    const card = host.querySelector('.hover-card-content');
    if (!card) return;

    host.addEventListener('mouseenter', () => {
      clearTimeout(hovercardTimer);
      card.classList.remove('hovercard-hidden');
    });

    host.addEventListener('mouseleave', () => {
      hovercardTimer = setTimeout(() => {
        card.classList.add('hovercard-hidden');
      }, 150);
    });
  });


  // ── TOAST ────────────────────────────────────────────
  const toastViewport = document.getElementById('live-toast-viewport');

  function showToast({ title, desc, action, variant = '' }) {
    if (!toastViewport) return;

    const toast = document.createElement('div');
    toast.className = `toast ${variant}`;
    toast.innerHTML = `
      <div class="toast-title">${title}</div>
      ${desc ? `<div class="toast-desc">${desc}</div>` : ''}
      ${action ? `<button class="toast-action btn btn-sm ${variant === 'destructive' ? 'btn-danger' : 'btn-secondary'}">${action}</button>` : ''}
      <div class="toast-close" role="button" aria-label="Close">✕</div>
    `;

    toastViewport.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.dataset.state = 'open';
      });
    });

    function dismiss() {
      toast.removeAttribute('data-state');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 400);
    }

    toast.querySelector('.toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
  }

  function showMiniToast({ text, updating = false }) {
    if (!toastViewport) return;

    const toast = document.createElement('div');
    toast.className = `mini-toast ${updating ? 'updating' : ''}`;
    toast.innerHTML = `
      <div class="mini-toast-icon">${updating ? '⟳' : '✓'}</div>
      <span>${text}</span>
    `;

    toastViewport.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
    });

    function dismiss() {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 500);
    }

    setTimeout(dismiss, 3000);
  }

  document.getElementById('toast-trigger-brief')?.addEventListener('click', () => {
    showToast({ title: 'Scheduled: Catch up', desc: 'Friday, February 10, 2023 at 5:57 PM', action: 'Undo' });
  });

  document.getElementById('toast-trigger-indepth')?.addEventListener('click', () => {
    showToast({ title: 'Profile Updated', desc: 'Your changes have been saved successfully and synced across all devices.', action: 'View' });
  });

  document.getElementById('toast-trigger-err')?.addEventListener('click', () => {
    showToast({ title: 'Upload Failed — ERR_UPLOAD_412', desc: 'Payload exceeds 25MB limit. Compress or split into multiple uploads.', action: 'Retry', variant: 'destructive' });
  });

  document.getElementById('toast-trigger-mini-ok')?.addEventListener('click', () => {
    showMiniToast({ text: 'Saved' });
  });

  document.getElementById('toast-trigger-mini-busy')?.addEventListener('click', () => {
    showMiniToast({ text: 'Saving...', updating: true });
  });


  // ── CMD+K ────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const cmdSection = document.getElementById('cmd');
      if (!cmdSection) return;

      cmdSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Focus the cmd-list so arrow keys work immediately
      const list = cmdSection.querySelector('.cmd-list');
      if (list) {
        list.focus({ preventScroll: true });
      }

      // Brief amber flash on the cmd-dialog (persistent outline via CSS :focus)
      const dialog = cmdSection.querySelector('.cmd-dialog');
      if (dialog) {
        dialog.style.transition = 'box-shadow 150ms ease';
        dialog.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => {
          dialog.style.boxShadow = '';
        }, 600);
      }
    }
  });


  // ── TABS ─────────────────────────────────────────────
  document.querySelectorAll('.tabs').forEach(tabContainer => {
    const panels = tabContainer.parentElement.querySelectorAll('.tab-panel');
    const tabs = tabContainer.querySelectorAll('.tab');
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        panels.forEach((panel, i) => {
          panel.classList.toggle('active', i === index);
        });
      });
    });
  });


  // ── SLIDER FILL ──────────────────────────────────────
  document.querySelectorAll('.slider').forEach(slider => {
    function updateFill() {
      const min = +slider.min || 0;
      const max = +slider.max || 100;
      const val = +slider.value;
      const pct = ((val - min) / (max - min)) * 100;
      slider.style.setProperty('--slider-fill', pct + '%');
    }
    slider.addEventListener('input', updateFill);
    updateFill();
  });


  // ── STAGGERED SECTION REVEALS ─────────────────────────
  const sections = document.querySelectorAll('.kit-section');

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05 });

  sections.forEach(section => {
    revealObserver.observe(section);
  });

  // ── STEPPER CONTROLS ─────────────────────────────────
  document.querySelectorAll('.stepper-control').forEach(control => {
    const minus = control.querySelector('.stepper-btn:first-child');
    const plus = control.querySelector('.stepper-btn:last-child');
    const val = control.querySelector('.stepper-val');
    if (!minus || !plus || !val) return;

    function update(delta) {
      const current = parseFloat(val.textContent) || 0;
      const step = current % 1 === 0 ? 1 : 0.1;
      const next = +(current + delta * step).toFixed(1);
      val.textContent = next;
      minus.disabled = next <= 0;
    }

    minus.addEventListener('click', () => update(-1));
    plus.addEventListener('click', () => update(+1));
  });

});
