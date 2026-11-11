/* Claude Dash — Mod API v1: registry, loader and the per-mod `api` object.
 * A mod is a plain JS source that calls ClaudeDash.register({ id, name, version, apiVersion: 1, init(api) {...} }).
 * game.js supplies the `host` (what a mod may touch) and fires events through DashMods.emit(). See docs/MODDING.md. */
(function (root) {
  'use strict';
  const API_VERSION = 1;
  const EVENTS = ['start', 'attempt', 'frame', 'step', 'jump', 'portal', 'death', 'win', 'menu', 'levelBuilt',
    'render:world', 'render:hud'];
  const PHYS_KEYS = ['G', 'JUMP', 'PAD', 'SHIP_UP', 'SHIP_DN', 'SHIP_MAX', 'CORNER'];
  const MAX_ERRORS = 5;

  const Mods = {
    apiVersion: API_VERSION, events: EVENTS,
    host: null, defaults: null,
    loaded: [],            // successfully registered mods (runtime objects)
    status: new Map(),     // uid -> { ok, meta, error }
    hooks: new Map(),      // event -> [{ mod, fn }]

    init(host) {
      this.host = host;
      this.defaults = { C: {}, SIZES: {} };
      for (const k of PHYS_KEYS) this.defaults.C[k] = host.core.C[k];
      Object.assign(this.defaults.SIZES, host.core.C.SIZES);
    },

    has(ev) { const l = this.hooks.get(ev); return !!(l && l.length); },
    emit(ev, a, b) {
      const l = this.hooks.get(ev); if (!l) return;
      for (const h of l.slice()) {
        if (h.mod.dead) continue;
        try { h.fn(a, b); } catch (e) { this.fail(h.mod, e); }
      }
    },
    fail(mod, e) {
      mod.errors++; mod.lastError = String((e && e.message) || e);
      if (mod.errors >= MAX_ERRORS) { mod.dead = true; mod.lastError += ' — мод остановлен после ' + MAX_ERRORS + ' ошибок'; }
      const st = this.status.get(mod.uid); if (st) { st.ok = !mod.dead; st.error = mod.lastError; }
      if (this.host && this.host.onModError) this.host.onModError(mod);
    },

    unloadAll() {
      for (const mod of this.loaded.slice()) {
        try { if (mod.manifest && typeof mod.manifest.dispose === 'function') mod.manifest.dispose(); } catch (e) { /* ignore */ }
        if (this.host) this.host.removeByMod(mod.meta.id);
      }
      this.loaded = []; this.hooks.clear(); this.status.clear();
      // put the physics back
      if (this.host && this.defaults) {
        Object.assign(this.host.core.C, this.defaults.C);
        Object.assign(this.host.core.C.SIZES, this.defaults.SIZES);
      }
    },

    // entries: [{ uid, src }] -> loads them in order, returns status map
    reloadAll(entries) {
      this.unloadAll();
      for (const e of entries) this.status.set(e.uid, this.load(e));
      return this.status;
    },

    load(entry) {
      const mod = { uid: entry.uid, meta: null, manifest: null, dead: false, errors: 0, lastError: '', phys: { C: {}, SIZES: {} } };
      const res = { ok: false, meta: null, error: '' };
      const reg = (m) => {
        if (mod.manifest) throw new Error('register() вызван дважды');
        if (!m || typeof m !== 'object') throw new Error('register() ждёт объект');
        if (typeof m.id !== 'string' || !/^[a-z0-9_-]{2,40}$/.test(m.id)) throw new Error('id мода: 2–40 символов a-z 0-9 _ -');
        if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('у мода нет name');
        if (m.apiVersion !== API_VERSION) throw new Error('мод для Mod API v' + m.apiVersion + ', игра поддерживает v' + API_VERSION);
        if (typeof m.init !== 'function') throw new Error('у мода нет функции init(api)');
        mod.manifest = m;
        mod.meta = { id: m.id, name: String(m.name).slice(0, 40), version: String(m.version || '1.0').slice(0, 16),
          author: String(m.author || '').slice(0, 40), description: String(m.description || '').slice(0, 200) };
      };
      try {
        let fn;
        try { fn = new Function('ClaudeDash', '"use strict";\n' + entry.src + '\n//# sourceURL=claudedash-mod-' + entry.uid + '.js'); }
        catch (e) {
          if (e instanceof EvalError) throw new Error('в этой среде запрещён запуск кода (CSP). Моды работают в приложении и на GitHub Pages');
          throw e;
        }
        fn({ apiVersion: API_VERSION, register: reg });
        if (!mod.manifest) throw new Error('мод не вызвал ClaudeDash.register(...)');
        if (this.loaded.some((x) => x.meta.id === mod.meta.id)) throw new Error('мод с id «' + mod.meta.id + '» уже загружен');
        res.meta = mod.meta;
        this.loaded.push(mod);
        this.status.set(entry.uid, res);   // so fail() during init can find it
        mod.manifest.init(this.makeApi(mod));
        res.ok = true;
      } catch (e) {
        res.error = String((e && e.message) || e);
        res.ok = false;
        if (mod.meta) { // registered but init threw: undo everything it did
          mod.dead = true;
          this.host.removeByMod(mod.meta.id);
          for (const [ev, l] of this.hooks) this.hooks.set(ev, l.filter((h) => h.mod !== mod));
          this.loaded = this.loaded.filter((x) => x !== mod);
          this.applyPhysics();
        }
      }
      return res;
    },

    // physics = defaults + the overrides of every loaded mod, in load order
    applyPhysics() {
      const C = this.host.core.C;
      Object.assign(C, this.defaults.C); Object.assign(C.SIZES, this.defaults.SIZES);
      for (const m of this.loaded) { Object.assign(C, m.phys.C); Object.assign(C.SIZES, m.phys.SIZES); }
    },

    makeApi(mod) {
      const self = this, H = this.host, id = mod.meta.id;
      // wraps a mod callback so an exception is counted against the mod instead of breaking the game
      const guard = (fn) => (typeof fn === 'function' ? (...a) => { try { return fn(...a); } catch (e) { self.fail(mod, e); } } : () => undefined);
      const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
      return Object.freeze({
        apiVersion: API_VERSION,
        modId: id,
        log: (...a) => console.log('[mod ' + id + ']', ...a),

        // ---- events ----
        on(ev, fn) {
          if (EVENTS.indexOf(ev) < 0) throw new Error('неизвестное событие «' + ev + '». Доступные: ' + EVENTS.join(', '));
          if (typeof fn !== 'function') throw new Error('on() ждёт функцию');
          const h = { mod, fn };
          if (!self.hooks.has(ev)) self.hooks.set(ev, []);
          self.hooks.get(ev).push(h);
          return () => { const l = self.hooks.get(ev); if (l) self.hooks.set(ev, l.filter((x) => x !== h)); };
        },

        // ---- physics constants (restored when the mod is turned off) ----
        physics: Object.freeze({
          get: () => ({ ...H.core.C, SIZES: { ...H.core.C.SIZES } }),
          set(o) {
            for (const k of Object.keys(o || {})) {
              if (k === 'SIZES') { for (const m of Object.keys(o.SIZES || {})) if (m in H.core.C.SIZES) mod.phys.SIZES[m] = num(o.SIZES[m], 0.2, 1.5, H.core.C.SIZES[m]); }
              else if (PHYS_KEYS.indexOf(k) >= 0) mod.phys.C[k] = num(o[k], -300, 300, H.core.C[k]);
              else throw new Error('physics.set: нельзя менять «' + k + '». Можно: ' + PHYS_KEYS.concat('SIZES').join(', '));
            }
            self.applyPhysics();
          },
        }),

        // ---- heroes ----
        heroes: Object.freeze({
          // { id, name, src (data:image/... или https://...), colors?: [главный, второй, третий] }
          add: (h) => H.addHero(h, id),
          list: () => H.listHeroes(),
        }),

        // ---- levels ----
        levels: Object.freeze({
          // уровень в формате редактора: { id, name, len, objs:[...] }  или генерируемый: { id, name, plan:[{m,len}], pool, gap, seed, hue }
          add: (l) => H.addLevel(l, id),
          // помощники для 'levelBuilt': добавить объекты в готовый уровень
          block: (lv, x, y, w, h) => H.lvAdd(lv, 'block', { x, y, w: w || 1, h: h || 1 }),
          spike: (lv, x, y, down) => H.lvAdd(lv, 'spike', { x, y, d: down ? 1 : 0 }),
          pad: (lv, x, y) => H.lvAdd(lv, 'pad', { x, y }),
        }),

        // ---- UI ----
        ui: Object.freeze({
          menuButton: (label, fn) => H.addButton(String(label).slice(0, 30), fn, id),
          pauseButton: (label, fn) => H.addPauseButton(String(label).slice(0, 30), guard(fn), id),
          toast: (msg) => H.toast(String(msg).slice(0, 120)),
          // separate menus / HUD panels built from an `items` array (see docs/MODDING.md, "Интерфейс")
          createMenu: (spec) => H.createMenu(spec, id, guard),
          createPanel: (spec) => H.createPanel(spec, id, guard),
          setTheme: (vars) => H.setTheme(id, vars),
        }),

        // ---- effects & sound ----
        fx: Object.freeze({
          particle: (p) => H.particle(p || {}),
          burst: (x, y, n, colors, speed) => H.burst(x, y, num(n, 1, 60, 10), Array.isArray(colors) && colors.length ? colors.map(String) : ['#fff'], num(speed, 0, 20, 6)),
        }),
        audio: Object.freeze({
          beep: (f0, f1, dur, type, vol) => H.beep(num(f0, 20, 8000, 440), num(f1, 20, 8000, 440), num(dur, 0.01, 1, 0.1),
            ['sine', 'square', 'sawtooth', 'triangle'].indexOf(type) >= 0 ? type : 'square', num(vol, 0, 0.2, 0.08)),
        }),

        // ---- per-mod storage (kept between launches) ----
        storage: Object.freeze({
          get: (k, d) => H.getData(id, String(k), d),
          set: (k, v) => H.setData(id, String(k), v),
        }),

        // ---- game state (read-only snapshot) and a few actions ----
        game: Object.freeze({
          state: () => H.state(),
          restart: () => H.restart(),
          setHero: (hid) => H.setHero(String(hid)),
        }),
      });
    },
  };

  root.DashMods = Mods;
})(typeof self !== 'undefined' ? self : this);
