/* Claude Dash — declarative UI for mods: renders an `items` array (menus, panels) into a DOM container.
 * Everything is built with textContent, so mod text can never inject HTML. See docs/MODDING.md, section "Интерфейс". */
(function (root) {
  'use strict';
  const IMG_OK = /^(data:image\/(png|jpeg|webp|gif);base64,|https:\/\/|img\/)/;
  const MAX_ITEMS = 200;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  // env: { guard(fn) -> safe fn, menu (public handle), get(key), set(key, value), refresh() }
  function render(box, items, env, depth) {
    depth = depth || 0;
    if (!Array.isArray(items)) return;
    const res = (v) => (typeof v === 'function' ? env.guard(v)() : v);
    let idx = 0;
    for (const it of items.slice(0, MAX_ITEMS)) {
      idx++;
      if (!it || typeof it !== 'object') continue;
      if (res(it.hidden)) continue;
      let node = null;
      try { node = build(it, idx, env, res, depth); }
      catch (e) { node = el('div', 'mui-err', 'Ошибка элемента «' + (it.type || '?') + '»: ' + ((e && e.message) || e)); }
      if (node) box.appendChild(node);
    }
  }

  function field(label, control, extra) {
    const w = el('label', 'mui-field');
    if (label !== undefined && label !== null && label !== '') w.appendChild(extra || el('span', 'mui-label', label));
    w.appendChild(control);
    return w;
  }

  function build(it, idx, env, res, depth) {
    const type = it.type;
    const key = typeof it.key === 'string' && it.key ? it.key : 'item' + idx;
    const guard = env.guard;
    const changed = (v, refresh) => {
      env.set(key, v);
      if (typeof it.onChange === 'function') guard(it.onChange)(v, env.menu);
      if (refresh) env.refresh();
    };
    const dis = !!res(it.disabled);
    switch (type) {
      case 'heading': return el('h3', 'mui-heading', res(it.text));
      case 'text': return el('p', 'mui-text', res(it.text));
      case 'separator': return el('hr', 'mui-sep');
      case 'image': {
        const src = String(res(it.src) || '');
        if (!IMG_OK.test(src)) throw new Error('src картинки: data:image/..., https://... или img/...');
        const im = el('img', 'mui-image'); im.alt = ''; im.src = src;
        if (it.height) im.style.height = Math.max(16, Math.min(400, +it.height || 64)) + 'px';
        return im;
      }
      case 'progress': {
        const v = Math.max(0, Math.min(1, +res(it.value) || 0));
        const bar = el('div', 'mui-progress'), fill = el('i'); fill.style.width = (v * 100).toFixed(1) + '%'; bar.appendChild(fill);
        return it.label ? field(res(it.label), bar) : bar;
      }
      case 'button': {
        const b = el('button', 'small mui-button' + (it.style === 'primary' ? ' go' : it.style === 'danger' ? ' del' : ''), res(it.label));
        b.disabled = dis;
        b.onclick = () => { if (typeof it.onClick === 'function') guard(it.onClick)(env.menu); if (it.refresh !== false) env.refresh(); };
        return b;
      }
      case 'toggle': {
        const cur = env.get(key); const v = cur === undefined ? !!res(it.value) : !!cur;
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = v; cb.disabled = dis;
        const sw = el('span', 'mui-switch'); const w = el('label', 'mui-toggle');
        w.append(el('span', 'mui-label', res(it.label)), cb, sw);
        cb.onchange = () => changed(cb.checked, true);
        return w;
      }
      case 'slider': {
        const min = +res(it.min) || 0, max = res(it.max) === undefined ? 100 : +res(it.max), step = +res(it.step) || 1;
        const cur = env.get(key); let v = cur === undefined ? res(it.value) : cur; v = Number.isFinite(+v) ? +v : min;
        const inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = v; inp.disabled = dis;
        const lab = el('span', 'mui-label', res(it.label) + ': ' + v);
        inp.oninput = () => { lab.textContent = res(it.label) + ': ' + inp.value; changed(+inp.value, false); };
        inp.onchange = () => env.refresh();
        return field(res(it.label), inp, lab);
      }
      case 'select': {
        const opts = (res(it.options) || []).map((o) => (typeof o === 'object' && o ? { value: o.value, label: o.label === undefined ? String(o.value) : o.label } : { value: o, label: String(o) }));
        const sel = el('select'); sel.disabled = dis;
        opts.forEach((o, i) => { const op = el('option', '', o.label); op.value = String(i); sel.appendChild(op); });
        const cur = env.get(key), want = cur === undefined ? res(it.value) : cur;
        const at = opts.findIndex((o) => o.value === want); sel.value = String(at >= 0 ? at : 0);
        sel.onchange = () => changed(opts[+sel.value].value, true);
        return field(res(it.label), sel);
      }
      case 'input': {
        const inp = el(it.multiline ? 'textarea' : 'input'); if (!it.multiline) inp.type = it.password ? 'password' : 'text';
        if (it.password) { inp.autocomplete = 'off'; inp.autocapitalize = 'off'; inp.spellcheck = false; }
        if (it.multiline) inp.rows = Math.max(2, Math.min(10, +it.rows || 3));
        inp.maxLength = Math.max(1, Math.min(5000, +it.maxLength || 200)); inp.disabled = dis;
        inp.placeholder = String(res(it.placeholder) || '');
        const cur = env.get(key); inp.value = String(cur === undefined ? (res(it.value) || '') : cur);
        inp.oninput = () => env.set(key, inp.value);
        // no re-render here: it would replace the button the user is tapping and swallow that click
        inp.onchange = () => changed(inp.value, false);
        inp.onkeydown = (e) => { if (e.key === 'Enter' && !it.multiline && typeof it.onSubmit === 'function') { env.set(key, inp.value); guard(it.onSubmit)(inp.value, env.menu); } };
        return field(res(it.label), inp);
      }
      case 'row': {
        const r = el('div', 'mui-row'); render(r, res(it.items), env, depth + 1); return r;
      }
      case 'list': {
        const box = el('div', 'mui-list');
        for (const row of (res(it.rows) || []).slice(0, 100)) {
          if (!row || typeof row !== 'object') continue;
          const r = el('div', 'mui-lrow'), info = el('div', 'mui-linfo');
          info.append(el('b', '', row.title), el('span', '', row.subtitle || ''));
          r.appendChild(info);
          for (const bt of (row.buttons || []).slice(0, 4)) {
            const b = el('button', 'small' + (bt.style === 'primary' ? ' go' : bt.style === 'danger' ? ' del' : ''), bt.label);
            b.onclick = () => { if (typeof bt.onClick === 'function') guard(bt.onClick)(env.menu, row); env.refresh(); };
            r.appendChild(b);
          }
          box.appendChild(r);
        }
        if (!box.childNodes.length) box.appendChild(el('div', 'mui-empty', it.empty || 'Пусто'));
        return box;
      }
      case 'custom': {
        const d = el('div', 'mui-custom');
        if (typeof it.render !== 'function') throw new Error('custom: нужна функция render(container, menu)');
        guard(it.render)(d, env.menu);
        return d;
      }
      default: throw new Error('неизвестный тип «' + type + '»');
    }
  }

  root.DashModUI = { render };
})(typeof self !== 'undefined' ? self : this);
