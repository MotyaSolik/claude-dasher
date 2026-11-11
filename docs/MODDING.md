# Claude Dash — Mod API v1

Мод — это один JS-файл. Он вызывает `ClaudeDash.register({...})`, а игра передаёт ему объект `api`.

```js
ClaudeDash.register({
  id: 'moon-gravity',          // 2–40 символов: a-z 0-9 _ -  (уникальный)
  name: 'Лунная гравитация',   // имя в списке модов
  version: '1.0',              // необязательно
  author: 'Я',                 // необязательно
  description: 'Прыжки выше', // необязательно
  apiVersion: 1,               // обязательно, сейчас только 1
  init(api) {                  // вызывается при загрузке мода
    api.physics.set({ G: -48, JUMP: 15.6 });
  },
  dispose() {}                 // необязательно: вызывается при выключении мода
});
```

## Как установить мод

Меню → **🧩 Моды**:

* **Установить код**: вставь код в поле.
* **Из файла…**: выбери `.js` файл.
* **Скачать**: вставь ссылку на `.js` (сайт должен разрешать загрузку из страницы, например raw.githubusercontent.com).
* **Примеры**: готовые моды из игры (код лежит в `web/examples.js`).

Моды сохраняются между запусками и включаются/выключаются кнопкой. При включении, выключении и удалении все
моды перезагружаются с нуля: физика возвращается к обычной, добавленные герои, уровни и кнопки убираются.
Изменения уровня (`levelBuilt`) действуют со следующего запуска уровня.

## Безопасность

Мод выполняется как обычный код внутри страницы игры: у него нет песочницы. Он может читать и менять всё, что видит
игра, включая сохранённые рекорды. API ограничивает только то, что делают его собственные функции. Ставь только моды,
которым доверяешь. Если мод 5 раз бросил исключение в обработчике события, игра перестаёт его вызывать и показывает ошибку.

## Объект `api`

| Что | Описание |
|---|---|
| `api.apiVersion`, `api.modId` | версия API и твой id |
| `api.log(...)` | `console.log` с префиксом мода |
| `api.on(event, fn)` | подписка на событие, возвращает функцию отписки |
| `api.physics.get()` / `.set(obj)` | константы физики (см. ниже) |
| `api.heroes.add({id,name,src,colors})` / `.list()` | свои герои |
| `api.levels.add(level)` | уровень в меню «Уровни из модов» |
| `api.levels.block(lv,x,y,w,h)` / `.spike(lv,x,y,down)` / `.pad(lv,x,y)` | добавить объект в готовый уровень (из `levelBuilt`) |
| `api.ui.menuButton(label, fn)` | кнопка в главном меню |
| `api.ui.toast(text)` | всплывающая подсказка |
| `api.fx.particle({x,y,vx,vy,life,size,color})` | частица в мировых координатах (клетки) |
| `api.fx.burst(x,y,n,colors,speed)` | взрыв частиц |
| `api.audio.beep(f0,f1,dur,type,vol)` | короткий звук (`sine/square/sawtooth/triangle`, `dur` ≤ 1 с) |
| `api.storage.get(key, default)` / `.set(key, value)` | хранилище мода (JSON, до 20 КБ на значение) |
| `api.game.state()` | снимок состояния (см. ниже) |
| `api.game.restart()` / `.setHero(id)` | перезапустить попытку / выбрать героя |

### События

| Событие | Аргумент | Когда |
|---|---|---|
| `start` | `state` | начался уровень (перед первой попыткой) |
| `attempt` | номер попытки | началась каждая попытка |
| `levelBuilt` | `lv` | уровень построен. Можно менять `lv.speed` и добавлять объекты |
| `frame` | `dt` (сек) | каждый кадр, пока идёт игра |
| `step` | `player` | каждый шаг физики (240 раз в секунду), можно менять игрока. Дорого, пользуйся аккуратно |
| `jump` | | куб прыгнул |
| `portal` | `'cube' \| 'ship' \| 'wave'` | игрок прошёл портал |
| `death` | `{percent, crash, x, y, attempt}` | игрок разбился (`crash`: `wall`, `spike`, `fall`) |
| `win` | `{attempt}` | уровень пройден |
| `menu` | | вернулись в главное меню |
| `render:world` | `r` | рисование поверх мира, под героем |
| `render:hud` | `r` | рисование поверх всего |

`r` для рендера: `{ ctx, W, H, TILE, camX, sx(x), sy(y), t, state }`. `ctx` — canvas 2D, `sx/sy` переводят
координаты в клетках в пиксели (`y = 0` — верх земли), `TILE` — размер клетки в пикселях. Состояние `ctx`
восстанавливается после каждого обработчика.

### `api.game.state()`

```js
{ mode: 'menu'|'play'|'dead'|'pause'|'win'|'edit', attempt, hero, difficulty: 'easy'|'hard'|'swin', testing, held,
  level: { id, name, len, speed } | null,
  player: { x, y, vy, mode: 'cube'|'ship'|'wave', size, grounded, dead } | null }
```

### Физика: `api.physics.set({...})`

Разрешены ключи `G` (гравитация куба, −85), `JUMP` (импульс прыжка, 18.9), `PAD` (батут, 27.5),
`SHIP_UP` (42), `SHIP_DN` (−34), `SHIP_MAX` (11), `CORNER` (0.15) и `SIZES: { cube, ship, wave }` (размер хитбокса).
Значения ограничиваются разумными пределами. Остальное (например `SPEED`) менять нельзя, скорость задаёт
сложность, её можно умножить в `levelBuilt`. Когда несколько модов меняют один ключ, побеждает тот, что загружен позже.

### Герои

```js
api.heroes.add({ id: 'cat', name: 'Кот', src: 'data:image/png;base64,...', colors: ['#f2b84b', '#ffd98a', '#fff'] });
```

`src`: `data:image/png|jpeg|webp|gif;base64,...`, `https://...` или `img/...`. Картинка с прозрачным
фоном выглядит лучше всего. `colors` задаёт цвета следа и частиц.

### Уровни

В формате редактора (как в «Создать уровень»):

```js
api.levels.add({ id: 'my-level', name: 'Мой уровень', len: 80, hue: 200, objs: [
  { t: 'b', x: 10, y: 0 },            // блок
  { t: 's', x: 14, y: 0, d: 0 },      // шип (d: 1 — вниз)
  { t: 'p', x: 20, y: 0 },            // батут
  { t: 'g', x: 30, m: 'ship' },       // портал режима: cube | ship | wave
  { t: 'h', x: 50 }                   // яма
]});
```

Или генерируемый (как встроенные): `{ id, name, hue, seed, stars, gap: [мин, макс], pool: ['spike1','block1',...],
plan: [{ m: 'cube', len: 100 }, { m: 'ship', len: 80 }, { m: 'cube', len: 60 }] }`. Доступные узоры для `pool`:
`spike1 spike2 block1 block3 blockSpike spikeBlock stairs hill pit2 pit3 pitSpike padSpikes padBlock spikeTrain`.
Проходимость уровней из модов не проверяется.

## Примеры

**Своя кнопка и звук**

```js
ClaudeDash.register({ id: 'hello', name: 'Привет', apiVersion: 1, init(api) {
  api.ui.menuButton('Привет', () => { api.audio.beep(440, 880, 0.2); api.ui.toast('Привет!'); });
}});
```

**Счётчик смертей**

```js
ClaudeDash.register({ id: 'death-count', name: 'Счётчик смертей', apiVersion: 1, init(api) {
  api.on('death', () => api.storage.set('n', api.storage.get('n', 0) + 1));
  api.on('render:hud', (r) => {
    r.ctx.fillStyle = '#fff'; r.ctx.font = '700 13px sans-serif';
    r.ctx.fillText('Смертей: ' + api.storage.get('n', 0), 12, 24);
  });
}});
```

**Шипы на каждом уровне**

```js
ClaudeDash.register({ id: 'extra-spikes', name: 'Лишние шипы', apiVersion: 1, init(api) {
  api.on('levelBuilt', (lv) => { for (let x = 30; x < lv.len - 20; x += 25) api.levels.spike(lv, x, 0); });
}});
```

Больше примеров: `web/examples.js`.
