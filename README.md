# Claude Dash

Клон Geometry Dash: вместо куба прыгает картинка — **Claude** (пиксельный краб) или **Хрюша**.

* 3 уровня (лёгкий / средний / кошмар), шипы, блоки, ямы, жёлтые батуты
* управление: тап по экрану / пробел / клик — прыжок (зажми — прыгаешь подряд), `Esc` — пауза, `R` — заново
* звук и музыка генерируются WebAudio (без файлов)
* рекорды и выбранный герой сохраняются

## Структура

| Путь | Что |
|---|---|
| `web/` | вся игра (HTML5 canvas, без зависимостей). Открывается и в браузере: `python3 -m http.server -d web` |
| `web/core.js` | физика, генератор уровней, проверка проходимости |
| `tools/verify.js` | `node tools/verify.js` — доказывает, что каждый уровень проходим |
| `android/` | Android-обёртка (WebView), `web/` упаковывается в assets |

## Сборка APK

Локально (нужен Android SDK + JDK 17):

```bash
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Или GitHub Actions: workflow **Build APK** собирает APK на каждый push — скачай артефакт `claude-dash-apk`
со страницы запуска (вкладка Actions).

## Свои герои

Положи PNG с прозрачным фоном в `web/img/` и добавь запись в массив `CHARS` в `web/game.js`.
