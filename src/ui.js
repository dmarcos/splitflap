import { CHARS, COLOR_TILES } from './atlas.js';
import { layout } from './layout.js';

const $ = (s) => document.querySelector(s);

// api: { state, dims(), save(), onShow(i), onEdit(i), onReorder(a, b), onDelete(i),
//        onAdd(), onNext(), onFullscreen(), onSetting(key) }
export function initUI(api) {
  const { state } = api;
  const panel = $('#panel');
  const list = $('#messages');
  let activeIndex = -1;

  function drawPreview(el, text) {
    const [rows, cols] = api.dims();
    const grid = layout(text, rows, cols, state.align);
    el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    if (el.childElementCount !== rows * cols) {
      el.replaceChildren(...Array.from({ length: rows * cols }, () => document.createElement('span')));
    }
    const cells = el.children;
    grid.flat().forEach((idx, k) => {
      const ch = CHARS[idx];
      const span = cells[k];
      if (ch.length === 3) {
        span.textContent = '';
        span.style.background = COLOR_TILES[ch[1]];
      } else {
        span.textContent = ch;
        span.style.background = '';
      }
    });
  }

  function card(m, i) {
    const el = document.createElement('div');
    el.className = 'msg' + (i === activeIndex ? ' active' : '');
    el.innerHTML = `
      <div class="msg-head"><span class="msg-num">${i + 1}</span><div class="preview"></div></div>
      <textarea rows="3" spellcheck="false" autocapitalize="characters" autocomplete="off" placeholder="Type a message…"></textarea>
      <div class="msg-actions">
        <label class="dur"><input type="number" min="1" step="1" inputmode="numeric"><span>sec</span></label>
        <div class="spacer"></div>
        <button data-act="show" title="Show now">Show</button>
        <button data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" title="Move down" ${i === state.messages.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" class="danger" title="Delete">✕</button>
      </div>`;

    const ta = el.querySelector('textarea');
    const dur = el.querySelector('input');
    const preview = el.querySelector('.preview');
    ta.value = m.text;
    dur.value = m.duration;
    drawPreview(preview, m.text);

    ta.addEventListener('input', () => {
      m.text = ta.value;
      drawPreview(preview, m.text);
      api.onEdit(i);
    });
    dur.addEventListener('change', () => {
      m.duration = Math.max(1, Math.round(+dur.value) || 10);
      dur.value = m.duration;
      api.save();
    });
    el.querySelector('.msg-actions').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'show') api.onShow(i);
      else if (act === 'up' && i > 0) api.onReorder(i, i - 1);
      else if (act === 'down' && i < state.messages.length - 1) api.onReorder(i, i + 1);
      else if (act === 'del') api.onDelete(i);
    });
    return el;
  }

  function renderList() {
    list.replaceChildren(...state.messages.map(card));
  }

  function setActive(i) {
    activeIndex = i;
    [...list.children].forEach((el, k) => el.classList.toggle('active', k === i));
  }

  $('#btn-add').addEventListener('click', () => {
    api.onAdd();
    renderList();
    const last = list.lastElementChild;
    last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    last?.querySelector('textarea').focus();
  });

  // Settings
  const bind = (id, key, read, write) => {
    const el = $(id);
    write(el, state[key]);
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      state[key] = read(el);
      api.onSetting(key);
    });
  };
  const checked = [(el) => el.checked, (el, v) => { el.checked = v; }];
  const value = [(el) => el.value, (el, v) => { el.value = v; }];
  bind('#opt-loop', 'loop', ...checked);
  bind('#opt-sound', 'sound', ...checked);
  bind('#opt-volume', 'volume', (el) => +el.value, (el, v) => { el.value = v; });
  // Slider is "speed" (right = faster); state stores milliseconds per flap.
  bind('#opt-speed', 'speed', (el) => Math.round(150 - +el.value * 1.2), (el, v) => { el.value = (150 - v) / 1.2; });
  bind('#opt-align', 'align', ...value);
  bind('#opt-theme', 'theme', ...value);
  bind('#opt-size', 'size', ...value);
  bind('#opt-wall', 'wall', ...value);

  // Panel
  const open = () => {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('panel-open');
  };
  const close = () => {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('panel-open');
    document.activeElement?.blur();
  };
  const togglePanel = () => (panel.classList.contains('open') ? close() : open());
  $('#btn-settings').addEventListener('click', open);
  $('#btn-close').addEventListener('click', close);
  $('#btn-next').addEventListener('click', api.onNext);
  $('#btn-fullscreen').addEventListener('click', api.onFullscreen);

  window.addEventListener('keydown', (e) => {
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
    if (e.key === 'Escape') { close(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') api.onFullscreen();
    else if (e.key === 's' || e.key === 'S') togglePanel();
    else if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); api.onNext(); }
  });

  // Auto-hide the toolbar and cursor so the board looks like a real display.
  let idleTimer;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, wake, { passive: true });
  wake();

  renderList();
  return { renderList, setActive, refreshPreviews: renderList };
}
