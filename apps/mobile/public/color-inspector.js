/**
 * ProMixt — inspector culori & poziție la click.
 *
 * La click pe orice element arată:
 *  - culori (background, text, border) + swatch
 *  - poziție pe pagină (x, y, width, height, viewport)
 *  - selector CSS aproximativ + tag/clase
 *
 * Activare:
 *  - URL:  ?color-inspect=1
 *  - tastă: Alt+Shift+C
 *  - consolă: PromixtColorInspector.enable()
 *  - localStorage: promixt-color-inspect=1
 */
(function promixtColorInspector(global) {
  const STORAGE_KEY = 'promixt-color-inspect';
  const PANEL_ID = 'promixt-color-inspect-panel';
  const CROSS_ID = 'promixt-color-inspect-crosshair';
  const STYLE_ID = 'promixt-color-inspect-style';

  let enabled = false;
  let panel = null;
  let cross = null;
  let lastEl = null;
  let history = [];

  function qsEnabled() {
    try {
      return new URLSearchParams(global.location.search).get('color-inspect') === '1';
    } catch (_) {
      return false;
    }
  }

  function storageEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setStorage(on) {
    try {
      if (on) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID} {
  position: fixed;
  z-index: 2147483000;
  right: 12px;
  bottom: 12px;
  width: min(360px, calc(100vw - 24px));
  max-height: min(70vh, 520px);
  display: flex;
  flex-direction: column;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0,0,0,.45);
  padding: 0;
  backdrop-filter: blur(8px);
}
#${PANEL_ID} .pci-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #334155;
  background: rgba(15, 23, 42, 0.98);
  z-index: 1;
  cursor: move;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
#${PANEL_ID} .pci-head button { cursor: pointer; }
#${PANEL_ID}.pci-gesture,
#${PANEL_ID}.pci-gesture * { user-select: none !important; }
#${PANEL_ID} .pci-resize {
  position: absolute;
  width: 16px;
  height: 16px;
  z-index: 3;
  touch-action: none;
}
#${PANEL_ID} .pci-resize-nw { left: 0; top: 0; cursor: nwse-resize; }
#${PANEL_ID} .pci-resize-ne { right: 0; top: 0; cursor: nesw-resize; }
#${PANEL_ID} .pci-resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }
#${PANEL_ID} .pci-resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
#${PANEL_ID} .pci-resize-se::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid #64748b;
  border-bottom: 2px solid #64748b;
  border-bottom-right-radius: 6px;
  pointer-events: none;
}
#${PANEL_ID} .pci-title {
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  font-size: 11px;
  color: #f97316;
}
#${PANEL_ID} .pci-actions {
  display: flex;
  gap: 6px;
}
#${PANEL_ID} button {
  appearance: none;
  border: 1px solid #475569;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
#${PANEL_ID} button:hover { border-color: #f97316; color: #fdba74; }
#${PANEL_ID} .pci-body {
  padding: 10px 12px 12px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
#${PANEL_ID} .pci-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 6px 10px;
  margin: 0 0 8px;
  align-items: start;
}
#${PANEL_ID} .pci-k { color: #94a3b8; }
#${PANEL_ID} .pci-v {
  color: #f8fafc;
  word-break: break-word;
  user-select: text;
}
#${PANEL_ID} .pci-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 10px;
}
#${PANEL_ID} .pci-swatch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 96px;
  padding: 6px;
  border-radius: 8px;
  background: #0f172a;
  border: 1px solid #334155;
}
#${PANEL_ID} .pci-chip {
  width: 100%;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.2);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.15);
}
#${PANEL_ID} .pci-chip-label {
  font-size: 10px;
  color: #cbd5e1;
}
#${PANEL_ID} .pci-chip-val {
  font-size: 10px;
  color: #f8fafc;
}
#${PANEL_ID} .pci-hint {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #334155;
  color: #94a3b8;
  font-size: 10px;
}
#${PANEL_ID} .pci-history {
  margin-top: 8px;
  max-height: 100px;
  overflow: auto;
}
#${PANEL_ID} .pci-history button {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${CROSS_ID} {
  position: fixed;
  pointer-events: none;
  z-index: 2147482999;
  border: 2px solid #f97316;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 0 0 9999px rgba(15,23,42,.18);
  display: none;
}
body.promixt-color-inspecting,
body.promixt-color-inspecting * {
  cursor: crosshair !important;
}
`;
    document.head.appendChild(style);
  }

  function rgbToHex(color) {
    if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
    const m = String(color).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) {
      if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.trim())) return color.trim().toUpperCase();
      return color;
    }
    const r = Math.round(Number(m[1]));
    const g = Math.round(Number(m[2]));
    const b = Math.round(Number(m[3]));
    const a = m[4] !== undefined ? Number(m[4]) : 1;
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    if (a < 1) return `${hex} @ ${Math.round(a * 100)}%`;
    return hex;
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList?.length) {
        const cls = [...node.classList]
          .filter((c) => c && !c.startsWith('promixt-color'))
          .slice(0, 3)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        part += cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function pickColors(el) {
    const cs = getComputedStyle(el);
    const bgImage = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage : '';
    return {
      background: {
        label: 'Background',
        rgb: cs.backgroundColor,
        hex: rgbToHex(cs.backgroundColor),
        extra: bgImage ? bgImage.slice(0, 120) : '',
      },
      color: {
        label: 'Text',
        rgb: cs.color,
        hex: rgbToHex(cs.color),
      },
      border: {
        label: 'Border',
        rgb: cs.borderTopColor,
        hex: rgbToHex(cs.borderTopColor),
        extra: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
      },
      outline: {
        label: 'Outline',
        rgb: cs.outlineColor,
        hex: rgbToHex(cs.outlineColor),
        extra: cs.outlineStyle !== 'none' ? `${cs.outlineWidth} ${cs.outlineStyle}` : '',
      },
      fill: {
        label: 'SVG fill',
        rgb: cs.fill,
        hex: rgbToHex(cs.fill),
      },
      stroke: {
        label: 'SVG stroke',
        rgb: cs.stroke,
        hex: rgbToHex(cs.stroke),
      },
      shadow: {
        label: 'Box-shadow',
        rgb: '',
        hex: null,
        extra: cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 140) : '',
      },
    };
  }

  function pickPosition(el) {
    const r = el.getBoundingClientRect();
    const sx = global.scrollX || document.documentElement.scrollLeft || 0;
    const sy = global.scrollY || document.documentElement.scrollTop || 0;
    return {
      viewport: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      page: {
        x: Math.round(r.left + sx),
        y: Math.round(r.top + sy),
        width: Math.round(r.width),
        height: Math.round(r.height),
        right: Math.round(r.right + sx),
        bottom: Math.round(r.bottom + sy),
      },
      center: {
        x: Math.round(r.left + r.width / 2 + sx),
        y: Math.round(r.top + r.height / 2 + sy),
      },
    };
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="pci-head">
        <span class="pci-title">Color inspect</span>
        <div class="pci-actions">
          <button type="button" data-pci="copy">Copiază</button>
          <button type="button" data-pci="close">Închide</button>
        </div>
      </div>
      <div class="pci-body" data-pci-body>
        <div class="pci-hint">Click pe orice element. Alt+Shift+C = on/off.</div>
      </div>
      <span class="pci-resize pci-resize-nw" data-pci-resize="nw" title="Redimensionează"></span>
      <span class="pci-resize pci-resize-ne" data-pci-resize="ne" title="Redimensionează"></span>
      <span class="pci-resize pci-resize-sw" data-pci-resize="sw" title="Redimensionează"></span>
      <span class="pci-resize pci-resize-se" data-pci-resize="se" title="Redimensionează"></span>
    `;
    document.body.appendChild(panel);
    wirePanelGestures(panel);
    panel.querySelector('[data-pci="close"]').addEventListener('click', (e) => {
      e.stopPropagation();
      disable();
    });
    panel.querySelector('[data-pci="copy"]').addEventListener('click', (e) => {
      e.stopPropagation();
      const text = panel.dataset.lastJson || '';
      if (text && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          e.target.textContent = 'Copiat!';
          setTimeout(() => { e.target.textContent = 'Copiază'; }, 1200);
        }).catch(() => {});
      }
    });
    // nu închide la click pe panou
    panel.addEventListener('click', (e) => e.stopPropagation());
    return panel;
  }

  const PANEL_MIN_W = 260;
  const PANEL_MIN_H = 160;

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // Trece panoul de pe right/bottom pe left/top + dimensiuni explicite (necesar la mutare/redimensionare).
  function pinPanelBox() {
    const r = panel.getBoundingClientRect();
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.round(r.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${Math.round(r.width)}px`;
    panel.style.height = `${Math.round(r.height)}px`;
    panel.style.maxHeight = 'none';
    return r;
  }

  // mode: 'move' (trage de antet) sau 'resize' din corner: 'nw' | 'ne' | 'sw' | 'se'
  function startPanelGesture(e, mode, corner, handle) {
    if (!panel || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const startRect = pinPanelBox();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = {
      left: startRect.left,
      top: startRect.top,
      width: startRect.width,
      height: startRect.height,
    };
    const vw = global.innerWidth || document.documentElement.clientWidth;
    const vh = global.innerHeight || document.documentElement.clientHeight;
    panel.classList.add('pci-gesture');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}

    function onPointerMove(ev) {
      if (!panel) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === 'move') {
        // rămân vizibile măcar 80px din lățime și bara de titlu
        panel.style.left = `${Math.round(clamp(start.left + dx, -start.width + 80, vw - 80))}px`;
        panel.style.top = `${Math.round(clamp(start.top + dy, 0, vh - 40))}px`;
        return;
      }
      let { left, top, width, height } = start;
      if (corner.includes('e')) width = start.width + dx;
      if (corner.includes('s')) height = start.height + dy;
      if (corner.includes('w')) { width = start.width - dx; left = start.left + dx; }
      if (corner.includes('n')) { height = start.height - dy; top = start.top + dy; }
      if (width < PANEL_MIN_W) {
        if (corner.includes('w')) left -= PANEL_MIN_W - width;
        width = PANEL_MIN_W;
      }
      if (height < PANEL_MIN_H) {
        if (corner.includes('n')) top -= PANEL_MIN_H - height;
        height = PANEL_MIN_H;
      }
      if (left < 0) { if (corner.includes('w')) width += left; left = 0; }
      if (top < 0) { if (corner.includes('n')) height += top; top = 0; }
      width = Math.min(width, vw - left);
      height = Math.min(height, vh - top);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.width = `${Math.round(width)}px`;
      panel.style.height = `${Math.round(height)}px`;
    }

    function onPointerUp(ev) {
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
      if (panel) panel.classList.remove('pci-gesture');
      try { handle.releasePointerCapture(ev.pointerId); } catch (_) {}
    }

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  }

  function wirePanelGestures(p) {
    const head = p.querySelector('.pci-head');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('button')) return;
      startPanelGesture(e, 'move', '', head);
    });
    p.querySelectorAll('[data-pci-resize]').forEach((handle) => {
      const corner = handle.getAttribute('data-pci-resize');
      handle.addEventListener('pointerdown', (e) => startPanelGesture(e, 'resize', corner, handle));
    });
  }

  function ensureCross() {
    if (cross) return cross;
    cross = document.createElement('div');
    cross.id = CROSS_ID;
    document.body.appendChild(cross);
    return cross;
  }

  function highlight(el) {
    const box = ensureCross();
    if (!el) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${Math.max(0, r.left - 2)}px`;
    box.style.top = `${Math.max(0, r.top - 2)}px`;
    box.style.width = `${Math.max(0, r.width + 4)}px`;
    box.style.height = `${Math.max(0, r.height + 4)}px`;
  }

  function swatchHtml(item) {
    if (!item.hex && !item.extra) return '';
    const chip = item.hex
      ? `<div class="pci-chip" style="background:${item.rgb || item.hex}"></div>`
      : '';
    return `
      <div class="pci-swatch">
        ${chip}
        <span class="pci-chip-label">${escapeHtml(item.label)}</span>
        <span class="pci-chip-val">${escapeHtml(item.hex || item.extra || '—')}</span>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(info) {
    ensurePanel();
    const body = panel.querySelector('[data-pci-body]');
    const colors = info.colors;
    const pos = info.position;
    const swatches = ['background', 'color', 'border', 'fill', 'stroke']
      .map((k) => colors[k])
      .filter((c) => c && (c.hex || c.extra))
      .map(swatchHtml)
      .join('');

    body.innerHTML = `
      <div class="pci-swatch-row">${swatches || '<span class="pci-k">Fără culori solide detectate</span>'}</div>
      <div class="pci-row"><span class="pci-k">Element</span><span class="pci-v">${escapeHtml(info.tag)}${info.id ? '#' + escapeHtml(info.id) : ''}</span></div>
      <div class="pci-row"><span class="pci-k">Clase</span><span class="pci-v">${escapeHtml(info.classes || '—')}</span></div>
      <div class="pci-row"><span class="pci-k">Selector</span><span class="pci-v">${escapeHtml(info.selector)}</span></div>
      <div class="pci-row"><span class="pci-k">Text</span><span class="pci-v">${escapeHtml(info.text || '—')}</span></div>
      <div class="pci-row"><span class="pci-k">BG</span><span class="pci-v">${escapeHtml(colors.background.hex || colors.background.rgb || '—')}${colors.background.extra ? '<br><small>' + escapeHtml(colors.background.extra) + '</small>' : ''}</span></div>
      <div class="pci-row"><span class="pci-k">Text color</span><span class="pci-v">${escapeHtml(colors.color.hex || colors.color.rgb || '—')}</span></div>
      <div class="pci-row"><span class="pci-k">Border</span><span class="pci-v">${escapeHtml((colors.border.hex || colors.border.rgb || '—') + (colors.border.extra ? ' · ' + colors.border.extra : ''))}</span></div>
      <div class="pci-row"><span class="pci-k">Viewport</span><span class="pci-v">x=${pos.viewport.x} y=${pos.viewport.y} · ${pos.viewport.width}×${pos.viewport.height}px</span></div>
      <div class="pci-row"><span class="pci-k">Pagină</span><span class="pci-v">x=${pos.page.x} y=${pos.page.y} · right=${pos.page.right} bottom=${pos.page.bottom}</span></div>
      <div class="pci-row"><span class="pci-k">Centru</span><span class="pci-v">x=${pos.center.x} y=${pos.center.y}</span></div>
      <div class="pci-row"><span class="pci-k">Click</span><span class="pci-v">client(${info.click.clientX}, ${info.click.clientY}) · page(${info.click.pageX}, ${info.click.pageY})</span></div>
      ${colors.shadow.extra ? `<div class="pci-row"><span class="pci-k">Shadow</span><span class="pci-v">${escapeHtml(colors.shadow.extra)}</span></div>` : ''}
      <div class="pci-hint">Istoric (ultimele click-uri)</div>
      <div class="pci-history">${history.slice(0, 8).map((h, i) =>
        `<button type="button" data-hist="${i}">${escapeHtml(h.summary)}</button>`
      ).join('') || '—'}</div>
      <div class="pci-hint">Trage de titlu = mută panoul · trage de colțuri = redimensionează · Alt+Shift+C dezactivează · Copiază = JSON complet</div>
    `;

    body.querySelectorAll('[data-hist]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-hist'));
        const item = history[idx];
        if (item?.payload) {
          panel.dataset.lastJson = JSON.stringify(item.payload, null, 2);
          render(item.payload);
          if (item.el?.isConnected) highlight(item.el);
        }
      });
    });
  }

  function inspect(el, event) {
    if (!el || el === panel || panel?.contains(el) || el.id === CROSS_ID) return;
    // urcă la element util (evită text nodes)
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el || el === document.documentElement || el === document.body) {
      // permite body
    }
    lastEl = el;
    highlight(el);
    const colors = pickColors(el);
    const position = pickPosition(el);
    const info = {
      tag: el.tagName?.toLowerCase() || '?',
      id: el.id || '',
      classes: el.className && typeof el.className === 'string' ? el.className.trim() : '',
      selector: cssPath(el),
      text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      colors,
      position,
      click: {
        clientX: event?.clientX ?? 0,
        clientY: event?.clientY ?? 0,
        pageX: event?.pageX ?? 0,
        pageY: event?.pageY ?? 0,
      },
      theme: {
        bodyClasses: document.body.className,
        shopTheme: document.body.getAttribute('data-shop-theme') || '',
        shopDark: document.body.classList.contains('shop-dark'),
      },
    };
    const summary = `${info.tag}${info.id ? '#' + info.id : ''} · ${colors.background.hex || colors.color.hex || '—'} · (${position.page.x},${position.page.y})`;
    history.unshift({ summary, payload: info, el });
    if (history.length > 20) history.length = 20;
    panel.dataset.lastJson = JSON.stringify(info, null, 2);
    render(info);
    // console helper
    try {
      console.log('%c[ProMixt Color Inspect]', 'color:#f97316;font-weight:bold', info);
    } catch (_) {}
  }

  function onClick(e) {
    if (!enabled) return;
    if (panel && panel.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    inspect(e.target, e);
  }

  function onMove(e) {
    if (!enabled) return;
    if (panel && panel.contains(e.target)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== lastEl && el !== panel && !panel?.contains(el) && el.id !== CROSS_ID) {
      highlight(el);
    }
  }

  function onKey(e) {
    if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      toggle();
    }
    if (enabled && e.key === 'Escape') {
      e.preventDefault();
      disable();
    }
  }

  function enable() {
    if (enabled) return;
    ensureStyles();
    ensurePanel();
    ensureCross();
    enabled = true;
    setStorage(true);
    document.body.classList.add('promixt-color-inspecting');
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove, true);
    render({
      tag: 'ready',
      id: '',
      classes: '',
      selector: '—',
      text: 'Click pe un element din pagină',
      colors: {
        background: { label: 'Background', hex: null, rgb: '' },
        color: { label: 'Text', hex: null, rgb: '' },
        border: { label: 'Border', hex: null, rgb: '', extra: '' },
        outline: { label: 'Outline', hex: null, rgb: '', extra: '' },
        fill: { label: 'SVG fill', hex: null, rgb: '' },
        stroke: { label: 'SVG stroke', hex: null, rgb: '' },
        shadow: { label: 'Box-shadow', hex: null, rgb: '', extra: '' },
      },
      position: {
        viewport: { x: 0, y: 0, width: 0, height: 0 },
        page: { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 },
        center: { x: 0, y: 0 },
      },
      click: { clientX: 0, clientY: 0, pageX: 0, pageY: 0 },
      theme: {},
    });
    console.info('[ProMixt Color Inspect] ACTIV — click pe element. Alt+Shift+C sau Escape pentru oprire.');
  }

  function disable() {
    if (!enabled && !panel) return;
    enabled = false;
    setStorage(false);
    document.body.classList.remove('promixt-color-inspecting');
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousemove', onMove, true);
    if (cross) cross.style.display = 'none';
    if (panel) {
      panel.remove();
      panel = null;
    }
    lastEl = null;
    console.info('[ProMixt Color Inspect] OPRIT');
  }

  function toggle() {
    if (enabled) disable();
    else enable();
  }

  function init() {
    document.addEventListener('keydown', onKey, true);
    if (qsEnabled() || storageEnabled()) {
      // delay scurt ca să existe body
      if (document.body) enable();
      else document.addEventListener('DOMContentLoaded', enable, { once: true });
    }
  }

  global.PromixtColorInspector = {
    enable,
    disable,
    toggle,
    isEnabled: () => enabled,
    inspectElement(el) {
      enable();
      inspect(el, { clientX: 0, clientY: 0, pageX: 0, pageY: 0 });
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
