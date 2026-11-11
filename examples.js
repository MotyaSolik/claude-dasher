/* Example mods shown in "Моды → Примеры". Each `src` is a complete mod file (see docs/MODDING.md). */
window.DashExamples = [
  {
    name: 'Лунная гравитация',
    desc: 'Куб прыгает выше и дольше. Меняет физику через api.physics.',
    src: `ClaudeDash.register({
  id: 'moon-gravity', name: 'Лунная гравитация', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Слабая гравитация: прыжки выше и длиннее.',
  init(api) {
    api.physics.set({ G: -48, JUMP: 15.6 });
  },
  dispose() {} // физика вернётся к обычной сама
});`,
  },
  {
    name: 'Турбо x1.25',
    desc: 'Ускоряет каждый уровень на 25%. Пример события levelBuilt.',
    src: `ClaudeDash.register({
  id: 'turbo', name: 'Турбо x1.25', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Все уровни на 25% быстрее.',
  init(api) {
    api.on('levelBuilt', (lv) => { lv.speed = lv.speed * 1.25; });
  }
});`,
  },
  {
    name: 'Радужный след',
    desc: 'Цветные частицы за героем. Пример событий frame и fx.particle.',
    src: `ClaudeDash.register({
  id: 'rainbow-trail', name: 'Радужный след', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Герой оставляет радужный след.',
  init(api) {
    let hue = 0;
    api.on('frame', (dt) => {
      const s = api.game.state();
      if (s.mode !== 'play') return;
      hue = (hue + 400 * dt) % 360;
      api.fx.particle({ x: s.player.x, y: s.player.y + 0.3, vx: -3, vy: (Math.random() - 0.5) * 2,
        life: 0.5, size: 0.22, color: 'hsl(' + hue + ',95%,60%)' });
    });
  }
});`,
  },
  {
    name: 'Эмодзи-герои',
    desc: 'Добавляет героев Кот и Пончик. Пример api.heroes.add с картинкой из canvas.',
    src: `ClaudeDash.register({
  id: 'emoji-heroes', name: 'Эмодзи-герои', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Два новых героя в выборе героя.',
  init(api) {
    function emoji(ch) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d'); x.font = '104px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(ch, 64, 70); return c.toDataURL('image/png');
    }
    api.heroes.add({ id: 'cat', name: 'Кот', src: emoji('\\u{1F431}'), colors: ['#f2b84b', '#ffd98a', '#ffffff'] });
    api.heroes.add({ id: 'donut', name: 'Пончик', src: emoji('\\u{1F369}'), colors: ['#e58bb0', '#f7c6da', '#ffffff'] });
  }
});`,
  },
  {
    name: 'Секундомер и FPS',
    desc: 'Рисует время попытки и FPS поверх игры. Пример render:hud и storage.',
    src: `ClaudeDash.register({
  id: 'hud-clock', name: 'Секундомер и FPS', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Время попытки, FPS и лучшее время.',
  init(api) {
    let frames = 0, acc = 0, fps = 0, t = 0;
    api.on('attempt', () => { t = 0; });
    api.on('frame', (dt) => { t += dt; acc += dt; frames++; if (acc >= 0.5) { fps = Math.round(frames / acc); frames = 0; acc = 0; } });
    api.on('win', () => {
      const best = api.storage.get('best', 1e9);
      if (t < best) { api.storage.set('best', t); api.ui.toast('Новый рекорд времени: ' + t.toFixed(2) + ' c'); }
    });
    api.on('render:hud', (r) => {
      const c = r.ctx; c.save(); c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '700 13px system-ui,sans-serif'; c.textAlign = 'left';
      c.fillText(t.toFixed(1) + ' c   ' + fps + ' FPS', 12, r.H - 12); c.restore();
    });
  }
});`,
  },
  {
    name: 'Бонусный уровень',
    desc: 'Добавляет готовый уровень в меню. Пример api.levels.add и menuButton.',
    src: `ClaudeDash.register({
  id: 'bonus-level', name: 'Бонусный уровень', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Короткий уровень со ступеньками и шипами.',
  init(api) {
    const objs = [];
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 9;
      objs.push({ t: 's', x: x, y: 0, d: 0 });
      if (i % 2) objs.push({ t: 'b', x: x + 4, y: 0 });
    }
    api.levels.add({ id: 'stairs-of-spikes', name: 'Шипы и ступеньки', len: 80, objs: objs });
    api.ui.menuButton('Привет от мода', () => api.ui.toast('Мод работает!'));
  }
});`,
  },
  {
    name: 'Панель настроек',
    desc: 'Своё меню с ползунком, переключателем, списком и полем ввода, плюс панель поверх игры. Пример createMenu и createPanel.',
    src: `ClaudeDash.register({
  id: 'settings-demo', name: 'Панель настроек', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Меню настроек и панель на экране.',
  init(api) {
    const menu = api.ui.createMenu({
      id: 'settings', title: 'Настройки мода', persist: true,
      items: [
        { type: 'heading', text: 'Физика' },
        { type: 'slider', key: 'jump', label: 'Сила прыжка', min: 12, max: 26, step: 0.5, value: 18.9,
          onChange: (v) => api.physics.set({ JUMP: v }) },
        { type: 'heading', text: 'Экран' },
        { type: 'toggle', key: 'hud', label: 'Показывать панель', value: true,
          onChange: (v) => (v ? panel.show() : panel.hide()) },
        { type: 'select', key: 'jumpMode', label: 'Прыжок сбрасывается', value: 'never',
          options: [{ value: 'never', label: 'Никогда' }, { value: 'attempt', label: 'Каждую попытку' }] },
        { type: 'input', key: 'name', label: 'Твоё имя', placeholder: 'Игрок' },
        { type: 'separator' },
        { type: 'button', label: 'Сбросить прыжок', onClick: (m) => { m.set('jump', 18.9); api.physics.set({ JUMP: 18.9 }); } },
      ],
    });
    menu.addToMainMenu('⚙ Настройки мода');
    menu.addToPauseMenu('⚙ Настройки мода');
    api.on('attempt', () => { if (menu.get('jumpMode') === 'attempt') api.physics.set({ JUMP: 18.9 }); });
    const saved = menu.get('jump');
    if (saved !== undefined) api.physics.set({ JUMP: saved });

    const panel = api.ui.createPanel({
      id: 'info', position: 'top-left', refreshEvery: 0.25,
      items: () => {
        const s = api.game.state();
        return [
          { type: 'text', text: (menu.get('name') || 'Игрок') + ' · попытка ' + s.attempt },
          { type: 'text', text: 'Режим: ' + (s.player ? s.player.mode : '—') },
        ];
      },
    });
    if (menu.get('hud') === false) panel.hide();
  }
});`,
  },
  {
    name: 'Неоновая тема',
    desc: 'Перекрашивает меню игры. Пример api.ui.setTheme.',
    src: `ClaudeDash.register({
  id: 'neon-theme', name: 'Неоновая тема', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Фиолетово-голубые меню.',
  init(api) {
    api.ui.setTheme({ accent: '#00e5ff', accent2: '#ff3df2', bg: '#05020f', card: '#150a2b', line: '#4a2a85' });
  }
});`,
  },
  {
    name: 'Мод-меню (по паролю)',
    desc: 'Меню читов под паролем: ghost, скорость, гравитация, прыжок, хитбоксы, пропуск уровня. За неверный пароль мод мстит помехами в игре.',
    src: `ClaudeDash.register({
  id: 'mod-menu', name: 'Мод-меню', version: '1.0', author: 'Claude Dash', apiVersion: 1,
  description: 'Читы под паролем. За неверный пароль мод мстит: мешает играть (временно).',
  init(api) {
    // Пароль не хранится открытым текстом: сравнивается хэш. Это защита от случайного входа,
    // а не настоящая безопасность: код мода можно прочитать.
    var PASS_HASH = 921752566174675;
    function hash(s) {
      var a = 0xdeadbeef, b = 0x41c6ce57;
      for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
      a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
      b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
      return 4294967296 * (2097151 & b) + (a >>> 0);
    }

    var unlocked = false, msg = '', tries = 0, lockUntil = 0;
    var cfg = { noclip: false, hitbox: false, speed: 1, gravity: -85, jump: 18.9 };
    var lv = null, baseSpeed = 0, offStep = null, offDraw = null;

    // ---- месть за неверный пароль ----
    // Чем больше неверных попыток, тем дольше и злее. Таймер идёт только во время игры и виден на экране.
    // Снимается правильным паролем, выключается тумблером в меню или выключением мода (физика вернётся сама).
    var wrong = 0, rev = { left: 0, level: 0, off: [], taunt: 0 };
    var REV_TIME = [0, 15, 30, 60];
    var TAUNTS = ['Хрю-хрю! Пароль не угадан', 'Не тот пароль. Держи гравитацию', 'Сам виноват', 'Это месть за неверный пароль', 'Попробуй пароль ещё раз'];
    function revengeEnabled() { return api.storage.get('revenge', true) !== false; }
    function revSpeed() { return rev.level >= 2 ? 1.25 : 1; }
    function stopRevenge(silent) {
      var was = rev.left > 0;
      rev.left = 0; rev.level = 0;
      for (var i = 0; i < rev.off.length; i++) rev.off[i]();
      rev.off = [];
      api.physics.set({ G: cfg.gravity, JUMP: cfg.jump }); applySpeed();
      if (was && !silent) api.ui.toast('Месть закончилась');
    }
    function startRevenge(level) {
      if (!revengeEnabled()) return;
      stopRevenge(true);
      rev.level = level; rev.left = REV_TIME[Math.min(level, 3)]; rev.taunt = 3;
      api.physics.set({ G: cfg.gravity * (level >= 3 ? 1.6 : 1.4) }); applySpeed();
      rev.off.push(api.on('frame', function (dt) {
        rev.left -= dt; rev.taunt -= dt;
        if (rev.left <= 0) return stopRevenge();
        if (rev.level >= 3 && rev.taunt <= 0) { rev.taunt = 9; api.ui.toast(TAUNTS[Math.floor(Math.random() * TAUNTS.length)]); }
      }));
      if (level >= 2) {
        rev.off.push(api.on('step', function (p) {   // случайные прыжки и дрожь корабля
          if (p.mode === 'cube' && p.grounded && Math.random() < 0.003) { p.vy = cfg.jump * 0.8; p.grounded = false; }
          else if (p.mode === 'ship' && rev.level >= 3) p.vy += (Math.random() - 0.5) * 0.8;
        }));
      }
      if (level >= 3) {
        rev.off.push(api.on('render:hud', function (r) {   // «фонарик»: видно только вокруг героя
          var s = r.state.player; if (!s) return;
          var c = r.ctx, x = r.sx(s.x + s.size / 2), y = r.sy(s.y + s.size / 2), R = r.TILE * (2.6 + Math.sin(Date.now() / 300) * 0.4);
          var g = c.createRadialGradient(x, y, R * 0.5, x, y, R * 2.4);
          g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.93)');
          c.fillStyle = g; c.fillRect(0, 0, r.W, r.H);
        }));
      }
      if (level >= 2) rev.off.push(api.on('death', function () { api.audio.beep(180, 60, 0.25, 'sawtooth'); }));
    }

    function login() {
      var left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left > 0) { msg = 'Подожди ' + left + ' с'; return menu.refresh(); }
      var v = String(menu.get('pw') || '').trim().toLowerCase();
      if (hash(v) === PASS_HASH) { unlocked = true; msg = ''; tries = 0; wrong = 0; stopRevenge(true); api.audio.beep(500, 1000, 0.15, 'square'); api.ui.toast('Мод-меню открыто'); }
      else {
        tries++; wrong++; msg = 'Неверный пароль.';
        if (tries >= 3) { tries = 0; lockUntil = Date.now() + 10000; msg = 'Слишком много попыток. Подожди 10 секунд.'; }
        api.audio.beep(200, 90, 0.2, 'sawtooth');
        if (revengeEnabled()) {
          startRevenge(Math.min(wrong, 3));
          msg += ' Месть: ' + rev.left + ' с игры.';
        }
      }
      menu.set('pw', '');
    }

    // ---- cheats ----
    function wantStepHook() { return cfg.noclip; }
    function syncHooks() {
      if (wantStepHook() && !offStep) {
        offStep = api.on('step', function (p) {
          if (p.dead && cfg.noclip) { if (p.crash === 'fall') { p.y = 1; p.vy = 0; } p.dead = false; p.crash = undefined; }
        });
      } else if (!wantStepHook() && offStep) { offStep(); offStep = null; }
      if (cfg.hitbox && !offDraw) {
        offDraw = api.on('render:world', function (r) {
          var s = api.game.state(), c = r.ctx;
          c.lineWidth = 2;
          if (s.player) { c.strokeStyle = '#5ee08a'; c.strokeRect(r.sx(s.player.x), r.sy(s.player.y + s.player.size), s.player.size * r.TILE, s.player.size * r.TILE); }
          if (!lv) return;
          c.strokeStyle = '#ff4d6d';
          for (var i = 0; i < lv.spikes.length; i++) {
            var o = lv.spikes[i];
            if (o.x < r.camX - 2 || o.x > r.camX + r.W / r.TILE + 2) continue;
            var y0 = o.d ? o.y + 0.48 : o.y + 0.02;
            c.strokeRect(r.sx(o.x + 0.35), r.sy(y0 + 0.5), 0.3 * r.TILE, 0.5 * r.TILE);
          }
        });
      } else if (!cfg.hitbox && offDraw) { offDraw(); offDraw = null; }
    }
    function applySpeed() { if (lv && baseSpeed) lv.speed = baseSpeed * cfg.speed * revSpeed(); }
    api.on('levelBuilt', function (l) { lv = l; baseSpeed = l.speed; applySpeed(); });

    // работает только во время игры: открой меню из паузы
    function inGame() {
      var m = api.game.state().mode;
      if (m === 'pause' || m === 'play') return true;
      api.ui.toast('Открой меню из паузы во время игры'); return false;
    }
    function skipLevel() {
      if (!inGame()) return;
      var off = api.on('step', function (p) { if (lv) { p.x = lv.len; p.dead = false; p.won = true; } off(); });
      api.ui.toast('Уровень пропущен. Продолжи игру');
    }
    function toHalf() {
      if (!inGame()) return;
      var off = api.on('step', function (p) { if (lv) { p.x = Math.max(p.x, lv.len / 2); p.y = 2; p.vy = 0; p.dead = false; } off(); });
      api.ui.toast('Телепорт на середину. Продолжи игру');
    }

    function lockItems() {
      return [
        { type: 'heading', text: 'Мод-меню' },
        { type: 'text', text: 'Введи пароль, чтобы открыть меню.' },
        { type: 'input', key: 'pw', label: 'Пароль', password: true, placeholder: 'пароль', onSubmit: login },
        { type: 'button', label: 'Войти', style: 'primary', onClick: login },
        { type: 'text', text: function () { return msg; } },
      ];
    }
    function cheatItems() {
      return [
        { type: 'heading', text: 'Неуязвимость' },
        { type: 'toggle', key: 'noclip', label: 'Ghost: проходить сквозь шипы и блоки', value: false,
          onChange: function (v) { cfg.noclip = v; syncHooks(); } },
        { type: 'toggle', key: 'hitbox', label: 'Показывать хитбоксы', value: false,
          onChange: function (v) { cfg.hitbox = v; syncHooks(); } },
        { type: 'heading', text: 'Физика' },
        { type: 'slider', key: 'speed', label: 'Скорость уровня (x)', min: 0.3, max: 2.5, step: 0.05, value: 1,
          onChange: function (v) { cfg.speed = v; applySpeed(); } },
        { type: 'slider', key: 'gravity', label: 'Гравитация куба', min: -140, max: -25, step: 1, value: -85,
          onChange: function (v) { cfg.gravity = v; api.physics.set({ G: rev.left > 0 ? v * (rev.level >= 3 ? 1.6 : 1.4) : v }); } },
        { type: 'slider', key: 'jump', label: 'Сила прыжка', min: 10, max: 30, step: 0.5, value: 18.9,
          onChange: function (v) { cfg.jump = v; api.physics.set({ JUMP: v }); } },
        { type: 'heading', text: 'Уровень' },
        { type: 'row', items: [
          { type: 'button', label: 'Пропустить уровень', onClick: function () { skipLevel(); } },
          { type: 'button', label: 'На середину', onClick: function () { toHalf(); } },
        ] },
        { type: 'separator' },
        { type: 'toggle', key: 'revenge', label: 'Месть за неверный пароль', value: revengeEnabled(),
          onChange: function (v) { api.storage.set('revenge', v); if (!v) stopRevenge(); } },
        { type: 'button', label: 'Сбросить всё', onClick: function () {
          cfg = { noclip: false, hitbox: false, speed: 1, gravity: -85, jump: 18.9 };
          ['noclip', 'hitbox', 'speed', 'gravity', 'jump'].forEach(function (k) { menu.set(k, cfg[k]); });
          stopRevenge(true); api.physics.set({ G: -85, JUMP: 18.9 }); applySpeed(); syncHooks();
        } },
        { type: 'button', label: 'Заблокировать меню', style: 'danger', onClick: function () { unlocked = false; msg = ''; } },
      ];
    }

    var menu = api.ui.createMenu({ id: 'main', title: 'Мод-меню', items: function () { return unlocked ? cheatItems() : lockItems(); },
      onClose: function () { if (!unlocked) { msg = ''; } } });
    menu.addToMainMenu('🔒 Мод-меню');
    menu.addToPauseMenu('🔒 Мод-меню');

    api.ui.createPanel({ id: 'status', position: 'top-right', refreshEvery: 0.3, modes: ['play', 'dead'],
      items: function () {
        var on = [];
        if (cfg.noclip) on.push('ghost'); if (cfg.hitbox) on.push('хитбоксы'); if (cfg.speed !== 1) on.push('x' + cfg.speed.toFixed(2));
        var out = on.length ? [{ type: 'text', text: 'МОД: ' + on.join(' · ') }] : [];
        if (rev.left > 0) out.push({ type: 'text', text: '😈 МЕСТЬ: ' + Math.ceil(rev.left) + ' с (правильный пароль снимает)' });
        return out;
      } });
  }
});`,
  },
];
