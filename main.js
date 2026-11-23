const { app, BrowserWindow, ipcMain, dialog, Notification, shell, Menu, screen, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// 固定应用名，保证 userData 路径稳定（避免中文目录与改名后丢数据）
app.setName('ScheduleWorkbench');
const FORCE_THEME = (() => {
  const a = process.argv.find((x) => String(x).startsWith('--theme='));
  const v = a ? a.split('=')[1] : '';
  return ['light', 'dark', 'system'].includes(v) ? v : null;
})();

// 自检模式使用独立的临时数据目录，避免污染正式数据
const IS_SMOKE = process.argv.includes('--smoke');
if (IS_SMOKE) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'schedule-workbench-smoke'));
}

// ---------- 数据存储 ----------
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');

const DEFAULT_DATA = () => ({
  version: 1,
  events: [],
  todos: [],
  settings: { notify: true, launchAtLogin: false }
});

let cache = null;
let win = null;

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DATA(),
      ...parsed,
      settings: { ...DEFAULT_DATA().settings, ...(parsed.settings || {}) }
    };
  } catch (e) {
    return DEFAULT_DATA();
  }
}

function writeData(data) {
  cache = data;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    // 保留上一版，误操作时还有一份可回退
    if (fs.existsSync(DATA_FILE)) {
      try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.prev'); } catch (e) { /* 忽略 */ }
    }
    // 原子写入，避免断电写坏文件
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    console.error('写入失败', e);
    return false;
  }
}

// 每天自动备份一份，保留最近 14 天
function dailyBackup() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const today = fmtDate(new Date());
    const jobs = [
      [DATA_FILE, `data-${today}.json`, /^data-\d{4}-\d{2}-\d{2}\.json$/],
      [STUDY_FILE, `study-${today}.json`, /^study-\d{4}-\d{2}-\d{2}\.json$/]
    ];
    jobs.forEach(([src, name, re]) => {
      if (!fs.existsSync(src)) return;
      const target = path.join(dir, name);
      if (!fs.existsSync(target)) fs.copyFileSync(src, target);
      const files = fs.readdirSync(dir).filter((f) => re.test(f)).sort();
      while (files.length > 14) {
        try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) { /* 忽略 */ }
      }
    });
  } catch (e) {
    console.error('自动备份失败', e);
  }
}

// ---------- 学习笔记 ----------
// 独立文件存放：桌面工作台与本地 MCP 服务共用同一份数据，谁写入对方立刻能看到
const STUDY_FILE = path.join(app.getPath('userData'), 'study.json');
const MCP_LAUNCHER_PATH = path.join(__dirname, 'mcp', 'study-mcp');
const MCP_SERVER_PATH = path.join(__dirname, 'mcp', 'study-mcp.js');
const STUDY_SOURCES = ['chatgpt', 'workbuddy', 'book', 'video', 'course', 'other'];
const STUDY_STATUS = ['new', 'learning', 'learned'];

function readStudy() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STUDY_FILE, 'utf8'));
    const notes = Array.isArray(parsed && parsed.notes) ? parsed.notes : [];
    return { version: 1, notes: notes.filter((n) => n && n.id) };
  } catch (e) {
    return { version: 1, notes: [] };
  }
}

function writeStudy(doc) {
  try {
    fs.mkdirSync(path.dirname(STUDY_FILE), { recursive: true });
    if (fs.existsSync(STUDY_FILE)) {
      try { fs.copyFileSync(STUDY_FILE, STUDY_FILE + '.prev'); } catch (e) { /* 忽略 */ }
    }
    const tmp = STUDY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
    fs.renameSync(tmp, STUDY_FILE);
    return true;
  } catch (e) {
    console.error('学习笔记写入失败', e);
    return false;
  }
}

function normalizeTags(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/);
  const seen = [];
  arr.forEach((t) => {
    const s = String(t || '').trim().replace(/^#/, '');
    if (s && !seen.includes(s) && seen.length < 12) seen.push(s);
  });
  return seen;
}

function normalizeNote(raw, now, keepCreated) {
  const src = STUDY_SOURCES.includes(raw.source) ? raw.source : 'other';
  const st = STUDY_STATUS.includes(raw.status) ? raw.status : 'new';
  const reviewAt = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.reviewAt || '')) ? raw.reviewAt : null;
  const n = {
    id: raw.id || null,
    title: String(raw.title || '').trim().slice(0, 200) || '未命名笔记',
    content: String(raw.content || ''),
    source: src,
    tags: normalizeTags(raw.tags),
    status: st,
    reviewAt,
    createdAt: keepCreated && Number.isFinite(raw.createdAt) ? raw.createdAt : Number(raw.createdAt) || now,
    updatedAt: now
  };
  if (raw.origin) n.origin = String(raw.origin);
  return n;
}

let lastStudyJson = '';
function broadcastStudy(doc) {
  const s = JSON.stringify(doc);
  if (s === lastStudyJson) return;
  lastStudyJson = s;
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('study:changed', doc);
  });
}

// 每次操作都重新读盘再改：工作台与 MCP 同时写入也不会互相覆盖
function applyStudyOp(op) {
  const action = op && op.op;
  const now = Date.now();
  const doc = readStudy();
  let id = op && op.id ? op.id : null;

  if (action === 'add') {
    const n = normalizeNote(op.note || {}, now, false);
    n.id = n.id || 'n_' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    doc.notes.unshift(n);
    id = n.id;
  } else if (action === 'update') {
    const i = doc.notes.findIndex((n) => n.id === op.id);
    if (i < 0) return { ok: false, error: '找不到这条笔记', doc };
    doc.notes[i] = normalizeNote(Object.assign({}, doc.notes[i], op.patch || {}, { id: op.id }), now, true);
  } else if (action === 'delete') {
    const before = doc.notes.length;
    doc.notes = doc.notes.filter((n) => n.id !== op.id);
    if (doc.notes.length === before) return { ok: false, error: '找不到这条笔记', doc };
  } else if (action === 'reviewed') {
    const i = doc.notes.findIndex((n) => n.id === op.id);
    if (i < 0) return { ok: false, error: '找不到这条笔记', doc };
    doc.notes[i].lastReviewAt = fmtDate(new Date());
    doc.notes[i].updatedAt = now;
  } else {
    return { ok: false, error: '未知操作', doc };
  }

  const ok = writeStudy(doc);
  if (ok) broadcastStudy(doc);
  return { ok, id, doc, error: ok ? null : '写入失败' };
}

// 外部（MCP / 编辑器）改了 study.json，工作台自动跟上
let studyWatchTimer = null;
function watchStudy() {
  const dir = path.dirname(STUDY_FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 忽略 */ }
  try {
    fs.watch(dir, (_evt, filename) => {
      if (filename && String(filename) !== 'study.json') return;
      clearTimeout(studyWatchTimer);
      studyWatchTimer = setTimeout(() => broadcastStudy(readStudy()), 180);
    });
  } catch (e) {
    console.error('监听学习笔记失败', e);
  }
}

// ---------- 窗口 ----------
// 界面态：主窗尺寸 + 桌面组件开关/位置，存在 userData 下
const UI_FILE = path.join(app.getPath('userData'), 'ui-state.json');
function readUI() {
  try {
    return Object.assign({ bounds: null, widget: { open: false, x: null, y: null } }, JSON.parse(fs.readFileSync(UI_FILE, 'utf8')));
  } catch (e) {
    return { bounds: null, widget: { open: false, x: null, y: null } };
  }
}
function writeUI(patch) {
  try {
    const next = Object.assign(readUI(), patch);
    fs.mkdirSync(path.dirname(UI_FILE), { recursive: true });
    fs.writeFileSync(UI_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
  } catch (e) {
    return readUI();
  }
}

// ---------- 外观主题：跟随系统 / 浅色 / 深色 ----------
const THEMES = ['system', 'light', 'dark'];
function themePref() {
  const t = (readUI().theme || 'system');
  return THEMES.includes(t) ? t : 'system';
}
function applyTheme(t) {
  const pref = THEMES.includes(t) ? t : 'system';
  try {
    nativeTheme.themeSource = pref;          // 影响所有窗口的 prefers-color-scheme
  } catch (e) { /* 忽略 */ }
  writeUI({ theme: pref });
  return pref;
}
function isDark() {
  return !!nativeTheme.shouldUseDarkColors;
}

// 默认窗口：竖向拉长，尽量吃满屏幕可用高度
function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1240, Math.max(1000, Math.round(area.width * 0.66)));
  const height = Math.min(area.height - 36, Math.max(780, Math.round(area.height * 0.95)));
  return {
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + 18)
  };
}

function createWindow() {
  const saved = readUI().bounds;
  let b = defaultBounds();
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    // 只有落在可见范围内的旧尺寸才复用
    const inside = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 &&
             saved.y < a.y + a.height - 80 && saved.y + 40 > a.y;
    });
    if (inside) b = Object.assign({}, b, saved);
  }

  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 940,
    minHeight: 620,
    title: '日程工作台',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: isDark() ? '#17191e' : '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  // 关闭窗口 = 隐藏，后台继续负责提醒（Dock 图标保留，点按可重新唤起）
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 记住窗口尺寸，下次打开保持同样的比例
  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const p = win.getBounds();
      if (p.width > 0 && p.height > 0) writeUI({ bounds: p });
    }, 400);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
}

// ---------- 桌面组件（始终置顶的小面板） ----------
let widgetWin = null;
const WIDGET_W = 300;
const WIDGET_H = 436;
const WIDGET_ALPHA_MIN = 0.25;
const WIDGET_ALPHA_MAX = 1;
const WIDGET_ALPHA_DEFAULT = 0.55;

// 桌面贴透明度（0.32–1），存在界面态里
function widgetAlpha() {
  const v = Number((readUI().widget || {}).opacity);
  if (!Number.isFinite(v)) return WIDGET_ALPHA_DEFAULT;
  return Math.min(WIDGET_ALPHA_MAX, Math.max(WIDGET_ALPHA_MIN, v));
}

function setWidgetAlpha(v) {
  const a = Math.min(WIDGET_ALPHA_MAX, Math.max(WIDGET_ALPHA_MIN, Number(v) || WIDGET_ALPHA_DEFAULT));
  const ui = readUI();
  writeUI({ widget: Object.assign({}, ui.widget, { opacity: a }) });
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.webContents.send('widget:alpha', a);
  }
  return a;
}

function widgetBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = (readUI().widget || {});
  let x = Number.isFinite(saved.x) ? saved.x : area.x + area.width - WIDGET_W - 30;
  let y = Number.isFinite(saved.y) ? saved.y : area.y + 76;
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - WIDGET_W - 8);
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - WIDGET_H - 8);
  return { x: Math.round(x), y: Math.round(y), width: WIDGET_W, height: WIDGET_H };
}

function createWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.showInactive();
    return widgetWin;
  }
  const b = widgetBounds();
  widgetWin = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  widgetWin.setAlwaysOnTop(true, 'floating');
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWin.once('ready-to-show', () => widgetWin.showInactive());
  widgetWin.on('moved', () => {
    try {
      const p = widgetWin.getBounds();
      const ui = readUI();
      writeUI({ widget: Object.assign({}, ui.widget, { x: p.x, y: p.y }) });
    } catch (e) { /* 忽略 */ }
  });
  widgetWin.on('closed', () => { widgetWin = null; });

  const ui = readUI();
  writeUI({ widget: Object.assign({}, ui.widget, { open: true }) });
  return widgetWin;
}

function setWidgetOpen(open) {
  const ui = readUI();
  writeUI({ widget: Object.assign({}, ui.widget, { open: !!open }) });
  if (open) createWidget();
  else if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
  return !!open;
}

function widgetVisible() {
  return !!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible());
}

function showMain(payload) {
  if (!win || win.isDestroyed()) createWindow();
  if (app.dock) app.dock.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (payload) win.webContents.send('navigate', payload);
}

function broadcast(data) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('data:changed', data);
  });
}

// ---------- 提醒扫描 ----------
function parseDateTime(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
}

function showNotification(title, body, payload) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    sound: 'Glass'
  });
  n.on('click', () => {
    if (win) {
      if (app.dock) app.dock.show();
      win.show();
      win.focus();
      if (payload) win.webContents.send('navigate', payload);
    }
  });
  n.show();
}

let scanTimer = null;
const todoPinged = new Set();

function startScheduler() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    const data = cache || (cache = readData());
    if (!data.settings || data.settings.notify === false) return;
    const now = new Date();
    let dirty = false;

    for (const ev of data.events) {
      if (ev.done) continue;
      const lead = Number(ev.remind);
      if (!Number.isFinite(lead) || lead < 0) continue;
      if (ev.firedAt) continue;
      const startAt = parseDateTime(ev.date, ev.start);
      const fireAt = new Date(startAt.getTime() - lead * 60 * 1000);
      // 只在 90 秒窗口内触发，避免把过期很久的事件全部补弹
      const diff = now.getTime() - fireAt.getTime();
      if (diff >= 0 && diff < 90 * 1000) {
        ev.firedAt = now.getTime();
        dirty = true;
        const hhmm = ev.start || '';
        const when = lead === 0 ? `现在 ${hhmm}` : `${hhmm} 开始（${lead} 分钟后）`;
        showNotification(ev.title || '日程提醒', when + (ev.note ? '\n' + ev.note : ''), {
          date: ev.date,
          id: ev.id
        });
      }
    }

    // 待办提醒：今天到期且未完成的，上午 9 点提示一次
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      const today = fmtDate(now);
      const pending = (data.todos || []).filter((t) => !t.done && t.date === today);
      const key = 'todoPing:' + today;
      if (pending.length && !todoPinged.has(key)) {
        todoPinged.add(key);
        showNotification('今日待办', `还有 ${pending.length} 项待办未完成`, { date: today });
      }

      // 学习笔记复习提醒：到期且未消化的
      const dueNotes = readStudy().notes.filter(
        (n) => n.status !== 'learned' && n.reviewAt && n.reviewAt <= today
      );
      const nkey = 'studyPing:' + today;
      if (dueNotes.length && !todoPinged.has(nkey)) {
        todoPinged.add(nkey);
        const names = dueNotes.slice(0, 3).map((n) => n.title).join('、');
        showNotification(
          '今天要复习',
          `${dueNotes.length} 条学习内容到期\n${names}${dueNotes.length > 3 ? ' 等' : ''}`,
          { view: 'study' }
        );
      }
    }

    if (dirty) {
      writeData(data);
      broadcast(data);
    }
  }, 20000);
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- IPC ----------
ipcMain.handle('store:load', () => {
  cache = readData();
  return cache;
});

ipcMain.handle('store:save', (_e, data) => {
  const ok = writeData(data);
  if (ok) broadcast(data);
  return ok;
});

ipcMain.handle('store:path', () => DATA_FILE);

// ---- 学习笔记 ----
ipcMain.handle('study:load', () => {
  const doc = readStudy();
  lastStudyJson = JSON.stringify(doc);
  return doc;
});
ipcMain.handle('study:op', (_e, op) => applyStudyOp(op || {}));
ipcMain.handle('study:path', () => STUDY_FILE);
ipcMain.handle('study:reveal', () => {
  if (!fs.existsSync(STUDY_FILE)) writeStudy(readStudy());
  shell.showItemInFolder(STUDY_FILE);
  return true;
});
ipcMain.handle('study:info', () => ({
  file: STUDY_FILE,
  server: MCP_SERVER_PATH,
  launcher: MCP_LAUNCHER_PATH,
  config: {
    mcpServers: {
      'schedule-study': { command: MCP_LAUNCHER_PATH, args: [] }
    }
  }
}));

ipcMain.handle('notify:test', () => {
  showNotification('日程工作台', '通知已开启，到点会在这里提醒你。');
  return true;
});

ipcMain.handle('dialog:save', async (_e, { defaultName, content, filters }) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: filters || [{ name: '文件', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('dialog:open', async (_e, { filters }) => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [{ name: '文件', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  try {
    const content = fs.readFileSync(res.filePaths[0], 'utf8');
    return { ok: true, content, path: res.filePaths[0] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('app:revealData', () => {
  shell.showItemInFolder(DATA_FILE);
  return true;
});

ipcMain.handle('app:setLogin', (_e, enable) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enable, openAsHidden: true });
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('app:getLogin', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('window:minimize', () => win && win.minimize());
ipcMain.handle('window:hide', () => win && win.hide());

// ---- 外观主题 ----
ipcMain.handle('app:getTheme', () => themePref());
ipcMain.handle('app:setTheme', (_e, t) => {
  const pref = applyTheme(t);
  if (win && !win.isDestroyed()) win.webContents.send('theme:changed', { pref, dark: isDark() });
  return { pref, dark: isDark() };
});

// ---- 桌面组件 ----
ipcMain.handle('widget:set', (_e, open) => setWidgetOpen(open));
ipcMain.handle('widget:toggle', () => setWidgetOpen(!widgetVisible()));
ipcMain.handle('widget:visible', () => widgetVisible());
ipcMain.handle('widget:openMain', (_e, payload) => { showMain(payload); return true; });
ipcMain.handle('widget:toggleTodo', (_e, id) => {
  const data = cache || (cache = readData());
  const t = (data.todos || []).find((x) => x.id === id);
  if (!t) return false;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  const ok = writeData(data);
  if (ok) broadcast(data);
  return ok;
});

// 桌面贴里直接勾掉日程（完成/取消完成）
ipcMain.handle('widget:toggleEvent', (_e, id) => {
  const data = cache || (cache = readData());
  const ev = (data.events || []).find((x) => x.id === id);
  if (!ev) return false;
  ev.done = !ev.done;
  const ok = writeData(data);
  if (ok) broadcast(data);
  return ok;
});

// 桌面贴透明度
ipcMain.handle('widget:getAlpha', () => widgetAlpha());
ipcMain.handle('widget:setAlpha', (_e, v) => setWidgetAlpha(v));

ipcMain.handle('clipboard:write', (_e, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(String(text || ''));
  return true;
});

// ---------- 菜单 ----------
function buildMenu() {
  const isDev = !app.isPackaged;
  const template = [
    {
      label: '日程工作台',
      submenu: [
        { role: 'about', label: '关于日程工作台' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { label: '显示/隐藏桌面组件', accelerator: 'CmdOrCtrl+Shift+D', click: () => setWidgetOpen(!widgetVisible()) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        {
          label: '显示主窗口',
          accelerator: 'Cmd+0',
          click: () => {
            if (!win) return;
            if (app.dock) app.dock.show();
            win.show();
            win.focus();
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();

if (!gotLock && !IS_SMOKE) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (app.dock) app.dock.show();
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    cache = readData();
    applyTheme(FORCE_THEME || themePref());
    dailyBackup();
    buildMenu();
    createWindow();
    startScheduler();
    watchStudy();
    // 首次运行先落一个空文件，"打开数据文件"和外部 MCP 都有东西可读
    if (!fs.existsSync(STUDY_FILE)) writeStudy(readStudy());
    if (readUI().widget && readUI().widget.open) createWidget();

    if (IS_SMOKE) runSmoke();

    app.on('activate', () => {
      if (!win) createWindow();
      else {
        if (app.dock) app.dock.show();
        win.show();
      }
    });
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

// ---------- 自检 ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runSmoke() {
  const today = fmtDate(new Date());
  const tomorrow = fmtDate(new Date(Date.now() + 86400000));

  // 每次自检从干净的学习笔记开始
  try { fs.unlinkSync(STUDY_FILE); } catch (e) { /* 忽略 */ }
  lastStudyJson = '';

  writeData({
    version: 1,
    events: [
      { id: 'e1', title: '产品评审会', date: today, start: '09:00', end: '10:00', color: 'blue', remind: 10, note: '带原型', done: false, firedAt: null },
      { id: 'e2', title: '客户沟通', date: today, start: '14:30', end: '15:15', color: 'orange', remind: -1, note: '', done: false, firedAt: null },
      { id: 'e3', title: '写周报', date: tomorrow, start: '10:00', end: '11:00', color: 'green', remind: 30, note: '', done: false, firedAt: null }
    ],
    todos: [
      { id: 't1', title: '确认会议室', date: today, done: false, key: true, createdAt: 1, doneAt: null },
      { id: 't2', title: '回邮件', date: today, done: true, key: false, createdAt: 2, doneAt: 3 }
    ],
    settings: { notify: true, launchAtLogin: false }
  });

  win.webContents.reload();

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });

  win.webContents.once('did-finish-load', async () => {
    const out = {};
    try {
      await wait(800);

      out.initial = await win.webContents.executeJavaScript(`(() => ({
        title: document.title,
        api: typeof window.api,
        cells: document.querySelectorAll('.cell').length,
        chips: document.querySelectorAll('.ev-chip').length,
        chipsText: [...document.querySelectorAll('.ev-chip .n')].map(n => n.textContent),
        todos: document.querySelectorAll('.todo-item').length,
        period: (document.getElementById('periodLabel')||{}).textContent,
        todayNum: (document.getElementById('todayNum')||{}).textContent,
        stats: (document.getElementById('todayStats')||{}).textContent,
        _wks: [...document.querySelectorAll('.wk')].map(w => { const b = w.getBoundingClientRect(); return Math.round(b.left + b.width/2); }),
        _cells: [...document.querySelectorAll('.cell')].slice(0,7).map(c => { const b = c.getBoundingClientRect(); return Math.round(b.left + b.width/2); }),
        _rowBox: (() => { const b = document.querySelector('.weekday-row').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; })(),
        _gridBox: (() => { const b = document.querySelector('.month-grid').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; })(),
        _overflowChips: [...document.querySelectorAll('.cell')].filter(c => {
          const cb = c.getBoundingClientRect();
          return [...c.querySelectorAll('.ev-chip')].some(ch => ch.getBoundingClientRect().right > cb.right + 1);
        }).length,
        _cellW: [...document.querySelectorAll('.cell')].slice(0,7).map(c => Math.round(c.getBoundingClientRect().width)),
        _cellH: [...document.querySelectorAll('.cell')].slice(0,7).map(c => Math.round(c.getBoundingClientRect().height))
      }))()`);

      if (process.argv.includes('--shot')) {
        await wait(500);
        const s1 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-month.png'), s1.toPNG());
      }

      // 切日视图
      await win.webContents.executeJavaScript(`document.querySelector('[data-view="day"]').click()`);
      await wait(400);
      out.day = await win.webContents.executeJavaScript(`(() => ({
        visible: !document.getElementById('dayView').classList.contains('hidden'),
        blocks: document.querySelectorAll('.day-ev').length,
        titles: [...document.querySelectorAll('.day-ev .ev-title')].map(n => n.textContent),
        hourRows: document.querySelectorAll('.hour-row').length,
        headTitle: (document.getElementById('dayHeadTitle')||{}).textContent
      }))()`);

      if (process.argv.includes('--shot')) {
        const s2 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-day.png'), s2.toPNG());
        // 打开抽屉再截一张
        await win.webContents.executeJavaScript(`document.getElementById('btnNew').click()`);
        await wait(400);
        const s3 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-drawer.png'), s3.toPNG());
        await win.webContents.executeJavaScript(`document.getElementById('btnCancel').click()`);
      }

      // 新建日程
      await win.webContents.executeJavaScript(`
        document.getElementById('btnNew').click();
        document.getElementById('evTitle').value = '自检新建事件';
        document.getElementById('evStart').value = '16:00';
        document.getElementById('evEnd').value = '17:00';
        document.getElementById('btnSave').click();
      `);
      await wait(500);
      out.afterCreate = await win.webContents.executeJavaScript(`(() => ({
        drawerOpen: document.querySelector('.app').classList.contains('drawer-open'),
        blocks: document.querySelectorAll('.day-ev').length,
        toast: (document.getElementById('toast')||{}).textContent
      }))()`);

      // 拖动事件改时间（下移 2 小时 = 128px）
      const dragInfo = await win.webContents.executeJavaScript(`(() => {
        const blk = document.querySelector('.day-ev');
        if (!blk) return { ok: false, reason: 'no block' };
        const b = blk.getBoundingClientRect();
        const before = blk.querySelector('.ev-time').textContent;
        blk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: b.top + 8, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: b.top + 8 + 128 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return { ok: true, id: blk.dataset.id, before };
      })()`);
      await wait(500);
      const blocksAfter = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.day-ev')].map(x => ({ id: x.dataset.id, t: x.querySelector('.ev-time').textContent }))`
      );
      out.drag = {
        before: dragInfo.before,
        after: (blocksAfter.find((x) => x.id === dragInfo.id) || {}).t,
        blockCount: blocksAfter.length
      };

      // 回到月视图看 chip 是否出现
      await win.webContents.executeJavaScript(`document.querySelector('[data-view="month"]').click()`);
      await wait(300);
      out.monthAgain = await win.webContents.executeJavaScript(`(() => ({
        chips: document.querySelectorAll('.ev-chip').length,
        hasNew: [...document.querySelectorAll('.ev-chip .n')].some(n => n.textContent.includes('自检'))
      }))()`);

      // 加一条待办
      await win.webContents.executeJavaScript(`
        const i = document.getElementById('todoInput');
        i.value = '自检待办';
        i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      `);
      await wait(400);
      out.todos = await win.webContents.executeJavaScript(`document.querySelectorAll('.todo-item').length`);

      // ---- 重复日程：创建每周系列 ----
      await win.webContents.executeJavaScript(`
        document.getElementById('btnNew').click();
        document.getElementById('evTitle').value = '每周例会';
        document.getElementById('evDate').value = '${today}';
        document.getElementById('evStart').value = '19:00';
        document.getElementById('evEnd').value = '20:00';
        const r = document.getElementById('evRepeat');
        r.value = 'weekly';
        r.dispatchEvent(new Event('change'));
        document.getElementById('btnSave').click();
      `);
      await wait(600);

      const afterSeries = readData();
      const seriesEvents = afterSeries.events.filter((e) => e.groupId);
      out.repeatCreate = {
        count: seriesEvents.length,
        until: seriesEvents[0] ? seriesEvents[0].until : null,
        dates: seriesEvents.map((e) => e.date).slice(0, 3),
        sameGroup: new Set(seriesEvents.map((e) => e.groupId)).size === 1,
        toast: await win.webContents.executeJavaScript(`document.getElementById('toast').textContent`)
      };

      // ---- 打开系列中的一条，检查提示与批量选项 ----
      out.repeatOpen = await win.webContents.executeJavaScript(`(() => {
        const ev = state.data.events.find(e => e.title === '每周例会');
        if (!ev) return { found: false };
        openEditor(ev.id);
        return {
          found: true,
          tipShown: !document.getElementById('repeatTip').classList.contains('hidden'),
          tip: document.getElementById('repeatTip').textContent,
          applyAllShown: !document.getElementById('applyAllRow').classList.contains('hidden'),
          deleteLabel: document.getElementById('btnDelete').textContent,
          seriesBtnShown: !document.getElementById('btnDeleteSeries').classList.contains('hidden'),
          repeatVal: document.getElementById('evRepeat').value,
          untilVal: document.getElementById('evUntil').value
        };
      })()`);
      await wait(300);

      if (process.argv.includes('--shot')) {
        const s4 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-repeat.png'), s4.toPNG());
      }

      // ---- 批量改标题（应用到整个系列）----
      await win.webContents.executeJavaScript(`
        document.getElementById('evTitle').value = '每周例会（改）';
        document.getElementById('evApplyAll').checked = true;
        document.getElementById('btnSave').click();
      `);
      await wait(600);
      const afterBatch = readData();
      out.repeatBatch = {
        renamed: afterBatch.events.filter((e) => e.title === '每周例会（改）').length,
        leftover: afterBatch.events.filter((e) => e.title === '每周例会').length,
        toast: await win.webContents.executeJavaScript(`document.getElementById('toast').textContent`)
      };

      // ---- 删除整个系列 ----
      const beforeDel = readData().events.length;
      await win.webContents.executeJavaScript(`(() => {
        const ev = state.data.events.find(e => e.title === '每周例会（改）');
        if (ev) openEditor(ev.id);
        window.__confirmBackup = window.confirm;
        window.confirm = () => true;
      })()`);
      await wait(400);
      out.repeatDelete = { opened: await win.webContents.executeJavaScript(`!document.getElementById('btnDeleteSeries').classList.contains('hidden')`) };
      await win.webContents.executeJavaScript(`document.getElementById('btnDeleteSeries').click();`);
      await wait(600);
      out.repeatDelete.removed = beforeDel - readData().events.length;
      out.repeatDelete.remaining = readData().events.filter((e) => e.groupId).length;
      await win.webContents.executeJavaScript(`(() => { window.confirm = window.__confirmBackup; })()`);

      // ---- 自然语言解析 ----
      out.parse = await win.webContents.executeJavaScript(`(() => {
        const cases = [
          '明天下午3点 开会',
          '每周一 19:30 健身',
          '每个工作日 8:45 通勤',
          '每月5号 还房贷',
          '下周三 中午12点 午餐',
          '11月30日 15:30 复盘',
          '晚上8点 看电影',
          '后天 体检',
          '3月5日 交房租',
          '每周三 团队周会'
        ];
        return cases.map(c => {
          const p = parseQuick(c);
          return { in: c, date: p.date, time: p.start + '-' + p.end, repeat: p.repeat, title: p.title };
        });
      })()`);

      // ---- 用 ⌘K 面板实际创建一条 ----
      await win.webContents.executeJavaScript(`openQuick(); document.getElementById('quickInput').value = '明天下午3点 自检快速添加'; document.getElementById('quickInput').dispatchEvent(new Event('input'));`);
      await wait(300);
      out.quickPreview = await win.webContents.executeJavaScript(`document.getElementById('quickPreview').textContent`);
      if (process.argv.includes('--shot')) {
        const s5 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-quick.png'), s5.toPNG());
      }
      await win.webContents.executeJavaScript(`commitQuick()`);
      await wait(500);
      out.quickCommit = {
        closed: await win.webContents.executeJavaScript(`document.getElementById('quickOverlay').classList.contains('hidden')`),
        saved: readData().events.some((e) => e.title === '自检快速添加'),
        toast: await win.webContents.executeJavaScript(`document.getElementById('toast').textContent`)
      };

      // ---- 撤销 ----
      out.undo = await win.webContents.executeJavaScript(`(() => {
        const before = state.data.events.length;
        const ev = state.data.events.find(e => e.title === '自检快速添加');
        if (!ev) return { before, found: false };
        openEditor(ev.id);
        window.__cb = window.confirm;
        window.confirm = () => true;
        return { before, found: true };
      })()`);
      await wait(400);
      await win.webContents.executeJavaScript(`(() => { document.getElementById('btnDelete').click(); window.confirm = window.__cb; })()`);
      await wait(600);
      const afterDelete = readData().events.length;
      await win.webContents.executeJavaScript(`undo()`);
      await wait(600);
      const afterUndo = readData();
      out.undoResult = {
        before: out.undo.before,
        afterDelete,
        afterUndo: afterUndo.events.length,
        restored: afterUndo.events.some((e) => e.title === '自检快速添加'),
        toast: await win.webContents.executeJavaScript(`document.getElementById('toast').textContent`)
      };

      // ---- 周报 ----
      out.report = await win.webContents.executeJavaScript(`(() => {
        openReport();
        const w = buildWeek(state.reportAnchor);
        const txt = document.getElementById('reportText').value;
        return {
          opened: !document.getElementById('reportOverlay').classList.contains('hidden'),
          key: state.reportKey,
          total: w.total,
          done: w.doneCount,
          minutes: w.totalMin,
          cats: w.cats.length,
          blocks: document.querySelectorAll('#reportDays .day-block').length,
          stats: document.querySelectorAll('#reportStats .stat-card').length,
          textLen: txt.length,
          head: txt.split(String.fromCharCode(10)).slice(0, 5).join(' | ')
        };
      })()`);
      await wait(350);
      if (process.argv.includes('--shot')) {
        win.webContents.invalidate();
        await wait(450);
        const s6 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-report.png'), s6.toPNG());
      }
      out.reportNav = await win.webContents.executeJavaScript(`(() => {
        const k0 = state.reportKey;
        document.getElementById('reportPrev').click();
        const k1 = state.reportKey;
        document.getElementById('reportThisWeek').click();
        const k2 = state.reportKey;
        document.getElementById('reportClose').click();
        return {
          k0, k1, k2,
          closed: document.getElementById('reportOverlay').classList.contains('hidden')
        };
      })()`);
      await wait(200);

      // ---- 分类名字 ----
      out.cats = await win.webContents.executeJavaScript(`(() => {
        document.getElementById('btnNew').click();
        const opts = [...document.querySelectorAll('#evColors .cat-opt')].map((b) => b.textContent.trim() + '/' + b.dataset.color);
        const on = document.querySelector('#evColors .cat-opt.on');
        const picked = [];
        [...document.querySelectorAll('#evColors .cat-opt')].forEach((b) => {
          b.click();
          picked.push(state.editingColor);
        });
        document.getElementById('btnCancel').click();
        return {
          opts,
          on: on ? on.textContent.trim() : null,
          picked,
          legend: [...document.querySelectorAll('#catLegend .lg')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()),
          catNames: [...document.querySelectorAll('#reportCats .nm')].map((n) => n.textContent)
        };
      })()`);
      await wait(200);

      // ---- 学习笔记板块 ----
      await win.webContents.executeJavaScript(`document.querySelector('[data-view="study"]').click()`);
      await wait(400);
      out.studyView = await win.webContents.executeJavaScript(`(() => ({
        visible: !document.getElementById('studyView').classList.contains('hidden'),
        monthHidden: document.getElementById('monthView').classList.contains('hidden'),
        segOn: (document.querySelector('#viewSeg .on')||{}).textContent,
        period: document.getElementById('periodLabel').textContent,
        emptyShown: !document.getElementById('noteEmpty').classList.contains('hidden')
      }))()`);

      await win.webContents.executeJavaScript(`(() => {
        document.getElementById('btnNewNote').click();
      })()`);
      await wait(500);
      await win.webContents.executeJavaScript(`(() => {
        const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
        set(document.getElementById('noteTitle'), '自检学习笔记');
        set(document.getElementById('noteBody'), '这是自检写入的正文。\\n第二行。');
        set(document.getElementById('noteTags'), '自检, 测试');
        const s = document.getElementById('noteSource');
        s.value = 'chatgpt';
        s.dispatchEvent(new Event('change'));
      })()`);
      await wait(1100);
      const studyDisk = readStudy();
      out.studyCreate = {
        count: studyDisk.notes.length,
        saved: studyDisk.notes.some((n) => n.title === '自检学习笔记'),
        tags: (studyDisk.notes.find((n) => n.title === '自检学习笔记') || {}).tags,
        source: (studyDisk.notes.find((n) => n.title === '自检学习笔记') || {}).source,
        savedLabel: await win.webContents.executeJavaScript(`document.getElementById('noteSaved').textContent`)
      };

      // 切状态：标为已消化
      await win.webContents.executeJavaScript(`document.querySelector('#noteStatus [data-status="learned"]').click()`);
      await wait(500);
      out.studyStatus = {
        disk: (readStudy().notes.find((n) => n.title === '自检学习笔记') || {}).status,
        reviewCleared: (readStudy().notes.find((n) => n.title === '自检学习笔记') || {}).reviewAt,
        chip: await win.webContents.executeJavaScript(`(document.querySelector('.note-card.on .nc-st')||{}).textContent`)
      };

      // 外部写入（模拟 MCP）→ 工作台应自动刷出来
      const extDoc = readStudy();
      extDoc.notes.unshift({
        id: 'n_extcheck', title: '来自外部的笔记', content: 'MCP 写入的内容',
        source: 'workbuddy', tags: ['外部'], status: 'new',
        reviewAt: fmtDate(new Date()), createdAt: Date.now(), updatedAt: Date.now()
      });
      writeStudy(extDoc);
      lastStudyJson = '';             // 强制广播，模拟另一进程写盘
      broadcastStudy(readStudy());
      await wait(700);
      out.studyExternal = {
        inDisk: readStudy().notes.some((n) => n.id === 'n_extcheck'),
        inUi: await win.webContents.executeJavaScript(`[...document.querySelectorAll('.note-card .nc-title')].some(n => n.textContent.includes('来自外部'))`),
        total: await win.webContents.executeJavaScript(`document.querySelectorAll('.note-card').length`)
      };

      // 筛选：只看未消化
      await win.webContents.executeJavaScript(`document.querySelector('#studyStatusSeg [data-status="new"]').click()`);
      await wait(250);
      out.studyFilter = {
        cards: await win.webContents.executeJavaScript(`document.querySelectorAll('.note-card').length`),
        count: await win.webContents.executeJavaScript(`document.getElementById('studyCount').textContent`)
      };
      await win.webContents.executeJavaScript(`document.querySelector('#studyStatusSeg [data-status=""]').click()`);
      await wait(200);

      if (process.argv.includes('--shot')) {
        await win.webContents.executeJavaScript(`document.querySelector('.note-card').click()`);
        await wait(500);
        const s8 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-study.png'), s8.toPNG());
      }

      // 删除（含外部那条），清理自检数据
      await win.webContents.executeJavaScript(`(() => {
        window.__c2 = window.confirm;
        window.confirm = () => true;
      })()`);
      const delTargets = readStudy().notes.filter((n) => n.title === '自检学习笔记' || n.id === 'n_extcheck');
      for (const t of delTargets) {
        await win.webContents.executeJavaScript(`(() => {
          const c = [...document.querySelectorAll('.note-card')].find(x => x.dataset.id === '${t.id}');
          if (c) c.click();
        })()`);
        await wait(250);
        await win.webContents.executeJavaScript(`document.getElementById('noteDelete').click()`);
        await wait(400);
      }
      out.studyDelete = {
        remaining: readStudy().notes.filter((n) => n.title === '自检学习笔记' || n.id === 'n_extcheck').length,
        editorHidden: await win.webContents.executeJavaScript(`document.getElementById('noteEditor').classList.contains('hidden')`)
      };
      await win.webContents.executeJavaScript(`(() => { window.confirm = window.__c2; document.querySelector('[data-view="month"]').click(); })()`);
      await wait(300);
      out.studyBack = await win.webContents.executeJavaScript(`(() => ({
        monthShown: !document.getElementById('monthView').classList.contains('hidden'),
        period: document.getElementById('periodLabel').textContent
      }))()`);

      // ---- 月历密集日：看能显示几条 ----
      out.dense = await win.webContents.executeJavaScript(`(() => {
        const ds = ymd(new Date());
        const base = state.data.events.filter((e) => String(e.id).indexOf('dense') !== 0);
        const cols = ['work', 'study', 'fun'];
        const res = { cases: [], availH: 0, chipH: 0, gap: 0, overflow: 0 };
        for (let n = 3; n <= 9; n++) {
          state.data.events = base.slice();
          for (let i = 0; i < n; i++) {
            state.data.events.push({
              id: 'dense' + i, title: '密集测试' + (i + 1), date: ds,
              start: (8 + i) + ':00', end: (9 + i) + ':00',
              color: cols[i % 3], remind: 0, done: false, firedAt: null
            });
          }
          setView('month');
          const cell = document.querySelector('.cell[data-date="' + ds + '"]');
          const wrap = cell.querySelector('.cell-events');
          const chip = wrap.querySelector('.ev-chip');
          res.availH = wrap.clientHeight;
          res.chipH = chip ? Math.round(chip.getBoundingClientRect().height * 10) / 10 : 0;
          res.gap = chip ? parseFloat(getComputedStyle(wrap).rowGap || getComputedStyle(wrap).gap) : 0;
          const more = wrap.querySelector('.more-count');
          if (wrap.scrollHeight > wrap.clientHeight + 1) res.overflow += 1;
          res.cases.push({
            n,
            shown: cell.querySelectorAll('.ev-chip').length,
            compact: !!wrap.querySelector('.ev-chip.compact'),
            more: more ? more.textContent : '—'
          });
        }
        state.data.events = base;
        render();
        return res;
      })()`);
      await wait(200);

      // ---- 密集日截图 ----
      if (process.argv.includes('--shot')) {
        await win.webContents.executeJavaScript(`(() => {
          const ds = ymd(new Date());
          const cols = ['work', 'study', 'fun'];
          const base = state.data.events.filter((e) => String(e.id).indexOf('dense') !== 0);
          for (let i = 0; i < 7; i++) {
            base.push({
              id: 'dense' + i, title: '密集测试' + (i + 1), date: ds,
              start: (8 + i) + ':00', end: (9 + i) + ':00',
              color: cols[i % 3], remind: 0, done: false, firedAt: null
            });
          }
          state.data.events = base;
          setView('month');
        })()`);
        await wait(400);
        const sd = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-dense.png'), sd.toPNG());
        await win.webContents.executeJavaScript(`(() => {
          state.data.events = state.data.events.filter((e) => String(e.id).indexOf('dense') !== 0);
          render();
        })()`);
        await wait(250);
      }

      await win.webContents.executeJavaScript(`(() => {
        openReport();
        const t = document.getElementById('reportText');
        t.value = t.value + String.fromCharCode(10) + '---手改测试---';
        t.dispatchEvent(new Event('input'));
      })()`);
      await wait(1000);
      const afterEdit = readData();
      out.reportEdit = {
        saved: !!(afterEdit.weekNotes && Object.values(afterEdit.weekNotes).some((v) => String(v).includes('手改测试'))),
        keys: Object.keys(afterEdit.weekNotes || {}),
        badge: await win.webContents.executeJavaScript(`document.getElementById('reportSaved').textContent`)
      };
      out.reportRegen = await win.webContents.executeJavaScript(`(() => {
        window.__c = window.confirm;
        window.confirm = () => true;
        document.getElementById('reportRegen').click();
        window.confirm = window.__c;
        const v = document.getElementById('reportText').value;
        return { hasManual: v.includes('手改测试'), len: v.length, badge: document.getElementById('reportSaved').textContent };
      })()`);
      await wait(500);
      const afterRegen = readData();
      out.reportRegen.goneOnDisk = !(
        afterRegen.weekNotes && Object.values(afterRegen.weekNotes).some((v) => String(v).includes('手改测试'))
      );
      out.reportCopy = await win.webContents.executeJavaScript(`(async () => {
        await copyReport();
        return document.getElementById('toast').textContent;
      })()`);
      await win.webContents.executeJavaScript(`closeReport()`);

      // 读回磁盘数据，确认已落盘
      await wait(400);
      const persisted = readData();
      // ---- 设置里的透明度滑杆 ----
      out.slider = await win.webContents.executeJavaScript(`(async () => {
        document.getElementById('btnSettings').click();
        await new Promise((r) => setTimeout(r, 260));
        const s = document.getElementById('setWidgetAlpha');
        const before = s.value;
        s.value = '50';
        s.dispatchEvent(new Event('input'));
        await new Promise((r) => setTimeout(r, 160));
        const ov = document.getElementById('settingsOverlay');
        return {
          before,
          after: s.value,
          label: document.getElementById('setWidgetAlphaVal').textContent,
          alpha: await window.api.widget.getAlpha(),
          visible: !ov.classList.contains('hidden')
        };
      })()`);
      await wait(350);
      if (process.argv.includes('--shot')) {
        win.webContents.invalidate();
        await wait(500);
        const s7 = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-settings.png'), s7.toPNG());
      }
      out.sliderReset = await win.webContents.executeJavaScript(`(async () => {
        const s = document.getElementById('setWidgetAlpha');
        s.value = '55';
        s.dispatchEvent(new Event('input'));
        document.getElementById('settingsClose').click();
        await new Promise((r) => setTimeout(r, 150));
        return {
          alpha: await window.api.widget.getAlpha(),
          closed: document.getElementById('settingsOverlay').classList.contains('hidden')
        };
      })()`);
      await wait(200);
      // ---- 桌面组件 ----
      out.window = { width: win.getBounds().width, height: win.getBounds().height };
      const wg = createWidget();
      await new Promise((r) => {
        if (wg.webContents.isLoading()) wg.webContents.once('did-finish-load', r);
        else r();
      });
      await wait(900);
      out.widget = await wg.webContents.executeJavaScript(`(() => {
        const rows = [...document.querySelectorAll('#wEvents .ev')].map((r) => r.querySelector('.et').textContent + ' ' + r.querySelector('.en').textContent);
        const todos = [...document.querySelectorAll('#wTodos .td')].length;
        const band = document.getElementById('wNext');
        return {
          date: document.getElementById('wNum').textContent,
          week: document.getElementById('wWeek').textContent,
          evRows: rows,
          evCount: document.getElementById('wEvCount').textContent,
          todoCount: document.getElementById('wTodoCount').textContent,
          todos,
          nextShown: !band.classList.contains('hidden'),
          nextTitle: document.getElementById('wNextTitle').textContent,
          nextGap: document.getElementById('wNextGap').textContent,
          tmRows: [...document.querySelectorAll('#wTomorrow .ev')].length,
          foot: document.getElementById('wFoot').textContent.replace(/\\s+/g, ' ').trim()
        };
      })()`);
      // 在组件里勾掉一项待办，看是否写回数据
      const todoBefore = readData().todos.filter((t) => !t.done).length;
      await wg.webContents.executeJavaScript(`document.querySelector('#wTodos .td').click()`);
      await wait(600);
      out.widgetToggle = {
        before: todoBefore,
        after: readData().todos.filter((t) => !t.done).length
      };

      // 组件里直接勾掉一条日程
      const evDoneBefore = readData().events.filter((e) => e.done).length;
      await wg.webContents.executeJavaScript(`document.querySelector('#wEvents .ev .ck').click()`);
      await wait(600);
      out.widgetCheck = {
        doneBefore: evDoneBefore,
        doneAfter: readData().events.filter((e) => e.done).length,
        ui: await wg.webContents.executeJavaScript(`(() => ({
          hasDoneRow: !!document.querySelector('#wEvents .ev.done'),
          foot: document.getElementById('wFoot').textContent.replace(/\\s+/g, ' ').trim(),
          evCount: document.getElementById('wEvCount').textContent
        }))()`)
      };

      // 透明度
      const alphaSet = await win.webContents.executeJavaScript(`window.api.widget.setAlpha(0.6)`);
      await wait(400);
      out.widgetAlpha = await wg.webContents.executeJavaScript(`(() => ({
        sheet: getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim(),
        bg: getComputedStyle(document.querySelector('.card')).backgroundColor,
        title: document.getElementById('wAlpha').title
      }))()`);
      out.widgetAlpha.set = alphaSet;
      if (process.argv.includes('--shot')) {
        await win.webContents.executeJavaScript(`window.api.widget.setAlpha(0.4)`);
        await wait(400);
        wg.webContents.invalidate();
        await wait(500);
        const slow = await wg.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-widget-low.png'), slow.toPNG());
      }
      await win.webContents.executeJavaScript(`window.api.widget.setAlpha(0.55)`);
      await wait(300);

      if (process.argv.includes('--shot')) {
        wg.webContents.invalidate();
        await wait(450);
        const sw = await wg.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'shot-widget.png'), sw.toPNG());

      }
      setWidgetOpen(false);
      await wait(200);
      out.widgetIpc = await win.webContents.executeJavaScript(`(async () => {
        const a = await window.api.widget.toggle();
        const v = await window.api.widget.visible();
        const b = await window.api.widget.toggle();
        return { opened: a, visible: v, closed: b };
      })()`);
      await wait(300);
      // ---- 自动备份 ----
      dailyBackup();
      const backupDir = path.join(app.getPath('userData'), 'backups');
      out.backup = {
        dir: backupDir,
        files: (() => {
          try { return fs.readdirSync(backupDir); } catch (e) { return []; }
        })()
      };
      out.persisted = {
        events: persisted.events.length,
        todos: persisted.todos.length,
        hasNewEvent: persisted.events.some((e) => e.title === '自检新建事件'),
        hasNewTodo: persisted.todos.some((t) => t.title === '自检待办')
      };
    } catch (e) {
      out.error = e.message;
    }
    console.log('SMOKE_RESULT ' + JSON.stringify(out, null, 2));
    app.exit(0);
  });
}

// macOS：关掉窗口不退出，后台继续提醒
app.on('window-all-closed', () => {
  // 保持常驻
});
