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
| `api.ui.pauseButton(label, fn)` | кнопка в меню паузы |
| `api.ui.createMenu(spec)` | **отдельное меню** из элементов (см. «Интерфейс») |
| `api.ui.createPanel(spec)` | **панель поверх игры** (счётчики, подсказки) |
| `api.ui.setTheme(vars)` | перекрасить меню игры |
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

## Интерфейс: меню, панели, тема

Мод описывает интерфейс данными: массивом `items`. Игра сама рисует его, сохраняет значения и ловит ошибки.
Весь текст выводится как текст, HTML вставить нельзя.

### Отдельное меню: `api.ui.createMenu(spec)`

```js
const menu = api.ui.createMenu({
  id: 'settings',            // обязательно: a-z 0-9 _ -, уникальный внутри мода
  title: 'Настройки мода',   // заголовок окна
  persist: true,             // необязательно: запоминать значения между запусками
  items: [ ... ],            // массив элементов или функция, которая возвращает массив
  onClose() {}               // необязательно
});
menu.addToMainMenu('⚙ Настройки');   // кнопка в главном меню
menu.addToPauseMenu('⚙ Настройки');  // кнопка в паузе
menu.open();                         // открыть из кода (из главного меню или паузы)
```

Если во время игры вызвать `menu.open()`, игра сама встанет на паузу. Кнопка «← Назад», `Esc` и системная
кнопка «Назад» закрывают меню и возвращают туда, откуда его открыли.

Объект меню: `id`, `open()`, `close()`, `isOpen()`, `refresh()` (перерисовать), `setItems(items)`,
`get(key)`, `set(key, value)`, `addToMainMenu(label)`, `addToPauseMenu(label)`.

### Панель поверх игры: `api.ui.createPanel(spec)`

```js
const panel = api.ui.createPanel({
  id: 'info',
  position: 'top-left',     // top-left | top-right | bottom-left | bottom-right | top | bottom
  modes: ['play', 'dead'],  // когда показывать: menu play dead pause win edit (по умолчанию play, dead, win)
  refreshEvery: 0.25,       // секунды: как часто перерисовывать (0 — только вручную через refresh())
  interactive: false,       // true — панель принимает нажатия (по умолчанию пропускает их в игру)
  items: () => [{ type: 'text', text: 'Попытка ' + api.game.state().attempt }]
});
panel.hide(); panel.show(); panel.refresh(); panel.remove();
```

У панели те же `get/set/setItems/refresh`, что у меню. Для рисования на самом холсте используй события `render:world` / `render:hud`.

### Элементы (`items`)

Любое поле `text`, `label`, `value`, `disabled`, `hidden`, `rows`, `options`, `min`, `max` можно задать функцией.
Она вызывается при каждой перерисовке. Меню перерисовывается после каждого действия, панель по `refreshEvery` или `refresh()`.

| `type` | Поля | Что делает |
|---|---|---|
| `heading` | `text` | заголовок раздела |
| `text` | `text` | абзац (переносы строк сохраняются) |
| `separator` | | линия |
| `image` | `src`, `height` | картинка (`data:image/...`, `https://...`, `img/...`) |
| `progress` | `value` (0–1), `label` | полоса прогресса |
| `button` | `label`, `onClick(menu)`, `style: 'primary'\|'danger'`, `disabled`, `refresh: false` | кнопка |
| `toggle` | `key`, `label`, `value`, `onChange(value, menu)` | переключатель |
| `slider` | `key`, `label`, `min`, `max`, `step`, `value`, `onChange` | ползунок (`onChange` вызывается при движении) |
| `select` | `key`, `label`, `options: [{value,label} \| 'строка']`, `value`, `onChange` | выбор из списка |
| `input` | `key`, `label`, `value`, `placeholder`, `multiline`, `rows`, `maxLength`, `password`, `onChange`, `onSubmit` | поле ввода (`onChange` после завершения ввода, `onSubmit(value)` по Enter, `password: true` скрывает символы) |
| `row` | `items` | элементы в одну строку |
| `list` | `rows: [{title, subtitle, buttons: [{label, onClick(menu,row), style}]}]`, `empty` | список со строками и кнопками |
| `custom` | `render(container, menu)` | свой DOM: ты получаешь пустой `div` и делаешь с ним что хочешь |

Поле ввода не перерисовывает меню при потере фокуса (иначе терялось бы нажатие на кнопку рядом): прочитай его значение через `menu.get(key)` в `onClick` или `onSubmit`.

Значения элементов с `key` хранятся в меню: читай через `menu.get(key)`, меняй через `menu.set(key, value)`.
Если у меню `persist: true`, они сохраняются между запусками (до 20 КБ). Ошибка внутри одного элемента показывается
красной строкой на его месте и не ломает остальное меню. Исключение в `onClick`/`onChange` засчитывается моду
как обычная ошибка обработчика (5 раз и мод останавливается).

### Тема: `api.ui.setTheme(vars)`

```js
api.ui.setTheme({ accent: '#00e5ff', accent2: '#ff3df2', bg: '#05020f', card: '#150a2b', line: '#4a2a85', text: '#ffffff' });
```

Ключи: `accent`, `accent2`, `bg`, `card`, `line`, `text`. Значения: `#rgb`, `#rrggbb`, `rgb()/rgba()`, `hsl()/hsla()`.
Тема меняет окна и кнопки (не игровое поле) и снимается, когда мод выключен. Если тем несколько, побеждает загруженная позже.

### Пример: меню настроек и панель

```js
ClaudeDash.register({ id: 'settings-demo', name: 'Панель настроек', apiVersion: 1, init(api) {
  const menu = api.ui.createMenu({ id: 'settings', title: 'Настройки', persist: true, items: [
    { type: 'heading', text: 'Физика' },
    { type: 'slider', key: 'jump', label: 'Сила прыжка', min: 12, max: 26, step: 0.5, value: 18.9,
      onChange: (v) => api.physics.set({ JUMP: v }) },
    { type: 'toggle', key: 'hud', label: 'Показывать панель', value: true,
      onChange: (v) => (v ? panel.show() : panel.hide()) },
    { type: 'button', label: 'Сбросить', onClick: (m) => { m.set('jump', 18.9); api.physics.set({ JUMP: 18.9 }); } },
  ]});
  menu.addToMainMenu('⚙ Настройки');
  menu.addToPauseMenu('⚙ Настройки');
  const saved = menu.get('jump'); if (saved !== undefined) api.physics.set({ JUMP: saved });
  const panel = api.ui.createPanel({ id: 'info', position: 'top-left', refreshEvery: 0.25,
    items: () => [{ type: 'text', text: 'Попытка ' + api.game.state().attempt }] });
}});
```

Готовые примеры с интерфейсом: «Панель настроек» и «Неоновая тема» в `web/examples.js`.

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
