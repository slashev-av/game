// «Побег из комнаты» — вся логика игры. Без сборки и модулей: открывается двойным кликом по index.html.
(() => {
  'use strict';

  // ---------- Константы ----------
  const TILE = 32;
  const COLS = 25;
  const ROWS = 17;
  const W = COLS * TILE;
  const H = ROWS * TILE;

  const FLOOR = 0;
  const WALL = 1;
  const DOOR = 2;

  const PLAYER_HALF = 9;       // половина стороны хитбокса игрока, px
  const PLAYER_SPEED = 140;    // px/с
  const SEARCH_TIME = 0.6;     // сколько секунд держать E, чтобы обыскать предмет
  const SEARCH_RANGE = TILE * 1.25;
  const SENSE_RANGE = 12;      // на каком расстоянии (в тайлах) «чутьё» начинает реагировать
  const MEMORY_DARK = 0.8;     // затемнение уже виденных, но сейчас не освещённых тайлов

  const CONTAINER_TYPES = ['chest', 'barrel', 'crate', 'vase', 'shelf'];

  // Монстры: в каждой комнате живёт один, и мешает он по-своему. speed — px/с (игрок — 140)
  const MONSTERS = {
    ghost: { name: 'Призрак', hint: 'проходит сквозь стены и уносит тебя в начало комнаты', speed: 48 },
    goblin: { name: 'Гоблин-вор', hint: 'отбирает найденный ключ и перепрятывает его', speed: 92 },
    slime: { name: 'Слизень', hint: 'оставляет липкий след, в котором трудно идти', speed: 62 },
    shadow: { name: 'Тень', hint: 'гасит свет рядом с собой и стирает память о комнате', speed: 68 },
    poltergeist: { name: 'Полтергейст', hint: 'захлопывает обысканные предметы и перепрятывает ключи', speed: 95 },
    spider: { name: 'Паук', hint: 'плетёт паутину и больно кусается', speed: 78 },
  };
  const MONSTER_TOUCH = 18;    // на каком расстоянии (px) монстр «достаёт» игрока
  const MONSTER_SPAWN_DIST = 9; // минимум шагов от игрока при появлении монстра
  const SLIME_LIFE = 12;       // сколько секунд держится слизь
  const SLIME_SLOWDOWN = 0.4;
  const WEB_INTERVAL = 2.5;    // как часто паук плетёт паутину, с
  const WEB_MAX = 14;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hudLevel = document.getElementById('hud-level');
  const hudKeys = document.getElementById('hud-keys');
  const hudTime = document.getElementById('hud-time');
  const senseFill = document.getElementById('sense-fill');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const overlayBtn = document.getElementById('overlay-btn');
  const monsterInfo = document.getElementById('monster-info');
  const joystickEl = document.getElementById('joystick');
  const joystickKnob = document.getElementById('joystick-knob');
  const btnSearch = document.getElementById('btn-search');
  const btnRestart = document.getElementById('btn-restart');

  // Статичная часть карты (пол и стены) рисуется один раз на уровень
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = W;
  mapCanvas.height = H;
  const mapCtx = mapCanvas.getContext('2d');

  // Туман: 1 пиксель = 1 тайл, при растяжении сглаживается в мягкий свет
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = COLS;
  fogCanvas.height = ROWS;
  const fogCtx = fogCanvas.getContext('2d');
  const fogImage = fogCtx.createImageData(COLS, ROWS);

  // ---------- Состояние ----------
  let state = 'menu';          // 'menu' | 'play' | 'won'
  let level = 1;
  let grid = [];               // grid[y][x] = FLOOR | WALL | DOOR
  let containers = [];         // {x, y, type, hasKey, opened}
  let containerAt = [];        // containerAt[y][x] = контейнер или null
  let door = { x: 0, y: 0 };
  let player = { x: 0, y: 0, dirX: 0, dirY: 1, walk: 0, stun: 0, blind: 0 };
  let startPos = { x: 0, y: 0 }; // куда призрак возвращает игрока, px
  let monster = null;          // {type, x, y, tx, ty, prevX, prevY, speed, anim, timer, wait, target}
  let pathDist = [];           // pathDist[y][x] — шагов от игрока до тайла (-1 — не дойти)
  let slime = [];              // slime[y][x] — сколько секунд ещё продержится слизь
  let webs = [];               // паутина паука: [{x, y}]
  let monsterBag = [];         // ещё не встречавшиеся монстры (чтобы не повторялись)
  let lastMonster = null;
  const monsterByLevel = {};   // при перезапуске комнаты (R) монстр остаётся тем же
  let keysTotal = 0;
  let keysFound = 0;
  let time = 0;
  let lightRadius = 5;
  let seen = [];               // seen[y][x] — игрок уже видел этот тайл
  let fogAlpha = [];           // текущая плотность тумана по тайлам (плавно догоняет целевую)
  let search = { target: null, progress: 0 };
  let floaters = [];           // всплывающие надписи {x, y, text, color, age}

  const keysDown = new Set();

  // Сенсорный джойстик: id — палец, который его держит; x, y — отклонение от -1 до 1
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const JOY_RADIUS = 45;       // ход джойстика, px экрана
  let isTouch = false;
  let infoTimer = 0;
  // на телефоне в портретной ориентации показывается просьба повернуть экран, игра на паузе
  const portraitPhone = window.matchMedia('(orientation: portrait) and (pointer: coarse)');

  // ---------- Утилиты ----------
  const rand = (n) => Math.floor(Math.random() * n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function loadBest(lvl) {
    try {
      const v = parseFloat(localStorage.getItem('escape-best-' + lvl));
      return isNaN(v) ? null : v;
    } catch (e) {
      return null;
    }
  }

  function saveBest(lvl, t) {
    try {
      localStorage.setItem('escape-best-' + lvl, String(t));
    } catch (e) {
      // localStorage может быть недоступен — рекорд просто не сохранится
    }
  }

  // ---------- Звук ----------
  let audio = null;

  function beep(freq, duration, type, delay) {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audio.currentTime + (delay || 0);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + duration);
    } catch (e) {
      // без звука играть тоже можно
    }
  }

  const sfx = {
    key: () => { beep(880, 0.12); beep(1320, 0.2, 'square', 0.1); },
    empty: () => beep(180, 0.15, 'triangle'),
    unlock: () => { beep(523, 0.12, 'square', 0.3); beep(659, 0.12, 'square', 0.42); beep(784, 0.25, 'square', 0.54); },
    win: () => { beep(784, 0.12); beep(988, 0.12, 'square', 0.12); beep(1175, 0.12, 'square', 0.24); beep(1568, 0.35, 'square', 0.36); },
    hit: () => { beep(140, 0.25, 'sawtooth'); beep(90, 0.3, 'sawtooth', 0.12); },
    rattle: () => { beep(150, 0.07); beep(110, 0.07, 'square', 0.09); beep(150, 0.07, 'square', 0.18); },
  };

  // ---------- Генерация уровня ----------
  function generateLevel(lvl) {
    const keyCount = Math.min(2 + lvl, 7);
    const containerCount = Math.min(keyCount * 2 + 3 + lvl, 22);

    for (let attempt = 0; attempt < 500; attempt++) {
      const g = [];
      for (let y = 0; y < ROWS; y++) {
        g.push([]);
        for (let x = 0; x < COLS; x++) {
          g[y].push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? WALL : FLOOR);
        }
      }

      // Внутренние перегородки. Кольцо вдоль внешних стен всегда остаётся свободным.
      const segments = 8 + rand(5);
      for (let i = 0; i < segments; i++) {
        let x = 2 + rand(COLS - 4);
        let y = 2 + rand(ROWS - 4);
        const horizontal = Math.random() < 0.5;
        const len = 3 + rand(6);
        for (let j = 0; j < len; j++) {
          if (x > COLS - 3 || y > ROWS - 3) break;
          g[y][x] = WALL;
          if (horizontal) x++; else y++;
        }
      }

      // Дверь на внешней стене
      const d = { x: 0, y: 0 };
      const inner = { x: 0, y: 0 };
      const side = rand(4);
      if (side < 2) {
        d.x = inner.x = 1 + rand(COLS - 2);
        d.y = side === 0 ? 0 : ROWS - 1;
        inner.y = side === 0 ? 1 : ROWS - 2;
      } else {
        d.y = inner.y = 1 + rand(ROWS - 2);
        d.x = side === 2 ? 0 : COLS - 1;
        inner.x = side === 2 ? 1 : COLS - 2;
      }
      g[d.y][d.x] = DOOR;

      // Старт — подальше от двери
      const floors = [];
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
          if (g[y][x] === FLOOR) floors.push({ x, y });
        }
      }
      const farFloors = floors.filter((t) => Math.abs(t.x - d.x) + Math.abs(t.y - d.y) > 10);
      if (farFloors.length === 0) continue;
      const start = farFloors[rand(farFloors.length)];

      // Предметы, в которых могут лежать ключи
      const free = floors.filter((t) =>
        !(t.x === inner.x && t.y === inner.y) &&
        Math.max(Math.abs(t.x - start.x), Math.abs(t.y - start.y)) > 1);
      const hasWallNeighbor = (t) =>
        g[t.y - 1][t.x] === WALL || g[t.y + 1][t.x] === WALL ||
        g[t.y][t.x - 1] === WALL || g[t.y][t.x + 1] === WALL;
      const nearWall = free.filter(hasWallNeighbor);

      const at = [];
      for (let y = 0; y < ROWS; y++) at.push(new Array(COLS).fill(null));
      const list = [];
      let guard = 0;
      while (list.length < containerCount && guard++ < 2000) {
        // чаще ставим предметы у стен — так комната выглядит естественнее
        const pool = Math.random() < 0.7 && nearWall.length ? nearWall : free;
        const t = pool[rand(pool.length)];
        if (at[t.y][t.x]) continue;
        const c = { x: t.x, y: t.y, type: CONTAINER_TYPES[rand(CONTAINER_TYPES.length)], hasKey: false, opened: false };
        at[t.y][t.x] = c;
        list.push(c);
      }
      if (list.length < containerCount) continue;

      // Проверка проходимости: до двери и до каждого предмета можно дойти
      const reached = [];
      for (let y = 0; y < ROWS; y++) reached.push(new Array(COLS).fill(false));
      const queue = [start];
      reached[start.y][start.x] = true;
      while (queue.length) {
        const t = queue.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = t.x + dx;
          const ny = t.y + dy;
          if (g[ny][nx] !== FLOOR || at[ny][nx] || reached[ny][nx]) continue;
          reached[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
      if (!reached[inner.y][inner.x]) continue;
      const allReachable = list.every((c) =>
        reached[c.y - 1][c.x] || reached[c.y + 1][c.x] || reached[c.y][c.x - 1] || reached[c.y][c.x + 1]);
      if (!allReachable) continue;

      // Прячем ключи
      const shuffled = list.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < keyCount; i++) shuffled[i].hasKey = true;

      return { grid: g, containers: list, containerAt: at, door: d, start, keyCount };
    }
    throw new Error('Не удалось сгенерировать уровень');
  }

  function startLevel(lvl) {
    level = lvl;
    const data = generateLevel(lvl);
    grid = data.grid;
    containers = data.containers;
    containerAt = data.containerAt;
    door = data.door;
    keysTotal = data.keyCount;
    keysFound = 0;
    time = 0;
    lightRadius = Math.max(3.2, 5.25 - lvl * 0.25);
    player = {
      x: (data.start.x + 0.5) * TILE,
      y: (data.start.y + 0.5) * TILE,
      dirX: 0, dirY: 1, walk: 0, stun: 0, blind: 0,
    };
    startPos = { x: player.x, y: player.y };
    seen = [];
    fogAlpha = [];
    pathDist = [];
    slime = [];
    webs = [];
    for (let y = 0; y < ROWS; y++) {
      seen.push(new Array(COLS).fill(false));
      fogAlpha.push(new Array(COLS).fill(1));
      pathDist.push(new Array(COLS).fill(-1));
      slime.push(new Array(COLS).fill(0));
    }
    search = { target: null, progress: 0 };
    floaters = [];
    spawnMonster(pickMonsterType(lvl));
    renderMap();
    updateHud();
    state = 'play';
    overlay.classList.add('hidden');
  }

  // ---------- Логика ----------
  const doorUnlocked = () => keysFound >= keysTotal;

  function solid(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
    const t = grid[ty][tx];
    if (t === WALL) return true;
    if (t === DOOR) return !doorUnlocked();
    return containerAt[ty][tx] !== null;
  }

  function blocked(x, y) {
    const x0 = Math.floor((x - PLAYER_HALF) / TILE);
    const x1 = Math.floor((x + PLAYER_HALF) / TILE);
    const y0 = Math.floor((y - PLAYER_HALF) / TILE);
    const y1 = Math.floor((y + PLAYER_HALF) / TILE);
    return solid(x0, y0) || solid(x1, y0) || solid(x0, y1) || solid(x1, y1);
  }

  function nearestSearchable() {
    let best = null;
    let bestDist = SEARCH_RANGE;
    for (const c of containers) {
      if (c.opened) continue;
      const d = Math.hypot((c.x + 0.5) * TILE - player.x, (c.y + 0.5) * TILE - player.y);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  function openContainer(c) {
    c.opened = true;
    const fx = (c.x + 0.5) * TILE;
    const fy = c.y * TILE;
    if (c.hasKey) {
      keysFound++;
      sfx.key();
      floaters.push({ x: fx, y: fy, text: '🗝 Ключ!', color: '#ffd54a', age: 0 });
      if (doorUnlocked()) {
        sfx.unlock();
        floaters.push({ x: player.x, y: player.y - 30, text: 'Дверь открыта!', color: '#9cff9c', age: -0.5 });
      }
    } else {
      sfx.empty();
      floaters.push({ x: fx, y: fy, text: 'Пусто', color: '#b9b2cc', age: 0 });
    }
    updateHud();
  }

  // ---------- Монстры ----------
  function pickMonsterType(lvl) {
    // для отладки: index.html#spider принудительно ставит нужного монстра
    const forced = location.hash.slice(1);
    if (MONSTERS[forced]) return forced;
    if (!monsterByLevel[lvl]) {
      if (monsterBag.length === 0) {
        // все монстры уже встречались — начинаем новый круг, но не с того же самого
        monsterBag = Object.keys(MONSTERS).sort(() => Math.random() - 0.5);
        if (monsterBag[monsterBag.length - 1] === lastMonster) monsterBag.reverse();
      }
      lastMonster = monsterBag.pop();
      monsterByLevel[lvl] = lastMonster;
    }
    return monsterByLevel[lvl];
  }

  // Поиск в ширину от игрока: по этому полю расстояний ходят монстры
  function updatePathDist() {
    for (let y = 0; y < ROWS; y++) pathDist[y].fill(-1);
    const sx = Math.floor(player.x / TILE);
    const sy = Math.floor(player.y / TILE);
    if (grid[sy][sx] !== FLOOR) return;
    pathDist[sy][sx] = 0;
    const queue = [sx, sy];
    for (let i = 0; i < queue.length; i += 2) {
      const x = queue[i];
      const y = queue[i + 1];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (grid[ny][nx] !== FLOOR || containerAt[ny][nx] || pathDist[ny][nx] >= 0) continue;
        pathDist[ny][nx] = pathDist[y][x] + 1;
        queue.push(nx, ny);
      }
    }
  }

  // Случайный тайл подальше от игрока (если далёких нет — самый дальний из достижимых)
  function farTile() {
    const far = [];
    let farthest = { x: Math.floor(player.x / TILE), y: Math.floor(player.y / TILE) };
    let maxDist = 0;
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const d = pathDist[y][x];
        if (d >= MONSTER_SPAWN_DIST) far.push({ x, y });
        if (d > maxDist) {
          maxDist = d;
          farthest = { x, y };
        }
      }
    }
    return far.length ? far[rand(far.length)] : farthest;
  }

  function placeMonster(m) {
    updatePathDist();
    const t = farTile();
    m.tx = m.prevX = t.x;
    m.ty = m.prevY = t.y;
    m.x = (t.x + 0.5) * TILE;
    m.y = (t.y + 0.5) * TILE;
    m.target = null;
    m.wait = 0;
  }

  function spawnMonster(type) {
    const def = MONSTERS[type];
    // с каждым уровнем монстры немного быстрее
    const speed = def.speed * Math.min(1.4, 1 + (level - 1) * 0.04);
    monster = { type, x: 0, y: 0, tx: 0, ty: 0, prevX: 0, prevY: 0, speed, anim: 0, timer: WEB_INTERVAL, wait: 0, target: null };
    placeMonster(monster);
    monsterInfo.textContent = 'В этой комнате: ' + def.name + ' — ' + def.hint + '.';
    // на низких экранах описание лежит поверх поля и через несколько секунд гаснет (см. style.css)
    monsterInfo.classList.remove('faded');
    clearTimeout(infoTimer);
    infoTimer = setTimeout(() => monsterInfo.classList.add('faded'), 6000);
  }

  // Шаг в сторону игрока по полю расстояний
  function chaseStep(m) {
    let best = null;
    let bestDist = pathDist[m.ty][m.tx] < 0 ? Infinity : pathDist[m.ty][m.tx];
    for (const [dx, dy] of DIRS) {
      const d = pathDist[m.ty + dy][m.tx + dx];
      if (d >= 0 && d < bestDist) {
        bestDist = d;
        best = { x: m.tx + dx, y: m.ty + dy };
      }
    }
    return best;
  }

  // Случайный шаг; назад разворачиваемся, только если больше некуда
  function wanderStep(m) {
    let options = [];
    for (const [dx, dy] of DIRS) {
      if (pathDist[m.ty + dy][m.tx + dx] >= 0) options.push({ x: m.tx + dx, y: m.ty + dy });
    }
    const forward = options.filter((t) => t.x !== m.prevX || t.y !== m.prevY);
    if (forward.length) options = forward;
    return options.length ? options[rand(options.length)] : null;
  }

  // Движение по прямой к точке; true — дошли
  function flyTo(m, gx, gy, dt) {
    const d = Math.hypot(gx - m.x, gy - m.y);
    const step = m.speed * dt;
    if (d <= step) {
      m.x = gx;
      m.y = gy;
      return true;
    }
    m.x += ((gx - m.x) / d) * step;
    m.y += ((gy - m.y) / d) * step;
    return false;
  }

  // Движение по тайлам: дошли до центра тайла — выбираем следующий через next(m)
  function walkMonster(m, dt, next) {
    if (!flyTo(m, (m.tx + 0.5) * TILE, (m.ty + 0.5) * TILE, dt)) return;
    const n = next(m);
    if (n) {
      m.prevX = m.tx;
      m.prevY = m.ty;
      m.tx = n.x;
      m.ty = n.y;
    }
  }

  function say(text) {
    floaters.push({ x: player.x, y: player.y - 24, text, color: '#ff8a80', age: 0 });
  }

  // Прячет ключ в случайный предмет: сперва в необысканный, а если таких нет — в уже открытый (он закрывается)
  function hideKey(exclude) {
    let pool = containers.filter((c) => !c.opened && !c.hasKey && c !== exclude);
    if (pool.length === 0) pool = containers.filter((c) => c.opened);
    if (pool.length === 0) pool = containers.filter((c) => c !== exclude);
    const c = pool[rand(pool.length)];
    c.hasKey = true;
    c.opened = false;
  }

  function updatePoltergeist(m, dt) {
    if (m.wait > 0) {
      m.wait -= dt;
      return;
    }
    if (!m.target) {
      // чаще летит туда, где может напакостить: к открытым предметам и к ключам
      const interesting = containers.filter((c) => c.opened || c.hasKey);
      const pool = interesting.length && Math.random() < 0.75 ? interesting : containers;
      m.target = pool[rand(pool.length)];
    }
    const c = m.target;
    if (!flyTo(m, (c.x + 0.5) * TILE, (c.y + 0.5) * TILE, dt)) return;
    let acted = false;
    if (c.opened) {
      // захлопывает обысканный предмет — теперь не понять, смотрел ты в него или нет
      c.opened = false;
      c.hasKey = false;
      acted = true;
    } else if (c.hasKey) {
      c.hasKey = false;
      hideKey(c);
      acted = true;
    }
    if (acted) {
      sfx.rattle();
      floaters.push({ x: m.x, y: m.y - 16, text: 'Что-то загремело…', color: '#b388ff', age: 0 });
    }
    m.target = null;
    m.wait = 5;
  }

  function monsterTouch(m) {
    sfx.hit();
    switch (m.type) {
      case 'ghost':
        player.x = startPos.x;
        player.y = startPos.y;
        player.stun = 0.8;
        say('Призрак унёс тебя в начало!');
        break;
      case 'goblin':
        if (keysFound > 0) {
          keysFound--;
          hideKey(null);
          updateHud();
          say('Гоблин украл ключ и перепрятал!');
        } else {
          say('Гоблин толкнул тебя!');
        }
        player.stun = 0.7;
        break;
      case 'slime':
        player.stun = 1.5;
        say('Прилип к слизню!');
        break;
      case 'shadow':
        player.blind = 5;
        for (let y = 0; y < ROWS; y++) seen[y].fill(false);
        say('Тень погасила свет!');
        break;
      default: // spider
        player.stun = 2;
        say('Паук укусил!');
    }
    search = { target: null, progress: 0 };
    // после нападения монстр исчезает и появляется вдали — есть время прийти в себя
    placeMonster(m);
  }

  function updateMonster(dt) {
    const m = monster;
    m.anim += dt;
    updatePathDist();

    switch (m.type) {
      case 'ghost':
        flyTo(m, player.x, player.y, dt);
        break;
      case 'goblin':
        // пока красть нечего — просто бродит
        walkMonster(m, dt, keysFound > 0 ? chaseStep : wanderStep);
        break;
      case 'slime':
        walkMonster(m, dt, (mm) => (Math.random() < 0.6 && chaseStep(mm)) || wanderStep(mm));
        slime[Math.floor(m.y / TILE)][Math.floor(m.x / TILE)] = SLIME_LIFE;
        break;
      case 'poltergeist':
        updatePoltergeist(m, dt);
        break;
      case 'spider': {
        walkMonster(m, dt, chaseStep);
        m.timer -= dt;
        const wx = Math.floor(m.x / TILE);
        const wy = Math.floor(m.y / TILE);
        if (m.timer <= 0 && pathDist[wy][wx] > 0 && !webs.some((w) => w.x === wx && w.y === wy)) {
          webs.push({ x: wx, y: wy });
          if (webs.length > WEB_MAX) webs.shift();
          m.timer = WEB_INTERVAL;
        }
        break;
      }
      default: // shadow
        walkMonster(m, dt, chaseStep);
    }

    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (slime[y][x] > 0) slime[y][x] -= dt;
      }
    }

    // полтергейст игрока не трогает — он вредит издалека
    if (m.type !== 'poltergeist' && Math.hypot(m.x - player.x, m.y - player.y) < MONSTER_TOUCH) {
      monsterTouch(m);
    }
  }

  // Радиус света с учётом Тени: рядом с ней темнее, а после её касания почти ничего не видно
  function currentLight() {
    let r = lightRadius;
    if (monster.type === 'shadow') {
      const d = Math.hypot(monster.x - player.x, monster.y - player.y) / TILE;
      r *= clamp(d / 6, 0.45, 1);
    }
    if (player.blind > 0) r = Math.min(r, 1.5);
    return r;
  }

  function update(dt) {
    time += dt;
    player.stun = Math.max(0, player.stun - dt);
    player.blind = Math.max(0, player.blind - dt);

    // Движение
    let mx = 0;
    let my = 0;
    if (player.stun === 0) {
      if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) mx -= 1;
      if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) mx += 1;
      if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) my -= 1;
      if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) my += 1;
      if (mx || my) {
        const len = Math.hypot(mx, my);
        mx /= len;
        my /= len;
      } else {
        mx = joy.x;
        my = joy.y;
      }
    }
    player.moving = mx !== 0 || my !== 0;
    if (player.moving) {
      player.dirX = mx;
      player.dirY = my;
      player.walk += dt * 10;
      const inSlime = slime[Math.floor(player.y / TILE)][Math.floor(player.x / TILE)] > 0;
      const speed = PLAYER_SPEED * (inSlime ? SLIME_SLOWDOWN : 1);
      const nx = player.x + mx * speed * dt;
      if (!blocked(nx, player.y)) player.x = nx;
      const ny = player.y + my * speed * dt;
      if (!blocked(player.x, ny)) player.y = ny;

      // Паутина держит, пока не порвёшь
      const ptx = Math.floor(player.x / TILE);
      const pty = Math.floor(player.y / TILE);
      const web = webs.findIndex((w) => w.x === ptx && w.y === pty);
      if (web >= 0) {
        webs.splice(web, 1);
        player.stun = 1.3;
        say('Запутался в паутине!');
      }
    }

    updateMonster(dt);

    // Обыск
    const target = nearestSearchable();
    const holding = keysDown.has('KeyE') || keysDown.has('Space');
    if (target && holding) {
      if (search.target !== target) search = { target, progress: 0 };
      search.progress += dt / SEARCH_TIME;
      if (search.progress >= 1) {
        openContainer(target);
        search = { target: null, progress: 0 };
      }
    } else {
      search = { target, progress: 0 };
    }

    // Всплывающие надписи
    for (const f of floaters) f.age += dt;
    floaters = floaters.filter((f) => f.age < 1.4);

    updateFog(dt);
    updateSense();
    hudTime.textContent = formatTime(time);

    // Выход через открытую дверь
    if (Math.floor(player.x / TILE) === door.x && Math.floor(player.y / TILE) === door.y) {
      winLevel();
    }
  }

  function winLevel() {
    state = 'won';
    sfx.win();
    const best = loadBest(level);
    const isRecord = best === null || time < best;
    if (isRecord) saveBest(level, time);
    showOverlay(
      'Ты выбрался!',
      'Уровень ' + level + ' пройден за ' + formatTime(time) + '.\n' +
      (isRecord ? 'Это новый рекорд!' : 'Рекорд: ' + formatTime(best)) +
      '\nДальше комната темнее, ключей больше, и живёт там уже другой монстр.',
      'Следующий уровень');
  }

  // Луч от игрока до центра тайла; стены его останавливают
  function hasLineOfSight(px, py, tx, ty) {
    const dx = tx + 0.5 - px;
    const dy = ty + 0.5 - py;
    const steps = Math.ceil(Math.hypot(dx, dy) / 0.2);
    for (let i = 1; i < steps; i++) {
      const x = Math.floor(px + (dx * i) / steps);
      const y = Math.floor(py + (dy * i) / steps);
      if (x === tx && y === ty) return true;
      if (grid[y][x] !== FLOOR) return false;
    }
    return true;
  }

  function updateFog(dt) {
    const px = player.x / TILE;
    const py = player.y / TILE;
    const radius = currentLight();
    const lit = [];
    for (let y = 0; y < ROWS; y++) lit.push(new Array(COLS).fill(false));

    // Сначала пол, потом стены: стена освещена, если освещён соседний пол
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (grid[y][x] !== FLOOR) continue;
        if (Math.hypot(x + 0.5 - px, y + 0.5 - py) > radius) continue;
        lit[y][x] = hasLineOfSight(px, py, x, y);
      }
    }
    const wallLit = [];
    for (let y = 0; y < ROWS; y++) {
      wallLit.push(new Array(COLS).fill(false));
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] === FLOOR) continue;
        for (let dy = -1; dy <= 1 && !wallLit[y][x]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || nx < 0 || ny >= ROWS || nx >= COLS) continue;
            if (lit[ny][nx]) {
              wallLit[y][x] = true;
              break;
            }
          }
        }
      }
    }

    const data = fogImage.data;
    const k = Math.min(1, dt * 10);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        let target;
        if (lit[y][x] || wallLit[y][x]) {
          seen[y][x] = true;
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py) / radius;
          target = clamp(Math.pow(d, 3), 0, 1) * MEMORY_DARK;
        } else {
          target = seen[y][x] ? MEMORY_DARK : 1;
        }
        // Открытая дверь светится сама — чтобы её было легко найти
        if (grid[y][x] === DOOR && doorUnlocked() && seen[y][x]) target = 0;
        fogAlpha[y][x] += (target - fogAlpha[y][x]) * k;

        const i = (y * COLS + x) * 4;
        data[i] = 6;
        data[i + 1] = 5;
        data[i + 2] = 14;
        data[i + 3] = Math.round(fogAlpha[y][x] * 255);
      }
    }
    fogCtx.putImageData(fogImage, 0, 0);
  }

  function updateSense() {
    let nearest = Infinity;
    for (const c of containers) {
      if (!c.hasKey || c.opened) continue;
      const d = Math.hypot(c.x + 0.5 - player.x / TILE, c.y + 0.5 - player.y / TILE);
      if (d < nearest) nearest = d;
    }
    const warmth = nearest === Infinity ? 0 : clamp(1 - (nearest - 1) / SENSE_RANGE, 0, 1);
    senseFill.style.width = Math.round(warmth * 100) + '%';
  }

  function updateHud() {
    hudLevel.textContent = 'Уровень ' + level;
    hudKeys.textContent = '🗝 ' + keysFound + ' / ' + keysTotal;
  }

  function showOverlay(title, text, button) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = button;
    overlay.classList.remove('hidden');
    overlayBtn.focus();
    releaseJoystick();
  }

  // ---------- Отрисовка ----------
  function renderMap() {
    const c = mapCtx;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (grid[y][x] === FLOOR) {
          c.fillStyle = (x + y) % 2 ? '#4a4360' : '#443d59';
          c.fillRect(px, py, TILE, TILE);
          c.strokeStyle = 'rgba(0,0,0,0.18)';
          c.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        } else {
          // кирпичная кладка
          c.fillStyle = '#7a6252';
          c.fillRect(px, py, TILE, TILE);
          c.fillStyle = '#5c4a3e';
          for (let row = 0; row < 4; row++) {
            c.fillRect(px, py + row * 8 + 7, TILE, 1);
            const shift = row % 2 ? 8 : 0;
            c.fillRect(px + shift + 7, py + row * 8, 1, 8);
            c.fillRect(px + shift + 23, py + row * 8, 1, 8);
          }
          c.fillStyle = 'rgba(255,255,255,0.08)';
          c.fillRect(px, py, TILE, 2);
        }
      }
    }
  }

  function drawDoor() {
    const px = door.x * TILE;
    const py = door.y * TILE;
    ctx.fillStyle = '#2a211b';
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    if (doorUnlocked()) {
      const pulse = 0.75 + Math.sin(time * 5) * 0.25;
      ctx.fillStyle = 'rgba(255, 233, 160, ' + pulse + ')';
      ctx.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
    } else {
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(px + 5, py + 5, TILE - 10, TILE - 10);
      ctx.fillStyle = '#6e4520';
      ctx.fillRect(px + 12, py + 5, 1, TILE - 10);
      ctx.fillRect(px + 19, py + 5, 1, TILE - 10);
      // замок
      ctx.fillStyle = '#ffd54a';
      ctx.fillRect(px + 12, py + 15, 8, 7);
      ctx.strokeStyle = '#ffd54a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + 16, py + 15, 3, Math.PI, 0);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  function drawContainer(c) {
    const px = c.x * TILE;
    const py = c.y * TILE;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(px + 16, py + 28, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    switch (c.type) {
      case 'chest':
        ctx.fillStyle = '#9a6331';
        ctx.fillRect(px + 4, py + 12, 24, 15);
        ctx.fillStyle = c.opened ? '#2a1c10' : '#b57a3e';
        ctx.fillRect(px + 4, py + 7, 24, 7);
        ctx.fillStyle = '#e0b84a';
        ctx.fillRect(px + 4, py + 13, 24, 2);
        if (!c.opened) ctx.fillRect(px + 14, py + 14, 4, 5);
        break;
      case 'barrel':
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(px + 7, py + 5, 18, 23);
        ctx.fillStyle = '#a06a35';
        ctx.fillRect(px + 9, py + 5, 4, 23);
        ctx.fillStyle = '#5f5f6a';
        ctx.fillRect(px + 6, py + 9, 20, 2);
        ctx.fillRect(px + 6, py + 22, 20, 2);
        ctx.fillStyle = c.opened ? '#1d130b' : '#b07a42';
        ctx.beginPath();
        ctx.ellipse(px + 16, py + 6, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'crate':
        ctx.fillStyle = '#a8824f';
        ctx.fillRect(px + 5, py + 6, 22, 22);
        ctx.strokeStyle = '#6f5330';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 6, py + 7, 20, 20);
        ctx.beginPath();
        if (c.opened) {
          ctx.fillStyle = '#241a0e';
          ctx.fillRect(px + 8, py + 9, 16, 16);
        } else {
          ctx.moveTo(px + 6, py + 7);
          ctx.lineTo(px + 26, py + 27);
          ctx.moveTo(px + 26, py + 7);
          ctx.lineTo(px + 6, py + 27);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        break;
      case 'vase':
        ctx.fillStyle = '#3f8fb0';
        ctx.beginPath();
        ctx.ellipse(px + 16, py + 19, 9, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(px + 12, py + 6, 8, 7);
        ctx.fillStyle = '#7cc4de';
        ctx.fillRect(px + 10, py + 17, 12, 2);
        ctx.fillStyle = c.opened ? '#0e1c24' : '#2d6e8a';
        ctx.beginPath();
        ctx.ellipse(px + 16, py + 6, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      default: // shelf
        ctx.fillStyle = '#6b4526';
        ctx.fillRect(px + 4, py + 3, 24, 26);
        ctx.fillStyle = '#2b1c10';
        ctx.fillRect(px + 6, py + 5, 20, 6);
        ctx.fillRect(px + 6, py + 13, 20, 6);
        ctx.fillRect(px + 6, py + 21, 20, 6);
        if (!c.opened) {
          const colors = ['#c0504d', '#4f81bd', '#9bbb59', '#e0b84a', '#8064a2'];
          for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 5; i++) {
              ctx.fillStyle = colors[(i + row * 2) % colors.length];
              ctx.fillRect(px + 7 + i * 4, py + 6 + row * 8, 3, 5);
            }
          }
        }
    }
  }

  function drawPlayer() {
    const x = player.x;
    const y = player.y;
    const moving = player.moving ? Math.sin(player.walk) : 0;

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // ноги
    ctx.fillStyle = '#2f3b6b';
    ctx.fillRect(x - 6, y + 4 + moving * 2, 4, 7);
    ctx.fillRect(x + 2, y + 4 - moving * 2, 4, 7);
    // туловище
    ctx.fillStyle = '#e2574c';
    ctx.fillRect(x - 7, y - 4, 14, 10);
    // голова
    ctx.fillStyle = '#f4c9a0';
    ctx.beginPath();
    ctx.arc(x, y - 8, 7, 0, Math.PI * 2);
    ctx.fill();
    // волосы
    ctx.fillStyle = '#5a3a22';
    ctx.beginPath();
    ctx.arc(x, y - 10, 7, Math.PI, 0);
    ctx.fill();
    // глаза смотрят в сторону движения (со спины их не видно)
    if (player.dirY >= 0) {
      ctx.fillStyle = '#222';
      const ox = player.dirX * 2.5;
      ctx.fillRect(x - 3.5 + ox, y - 8, 2, 2);
      ctx.fillRect(x + 1.5 + ox, y - 8, 2, 2);
    }
  }

  // Слизь и паутина на полу
  function drawHazards() {
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if (slime[y][x] <= 0) continue;
        ctx.globalAlpha = Math.min(1, slime[y][x] / 3) * 0.55;
        ctx.fillStyle = '#7ed957';
        ctx.beginPath();
        ctx.ellipse(x * TILE + 16, y * TILE + 16, 14, 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (const w of webs) {
      const cx = w.x * TILE + 16;
      const cy = w.y * TILE + 16;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(cx - Math.cos(a) * 14, cy - Math.sin(a) * 14);
        ctx.lineTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
      }
      for (const r of [5, 10]) {
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
    ctx.stroke();
  }

  function drawMonster() {
    const m = monster;
    const x = m.x;
    const y = m.y;
    const bob = Math.sin(m.anim * 4) * 2;

    switch (m.type) {
      case 'ghost':
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#e8f0ff';
        ctx.beginPath();
        ctx.arc(x, y - 4 + bob, 10, Math.PI, 0);
        ctx.lineTo(x + 10, y + 10 + bob);
        for (let i = 0; i < 4; i++) {
          ctx.lineTo(x + 7.5 - i * 5, y + 6 + bob);
          ctx.lineTo(x + 5 - i * 5, y + 10 + bob);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(x - 5, y - 6 + bob, 3, 4);
        ctx.fillRect(x + 2, y - 6 + bob, 3, 4);
        break;
      case 'goblin':
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + 10, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // мешок с награбленным
        ctx.fillStyle = '#8a6a3a';
        ctx.beginPath();
        ctx.arc(x + 8, y + 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4c7f2e';
        ctx.fillRect(x - 6, y - 2, 12, 11);
        ctx.fillStyle = '#6bb03f';
        ctx.beginPath();
        ctx.arc(x, y - 7, 6, 0, Math.PI * 2);
        // уши
        ctx.moveTo(x - 5, y - 9);
        ctx.lineTo(x - 12, y - 12);
        ctx.lineTo(x - 5, y - 5);
        ctx.moveTo(x + 5, y - 9);
        ctx.lineTo(x + 12, y - 12);
        ctx.lineTo(x + 5, y - 5);
        ctx.fill();
        ctx.fillStyle = '#ffe14a';
        ctx.fillRect(x - 4, y - 8, 2, 2);
        ctx.fillRect(x + 2, y - 8, 2, 2);
        break;
      case 'slime': {
        const squish = Math.sin(m.anim * 6);
        ctx.fillStyle = '#5fbf3a';
        ctx.beginPath();
        ctx.ellipse(x, y + 3, 11 + squish, 9 - squish, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b6f08f';
        ctx.fillRect(x - 6, y - 2, 3, 2);
        ctx.fillStyle = '#12300a';
        ctx.fillRect(x - 3, y + 1, 2, 3);
        ctx.fillRect(x + 2, y + 1, 2, 3);
        break;
      }
      case 'poltergeist':
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#b388ff';
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        for (let i = 0; i < 6; i++) {
          const a = m.anim * 3 + (i * Math.PI) / 3;
          const r = 9 + Math.sin(m.anim * 5 + i) * 3;
          ctx.fillStyle = i % 2 ? '#b388ff' : '#80deea';
          ctx.fillRect(x + Math.cos(a) * r - 1.5, y + Math.sin(a) * r - 1.5, 3, 3);
        }
        break;
      case 'spider':
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const wiggle = Math.sin(m.anim * 12 + i * 1.5) * 2;
          const ly = y + (i - 1.5) * 5;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 12, ly + wiggle);
          ctx.moveTo(x, y);
          ctx.lineTo(x + 12, ly - wiggle);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#1c1c1c';
        ctx.beginPath();
        ctx.arc(x, y - 2, 6, 0, Math.PI * 2);
        ctx.arc(x, y + 5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff3b3b';
        ctx.fillRect(x - 3, y + 5, 2, 2);
        ctx.fillRect(x + 1, y + 5, 2, 2);
        break;
      default: // shadow
        ctx.fillStyle = '#07050d';
        ctx.beginPath();
        ctx.ellipse(x, y + bob * 0.5, 11, 13, 0, 0, Math.PI * 2);
        ctx.fill();
    }
  }

  // Рисуется поверх тумана: глаза Тени светятся в темноте, над оглушённым игроком кружат звёздочки
  function drawOverFog() {
    if (monster.type === 'shadow') {
      ctx.fillStyle = '#d17bff';
      ctx.fillRect(monster.x - 5, monster.y - 4, 3, 2);
      ctx.fillRect(monster.x + 2, monster.y - 4, 3, 2);
    }
    if (player.stun > 0) {
      ctx.fillStyle = '#ffe14a';
      for (let i = 0; i < 3; i++) {
        const a = time * 8 + (i * Math.PI * 2) / 3;
        ctx.fillRect(player.x + Math.cos(a) * 9 - 1.5, player.y - 20 + Math.sin(a) * 3 - 1.5, 3, 3);
      }
    }
  }

  function drawSearchUi() {
    const c = search.target;
    if (!c) return;
    const cx = (c.x + 0.5) * TILE;
    const top = c.y * TILE;
    if (search.progress > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - 17, top - 9, 34, 7);
      ctx.fillStyle = '#ffd54a';
      ctx.fillRect(cx - 16, top - 8, 32 * Math.min(1, search.progress), 5);
    } else {
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - 10, top - 17 + Math.sin(time * 5) * 2, 20, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(isTouch ? '🔍' : 'E', cx, top - 5 + Math.sin(time * 5) * 2);
    }
  }

  function drawFloaters() {
    // на маленьком экране холст сжат — увеличиваем шрифт, чтобы надписи читались
    const fontPx = Math.round(14 * clamp((0.8 * W) / (canvas.clientWidth || W), 1, 2));
    ctx.font = 'bold ' + fontPx + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      if (f.age < 0) continue;
      // не даём длинным надписям вылезти за край холста
      const half = ctx.measureText(f.text).width / 2 + 4;
      const fx = clamp(f.x, half, W - half);
      const fy = Math.max(16, f.y - f.age * 26);
      ctx.globalAlpha = clamp(1.4 - f.age, 0, 1);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, fx + 1, fy + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, fx, fy);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapCanvas, 0, 0);
    drawDoor();
    drawHazards();
    for (const c of containers) drawContainer(c);
    drawPlayer();
    drawMonster();

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCanvas, 0, 0, W, H);

    drawOverFog();

    drawSearchUi();
    drawFloaters();
  }

  // ---------- Главный цикл и ввод ----------
  let lastFrame = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state === 'play' && !portraitPhone.matches) {
      update(dt);
      render();
    }
    requestAnimationFrame(frame);
  }

  // e.code, а не e.key — чтобы управление работало в русской раскладке
  const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyR', 'Space',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

  window.addEventListener('keydown', (e) => {
    if (state !== 'play') return; // на экранах меню Enter/Пробел нажимают кнопку сами
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR' && !e.repeat) {
      startLevel(level);
      return;
    }
    keysDown.add(e.code);
  });

  window.addEventListener('keyup', (e) => keysDown.delete(e.code));
  window.addEventListener('blur', () => keysDown.clear());

  // ---------- Сенсорное управление ----------
  function setTouchMode() {
    if (isTouch) return;
    isTouch = true;
    document.body.classList.add('touch'); // показывает сенсорные кнопки, см. style.css
  }

  function releaseJoystick() {
    joy.id = null;
    joy.x = 0;
    joy.y = 0;
    joystickEl.classList.remove('active');
  }

  function moveJoystick(t) {
    let dx = (t.clientX - joy.ox) / JOY_RADIUS;
    let dy = (t.clientY - joy.oy) / JOY_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    joystickKnob.style.transform = 'translate(' + dx * JOY_RADIUS + 'px, ' + dy * JOY_RADIUS + 'px)';
    // небольшая мёртвая зона; дальше половины хода — полная скорость
    const mag = Math.min(1, len);
    const speed = mag < 0.2 ? 0 : Math.min(1, mag / 0.5);
    joy.x = mag ? (dx / mag) * speed : 0;
    joy.y = mag ? (dy / mag) * speed : 0;
  }

  if (window.matchMedia('(pointer: coarse)').matches) setTouchMode();

  // Джойстик появляется там, где палец коснулся экрана (кроме кнопок)
  window.addEventListener('touchstart', (e) => {
    setTouchMode();
    if (state !== 'play' || e.target.closest('button')) return;
    e.preventDefault();
    if (joy.id !== null) return;
    const t = e.changedTouches[0];
    joy.id = t.identifier;
    joy.ox = t.clientX;
    joy.oy = t.clientY;
    joystickEl.style.left = t.clientX + 'px';
    joystickEl.style.top = t.clientY + 'px';
    joystickEl.classList.add('active');
    moveJoystick(t);
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (state === 'play') e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) moveJoystick(t);
    }
  }, { passive: false });

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) releaseJoystick();
    }
  }
  window.addEventListener('touchend', onTouchEnd);
  window.addEventListener('touchcancel', onTouchEnd);

  // Кнопка обыска работает как удержание клавиши E
  function holdSearch(e) {
    e.preventDefault();
    keysDown.add('KeyE');
    btnSearch.classList.add('pressed');
  }

  function releaseSearch() {
    keysDown.delete('KeyE');
    btnSearch.classList.remove('pressed');
  }
  btnSearch.addEventListener('touchstart', holdSearch, { passive: false });
  btnSearch.addEventListener('touchend', releaseSearch);
  btnSearch.addEventListener('touchcancel', releaseSearch);

  btnRestart.addEventListener('click', () => {
    if (state === 'play') startLevel(level);
  });

  // долгое нажатие на сенсорном экране не должно открывать меню браузера
  window.addEventListener('contextmenu', (e) => {
    if (isTouch) e.preventDefault();
  });

  overlayBtn.addEventListener('click', () => {
    keysDown.clear();
    startLevel(state === 'won' ? level + 1 : level);
  });

  showOverlay(
    'Побег из комнаты',
    'Ты заперт в тёмной комнате. Ключи спрятаны в сундуках, бочках, ящиках, вазах и на полках.\n' +
    'Обыщи предметы, собери все ключи и найди дверь.\n' +
    'Шкала «Чутьё» подскажет, когда ключ рядом.\n' +
    'Осторожно: в каждой комнате живёт свой монстр, и мешает он по-своему.',
    'Начать игру');
  requestAnimationFrame(frame);
})();
