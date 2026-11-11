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
];
