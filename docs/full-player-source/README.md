# Noctra — исходник окна «Полноэкранный плеер»

Это выжимка **текущего** кода мобильного плеера из проекта `noctra-android`.
Файлы не самостоятельные: окно собирается из базового DOM Muriel + мобильных
скриптов + CSS-оверрайдов. Ниже — карта, что где лежит.

## Файлы

| Файл | Что внутри |
|---|---|
| `player-markup.html` | Базовый DOM: `#right-panel`, обложка, мета, текст, очередь и `.playbar-center` |
| `player.js` | Мобильные IIFE: волны, бейдж/XP, Speed & Pitch, режим текста, шапка плеера, таймлайн |
| `player.css` | Все мобильные CSS-фрагменты плеера в порядке применения + финальный слой |
| `now-playing-polish.css` | Новый финальный CSS-слой, подключается после `mobile.css` |
| `now-playing-integration.css` | Небольшой мост: применяет значения нового слоя там, где старые правила мешают через `!important` |

## Как окно собирается

```
#right-panel                      <- index.html:2021-2087, открывается классом body.np-open
├── #noctra-np-head               <- player.js:2520-2539 (вставляется первым)
├── .drawer-tabs                  <- базовый Muriel; скрывается в мобильном плеере
└── #drawer-now
    ├── .right-panel-header       <- скрывается в cover-режиме
    ├── #right-panel-artwork-box
    │   ├── #cover-container
    │   │   ├── .right-panel-cover
    │   │   └── #np-profile-badge <- player.js:1246-1276
    │   ├── .right-panel-meta
    │   └── #noctra-show-lyrics   <- player.js:2080-2121
    └── .lyrics-section          <- показывается в body.np-lyrics-mode

#playbar                           <- всегда в DOM, в np-open становится нижним доком
├── #noctra-full-wave              <- player.js:957-1040
└── .playbar-center
    ├── #np-tempo-panel            <- player.js:1277-1332
    ├── #np-thick-timeline         <- player.js:2541-2582
    ├── .playback-controls         <- базовые кнопки Muriel
    └── .scrubber-bar-wrapper      <- скрыт в np-open
```

Ключевые состояния на `<body>`:

- `np-open` — полноэкранный плеер открыт;
- `np-lyrics-mode` — вместо большой обложки показывается текст;
- `mobile-side-nav` / `mobile-side-nav-open` — боковое меню (не относится к плееру).

## JS, который управляет окном

Помимо файлов в этой папке, состояние и действия приходят из `app.js`:

- `window.MurielCore.state.currentTrack` — текущий трек;
- `window.MurielCore.audio` — `<audio>`/движок;
- `MurielCore.seek(seconds)`, `togglePlay()`, `next()`, `prev()`;
- `MurielCore.audioTempo()`, `setTempoSpeed(value)`, `setTempoPitch(value)`;
- `window.NoctraWaveRenderer` — общий Canvas-рендерер волн;
- `window.NoctraXP.total()` и `window.NoctraXP.rankFor(xp)` — уровень для бейджа.

## CSS

`player.css` — это **мобильные оверрайды** в том порядке, в котором они
подключаются: `styles.css` → `mobile.css` → `now-playing-polish.css` →
`now-playing-integration.css`. Новый слой специально идёт после `mobile.css`,
чтобы переопределять размеры обложки, нижний док и типографику плеера, а
`now-playing-integration.css` доводит до конца те свойства, которые старые
правила перебивали через `!important`.
Базовые стили, которые они переопределяют, лежат в `styles.css`:

- `.right-panel` — `styles.css:1869`;
- `.cover-container` — `styles.css:2001`;
- `.right-panel-title` / `.right-panel-artist` — `styles.css:2073/2081`;
- `.playbar` — `styles.css:2354`;
- `.playbar-center` — `styles.css:2463`;
- `.playback-controls` — `styles.css:2472`;
- `.btn-play-pause` — `styles.css:2535`;
- `.scrubber-bar-wrapper` — `styles.css` (селектор рядом с `.playbar-center`).

Порядок в `player.css` — тот же, что в `mobile/mobile.css`: поздние правила
намеренно перебивают ранние (`!important`), поэтому при правках лучше добавлять
новое правило в конец `mobile/mobile.css`, а не менять базовый `styles.css`.

## Быстрые ориентиры по размерам/логике

- Размер обложки в cover-режиме: `min(82vw, 306px)`.
- Контейнер обложки: full-bleed, `calc(100% + 36px)` с отступами `-18px`.
- Свечение: `radial-gradient` 170vw + `blur(40px)`, без жёсткого `0 0 0 1px` ring.
- Таймлайн: `#np-thick-timeline input` с `--p` (0–100%), трек 8px, ползунок 17px.
- Speed & Pitch: пресеты 0.8–1.35, шаг 0.05, значение хранится в аудио-движке.
- Волна: Canvas, 4 стиля из `localStorage.noctra_wave_style`.
