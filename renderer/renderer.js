/* ============================================================
   日程工作台 — 渲染层
   ============================================================ */

// 三个固定分类：名字 = 用途，颜色 = 视觉识别
const CATS = [
  { key: 'work',  name: '工作', dot: 'var(--cat-work)',  soft: 'var(--cat-work-soft)' },
  { key: 'study', name: '学习', dot: 'var(--cat-study)', soft: 'var(--cat-study-soft)' },
  { key: 'fun',   name: '娱乐', dot: 'var(--cat-fun)',   soft: 'var(--cat-fun-soft)' }
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));
const CAT_KEYS = CATS.map((c) => c.key);
const DEFAULT_CAT = 'work';
// 老数据是按颜色存的，统一映射到分类
const LEGACY_COLOR = {
  blue: 'work', green: 'study', orange: 'fun',
  red: 'work', purple: 'study', cyan: 'fun'
};
const catKey = (v) => (CAT[v] ? v : LEGACY_COLOR[v] || DEFAULT_CAT);
const catOf = (ev) => CAT[catKey(ev && ev.color)];

const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const PX_PER_HOUR = 64;
const SNAP_MIN = 15;

// ---------- 状态 ----------
const state = {
  data: { version: 1, events: [], todos: [], settings: { notify: true }, weekNotes: {} },
  view: 'month',                 // month | day | study
  cursor: new Date(),            // 当前显示的月份/日期
  selected: null,                // 月视图选中日期 ymd
  search: '',
  editingId: null,               // null = 新建
  editingColor: DEFAULT_CAT,
  drawerOpen: false,
  dragging: null,
  showDoneTodos: false,
  reportAnchor: new Date(),      // 周报当前查看的那一周（任意一天）
  reportKey: '',                 // 当前周标识，如 2026-W48
  // 学习笔记
  study: { version: 1, notes: [] },
  studyStatus: '',
  studySource: '',
  studySearch: '',
  noteId: null,
  noteDirty: false
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  app: document.querySelector('.app'),
  todayNum: $('todayNum'), todayWeek: $('todayWeek'), todaySub: $('todaySub'), todayStats: $('todayStats'),
  catLegend: $('catLegend'),
  todoInput: $('todoInput'), todoList: $('todoList'), todoCount: $('todoCount'), todoAdd: $('todoAdd'),
  periodLabel: $('periodLabel'), btnPrev: $('btnPrev'), btnNext: $('btnNext'), btnToday: $('btnToday'),
  viewSeg: $('viewSeg'), btnNew: $('btnNew'), searchInput: $('searchInput'),
  searchWrap: document.querySelector('.search-wrap'),
  monthView: $('monthView'), monthGrid: $('monthGrid'),
  dayView: $('dayView'), dayHeadTitle: $('dayHeadTitle'), dayHeadSub: $('dayHeadSub'),
  dayScroll: $('dayScroll'), dayBody: $('dayBody'), dayEvents: $('dayEvents'), hourCol: $('hourCol'), nowLine: $('nowLine'),
  drawer: $('drawer'), drawerTitle: $('drawerTitle'), drawerClose: $('drawerClose'),
  evTitle: $('evTitle'), evDate: $('evDate'), evStart: $('evStart'), evEnd: $('evEnd'),
  evRemind: $('evRemind'), evNote: $('evNote'), evDone: $('evDone'), evColors: $('evColors'),
  evRepeat: $('evRepeat'), evUntil: $('evUntil'), untilField: $('untilField'),
  applyAllRow: $('applyAllRow'), evApplyAll: $('evApplyAll'), repeatTip: $('repeatTip'),
  btnSave: $('btnSave'), btnCancel: $('btnCancel'), btnDelete: $('btnDelete'),
  btnDeleteSeries: $('btnDeleteSeries'),
  btnSettings: $('btnSettings'), settingsOverlay: $('settingsOverlay'), settingsClose: $('settingsClose'),
  setNotify: $('setNotify'), setLogin: $('setLogin'), btnTestNotify: $('btnTestNotify'),
  setWidgetAlpha: $('setWidgetAlpha'), setWidgetAlphaVal: $('setWidgetAlphaVal'),
  themeSeg: $('themeSeg'),
  btnExportJson: $('btnExportJson'), btnImportJson: $('btnImportJson'), btnExportIcs: $('btnExportIcs'),
  btnReveal: $('btnReveal'), dataPathLabel: $('dataPathLabel'),
  quickOverlay: $('quickOverlay'), quickInput: $('quickInput'), quickPreview: $('quickPreview'),
  btnReport: $('btnReport'), btnWidget: $('btnWidget'), reportOverlay: $('reportOverlay'), reportRange: $('reportRange'),
  reportStats: $('reportStats'), reportCats: $('reportCats'), reportDays: $('reportDays'),
  reportTodos: $('reportTodos'), reportText: $('reportText'), reportSaved: $('reportSaved'),
  reportPrev: $('reportPrev'), reportNext: $('reportNext'), reportThisWeek: $('reportThisWeek'),
  reportClose: $('reportClose'), reportRegen: $('reportRegen'), reportCopy: $('reportCopy'),
  reportExport: $('reportExport'), reportDone: $('reportDone'),
  studyView: $('studyView'), studyStatusSeg: $('studyStatusSeg'), studySource: $('studySource'),
  studySearch: $('studySearch'), studyCount: $('studyCount'), studyReveal: $('studyReveal'),
  noteList: $('noteList'), noteEmpty: $('noteEmpty'), noteEditor: $('noteEditor'),
  noteTitle: $('noteTitle'), noteSource: $('noteSource'), noteStatus: $('noteStatus'),
  noteReview: $('noteReview'), noteTags: $('noteTags'), noteBody: $('noteBody'),
  noteSaved: $('noteSaved'), noteDelete: $('noteDelete'), btnNewNote: $('btnNewNote'),
  btnCopyMcp: $('btnCopyMcp'), btnRevealStudy: $('btnRevealStudy'), mcpDesc: $('mcpDesc'),
  toast: $('toast')
};

// ---------- 日期工具 ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMin = (min) => {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
const durationMin = (ev) => {
  const s = toMin(ev.start);
  let e = toMin(ev.end);
  if (!ev.end || e <= s) e = s + 30;
  return Math.max(10, e - s);
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sameDay = (a, b) => ymd(a) === ymd(b);

// ---------- 重复规则 ----------
const REPEAT_LABEL = {
  daily: '每天',
  weekday: '每个工作日',
  weekly: '每周这天',
  monthly: '每月这天'
};
const MAX_INSTANCES = 400;

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// ---------- 周工具 ----------
// 一周从周一开始
function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

// ISO 周编号，如 2026-W48
function isoWeekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 3);   // 本周四
  const firstThu = new Date(t.getFullYear(), 0, 4);
  firstThu.setDate(firstThu.getDate() - ((firstThu.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((t - firstThu) / 604800000);
  return `${t.getFullYear()}-W${pad(week)}`;
}

const weekNumberOf = (d) => Number(isoWeekKey(d).split('-W')[1]);

const addMonthsSafe = (d, n) => {
  // 处理 1月31日 + 1个月 这类溢出，取目标月的最后一天
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
};

function defaultUntil(dateStr, repeat) {
  const base = parseYmd(dateStr);
  const months = repeat === 'monthly' ? 12 : repeat === 'weekly' ? 3 : 1;
  return ymd(addMonthsSafe(base, months));
}

// 把重复规则展开成具体日期列表（含起始日）
function expandDates(startStr, repeat, untilStr) {
  const start = parseYmd(startStr);
  const until = parseYmd(untilStr || defaultUntil(startStr, repeat));
  const out = [];
  let cur = new Date(start);

  while (cur <= until && out.length < MAX_INSTANCES) {
    const dow = cur.getDay();
    if (repeat === 'daily') {
      out.push(new Date(cur));
      cur = addDays(cur, 1);
    } else if (repeat === 'weekday') {
      if (dow >= 1 && dow <= 5) out.push(new Date(cur));
      cur = addDays(cur, 1);
    } else if (repeat === 'weekly') {
      out.push(new Date(cur));
      cur = addDays(cur, 7);
    } else if (repeat === 'monthly') {
      out.push(new Date(cur));
      cur = addMonthsSafe(cur, 1);
    } else {
      out.push(new Date(cur));
      break;
    }
  }
  return out.map(ymd);
}

function seriesCount(groupId) {
  return state.data.events.filter((e) => e.groupId === groupId).length;
}

// 重复图标
function repIcon(size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', size || 9);
  s.setAttribute('height', size || 9);
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('class', 'rep');
  s.innerHTML =
    '<path d="M9.8 4.4A3.8 3.8 0 0 0 3.1 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M3.1 1.6v2.1h2.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M2.2 7.6a3.8 3.8 0 0 0 6.7.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M8.9 10.4V8.3H6.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

// ---------- 持久化 ----------
let saveTimer = null;
function persist(immediate = false) {
  clearTimeout(saveTimer);
  const run = async () => {
    try { await window.api.save(state.data); } catch (e) { console.error(e); }
  };
  if (immediate) run();
  else saveTimer = setTimeout(run, 180);
}

// ---------- 撤销 ----------
const undoStack = [];
const UNDO_LIMIT = 30;

function pushUndo(label) {
  undoStack.push({
    label,
    events: JSON.parse(JSON.stringify(state.data.events)),
    todos: JSON.parse(JSON.stringify(state.data.todos))
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo() {
  if (!undoStack.length) {
    toast('没有可撤销的操作');
    return;
  }
  const snap = undoStack.pop();
  state.data.events = snap.events;
  state.data.todos = snap.todos;
  persist(true);
  render();
  toast('已撤销：' + snap.label);
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 2000);
}

// ---------- 查询 ----------
function eventsOn(dateStr) {
  const list = state.data.events
    .filter((e) => e.date === dateStr)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  if (!state.search) return list;
  const q = state.search.toLowerCase();
  return list.filter(
    (e) => (e.title || '').toLowerCase().includes(q) || (e.note || '').toLowerCase().includes(q)
  );
}

function matchSearch(ev) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  return (ev.title || '').toLowerCase().includes(q) || (ev.note || '').toLowerCase().includes(q);
}

// ============================================================
//  侧栏
// ============================================================
function renderSidebar() {
  const now = new Date();
  const todayStr = ymd(now);

  el.todayNum.textContent = now.getDate();
  el.todayNum.classList.add('is-today');
  el.todayWeek.textContent = WEEK_CN[now.getDay()];
  el.todaySub.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;

  const todayEvents = state.data.events.filter((e) => e.date === todayStr);
  const doneEvents = todayEvents.filter((e) => e.done).length;
  const openTodos = state.data.todos.filter((t) => !t.done);
  el.todayStats.innerHTML = `<b>${todayEvents.length}</b> 个日程<br><b>${openTodos.length}</b> 项待办`;

  renderCatLegend();
  renderTodos();
}

// 侧栏分类图例：本月各分类的日程数
function renderCatLegend() {
  const y = state.cursor.getFullYear();
  const m = state.cursor.getMonth();
  const counts = { work: 0, study: 0, fun: 0 };
  state.data.events.forEach((e) => {
    const d = parseYmd(e.date);
    if (d.getFullYear() === y && d.getMonth() === m) counts[catKey(e.color)] += 1;
  });
  el.catLegend.innerHTML = CATS.map(
    (c) => `<span class="lg" title="${c.name} · 本月 ${counts[c.key]} 个日程">
      <i style="background:${c.dot}"></i>${c.name}<b>${counts[c.key]}</b>
    </span>`
  ).join('');
}

function renderTodos() {
  const todos = [...state.data.todos];
  const open = todos.filter((t) => !t.done).sort((a, b) => {
    if (!!b.key !== !!a.key) return b.key ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 20);

  el.todoCount.textContent = open.length;
  el.todoList.innerHTML = '';

  if (!open.length && !done.length) {
    el.todoList.innerHTML = '<div class="empty-tip">还没有待办<br>在上面输入框回车即可添加</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  open.forEach((t) => frag.appendChild(todoNode(t)));

  if (done.length) {
    const label = document.createElement('div');
    label.className = 'todo-group-label';
    label.style.cursor = 'pointer';
    label.innerHTML = `<span class="caret${state.showDoneTodos ? ' open' : ''}"></span><span>已完成 ${done.length}</span>`;
    label.onclick = () => { state.showDoneTodos = !state.showDoneTodos; renderTodos(); };
    frag.appendChild(label);
    if (state.showDoneTodos) done.forEach((t) => frag.appendChild(todoNode(t)));
  }

  el.todoList.appendChild(frag);
}

function todoNode(t) {
  const row = document.createElement('div');
  row.className = 'todo-item' + (t.done ? ' done' : '') + (t.key ? ' key' : '');

  const cb = document.createElement('button');
  cb.className = 'cb';
  cb.innerHTML = '<svg width="9" height="9" viewBox="0 0 10 10"><path d="M1 5.2 3.6 7.8 9 2.4" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  cb.onclick = (e) => { e.stopPropagation(); toggleTodo(t.id); };

  const txt = document.createElement('div');
  txt.className = 'txt';
  txt.textContent = t.title;
  txt.onclick = () => toggleTodo(t.id);

  const star = document.createElement('button');
  star.className = 'star';
  star.textContent = '★';
  star.title = '标记为今日重点';
  star.onclick = (e) => { e.stopPropagation(); t.key = !t.key; persist(); renderTodos(); renderSidebarStatsOnly(); };

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除';
  del.onclick = (e) => {
    e.stopPropagation();
    pushUndo('删除待办');
    state.data.todos = state.data.todos.filter((x) => x.id !== t.id);
    persist();
    renderTodos();
    renderSidebarStatsOnly();
  };

  row.append(cb, txt, star, del);
  return row;
}

function renderSidebarStatsOnly() {
  const todayStr = ymd(new Date());
  const todayEvents = state.data.events.filter((e) => e.date === todayStr);
  const openTodos = state.data.todos.filter((t) => !t.done);
  el.todayStats.innerHTML = `<b>${todayEvents.length}</b> 个日程<br><b>${openTodos.length}</b> 项待办`;
  el.todoCount.textContent = openTodos.length;
  renderCatLegend();
}

function toggleTodo(id) {
  const t = state.data.todos.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  persist();
  renderTodos();
  renderSidebarStatsOnly();
}

function addTodo() {
  const v = el.todoInput.value.trim();
  if (!v) return;
  pushUndo('添加待办');
  state.data.todos.push({
    id: uid(),
    title: v,
    date: ymd(new Date()),
    done: false,
    key: false,
    createdAt: Date.now(),
    doneAt: null
  });
  el.todoInput.value = '';
  persist();
  renderTodos();
  renderSidebarStatsOnly();
}

// ============================================================
//  月视图
// ============================================================
function renderMonth() {
  const cur = state.cursor;
  const year = cur.getFullYear();
  const month = cur.getMonth();
  el.periodLabel.textContent = `${year} 年 ${month + 1} 月`;

  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const todayStr = ymd(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push(d);
  }

  // 如果最后一行全是下月，去掉一行（更紧凑）
  const lastRow = cells.slice(35);
  const needLastRow = lastRow.some((d) => d.getMonth() === month);
  const use = needLastRow ? cells : cells.slice(0, 35);

  el.monthGrid.innerHTML = '';
  const frag = document.createDocumentFragment();

  // 按格子实际高度决定能放几条：先试常规高度，再试紧凑高度，取能显示更多的方案
  const rowCount = Math.ceil(use.length / 7);
  const gridH = el.monthGrid.clientHeight || 0;
  const rawCellH = gridH > 0 ? Math.floor((gridH - (rowCount - 1)) / rowCount) : 0;
  // 首次渲染若布局还没量出来，等一帧再算一次（只重试一次，避免死循环）
  if (!rawCellH && !state._monthRelayout) {
    state._monthRelayout = true;
    requestAnimationFrame(() => {
      state._monthRelayout = false;
      if (state.view === 'month') renderMonth();
    });
  }
  const avail = (rawCellH > 0 ? rawCellH : 120) - 34; // 减去上下内边距、日期行与间距

  const planFit = (n) => {
    const variants = [
      { pitch: 23.5, more: 15, compact: false },
      { pitch: 17.5, more: 13, compact: true }
    ];
    let best = { k: 0, compact: false };
    variants.forEach((v) => {
      for (let k = Math.min(n, 40); k >= 0; k--) {
        const need = k * v.pitch + (k < n ? v.more : 0);
        if (need <= avail) {
          if (k > best.k) best = { k, compact: v.compact };
          break;
        }
      }
    });
    return best;
  };

  use.forEach((d) => {
    const ds = ymd(d);
    const cell = document.createElement('div');
    cell.className = 'cell';
    const isOther = d.getMonth() !== month;
    const dow = d.getDay();
    if (isOther) cell.classList.add('other');
    if (dow === 0 || dow === 6) cell.classList.add('weekend');
    if (ds === todayStr) cell.classList.add('today');
    if (ds === state.selected) cell.classList.add('selected');
    cell.dataset.date = ds;

    const head = document.createElement('div');
    head.className = 'cell-head';
    const num = document.createElement('div');
    num.className = 'cell-num';
    num.textContent = d.getDate();
    num.onclick = (e) => { e.stopPropagation(); openDay(ds); };
    const add = document.createElement('button');
    add.className = 'cell-add';
    add.textContent = '+';
    add.title = '新建';
    add.onclick = (e) => { e.stopPropagation(); newEvent(ds, '09:00'); };
    head.append(num, add);

    const wrap = document.createElement('div');
    wrap.className = 'cell-events';
    const evs = eventsOn(ds);
    const fit = planFit(evs.length);
    if (fit.compact) wrap.classList.add('compact');
    evs.slice(0, fit.k).forEach((ev) => {
      const chip = evChip(ev);
      if (fit.compact) chip.classList.add('compact');
      wrap.appendChild(chip);
    });
    if (evs.length > fit.k) {
      const more = document.createElement('div');
      more.className = 'more-count';
      more.textContent = `还有 ${evs.length - fit.k} 项`;
      more.onclick = (e) => { e.stopPropagation(); openDay(ds); };
      wrap.appendChild(more);
    }

    cell.append(head, wrap);
    cell.onclick = () => {
      state.selected = ds;
      if (isOther) state.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
      renderMonth();
    };
    cell.ondblclick = (e) => {
      if (e.target.closest('.ev-chip')) return;
      newEvent(ds, '09:00');
    };
    frag.appendChild(cell);
  });

  el.monthGrid.appendChild(frag);
}

function evChip(ev) {
  const c = catOf(ev);
  const chip = document.createElement('div');
  chip.className = 'ev-chip' + (ev.done ? ' done' : '');
  chip.style.background = c.soft;
  chip.style.borderLeftColor = c.dot;
  chip.title = `${c.name} · ${ev.start || ''} ${ev.title}${ev.note ? '\n' + ev.note : ''}`;

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = c.dot;

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = ev.start || '';

  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = ev.title || '(无标题)';

  chip.append(dot, t, n);
  if (ev.groupId) chip.appendChild(repIcon(9));
  chip.onclick = (e) => { e.stopPropagation(); openEditor(ev.id); };
  return chip;
}

// ============================================================
//  日视图
// ============================================================
function renderDay() {
  const d = state.cursor;
  const ds = ymd(d);
  el.periodLabel.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  el.dayHeadTitle.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const diffDays = Math.round((parseYmd(ds) - parseYmd(ymd(new Date()))) / 86400000);
  const rel = diffDays === 0 ? '今天' : diffDays === 1 ? '明天' : diffDays === -1 ? '昨天' : '';
  el.dayHeadSub.textContent = `${WEEK_CN[d.getDay()]}${rel ? ' · ' + rel : ''}`;

  // 小时刻度
  if (!el.hourCol.childElementCount) {
    for (let h = 0; h < 24; h++) {
      const row = document.createElement('div');
      row.className = 'hour-row';
      const s = document.createElement('span');
      s.textContent = `${pad(h)}:00`;
      row.appendChild(s);
      el.hourCol.appendChild(row);
    }
  }

  // 事件块
  const evs = eventsOn(ds).map((ev) => ({
    ev,
    s: toMin(ev.start),
    e: toMin(ev.start) + durationMin(ev)
  }));
  const laid = computeLayout(evs);

  el.dayEvents.innerHTML = '';
  laid.forEach((item) => {
    const ev = item.ev;
    const c = catOf(ev);
    const node = document.createElement('div');
    node.className = 'day-ev' + (ev.done ? ' done' : '');
    node.dataset.id = ev.id;
    node.style.top = `${(item.s / 60) * PX_PER_HOUR}px`;
    node.style.height = `${Math.max(24, ((item.e - item.s) / 60) * PX_PER_HOUR - 2)}px`;
    node.style.background = c.soft;
    node.style.borderLeftColor = c.dot;
    node.style.color = c.dot;

    const total = item.totalCols || 1;
    const col = item.col || 0;
    if (total > 1) {
      node.style.left = `calc(6px + (100% - 14px) * ${col / total})`;
      node.style.width = `calc((100% - 14px) / ${total} - 3px)`;
      node.style.right = 'auto';
    }

    const title = document.createElement('div');
    title.className = 'ev-title';
    title.textContent = ev.title || '(无标题)';
    const tm = document.createElement('div');
    tm.className = 'ev-time';
    tm.textContent = `${ev.start || ''}${ev.end ? ' – ' + ev.end : ''}`;
    if (ev.groupId) tm.appendChild(repIcon(10));
    node.append(title, tm);

    node.addEventListener('mousedown', (e) => startDrag(e, ev, node));
    el.dayEvents.appendChild(node);
  });

  updateNowLine();
  // 滚动到今天的时间附近
  setTimeout(() => {
    const targetMin = diffDays === 0 ? new Date().getHours() * 60 - 120 : 8 * 60;
    el.dayScroll.scrollTop = Math.max(0, (targetMin / 60) * PX_PER_HOUR);
  }, 0);
}

function computeLayout(items) {
  const sorted = [...items].sort((a, b) => a.s - b.s || a.e - b.e);
  const groups = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur || it.s >= cur.end) {
      cur = { end: it.e, items: [it] };
      groups.push(cur);
    } else {
      cur.items.push(it);
      cur.end = Math.max(cur.end, it.e);
    }
  }
  for (const g of groups) {
    const colEnds = [];
    for (const it of g.items) {
      let col = 0;
      while (colEnds[col] !== undefined && colEnds[col] > it.s) col++;
      colEnds[col] = it.e;
      it.col = col;
    }
    g.cols = colEnds.length;
  }
  for (const g of groups) for (const it of g.items) it.totalCols = g.cols;
  return sorted;
}

function updateNowLine() {
  const isToday = sameDay(state.cursor, new Date());
  if (!isToday || state.view !== 'day') {
    el.nowLine.classList.add('hidden');
    return;
  }
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  el.nowLine.classList.remove('hidden');
  el.nowLine.style.top = `${(min / 60) * PX_PER_HOUR}px`;
}

// ---------- 拖动事件 ----------
function startDrag(e, ev, node) {
  if (e.button !== 0) return;
  e.preventDefault();
  const startY = e.clientY;
  const origTop = (toMin(ev.start) / 60) * PX_PER_HOUR;
  const dur = durationMin(ev);
  let moved = false;

  node.classList.add('dragging');

  const onMove = (evt) => {
    const dy = evt.clientY - startY;
    if (Math.abs(dy) > 3) moved = true;
    const rawMin = (origTop + dy) / PX_PER_HOUR * 60;
    const snapped = Math.round(rawMin / SNAP_MIN) * SNAP_MIN;
    const clamped = Math.max(0, Math.min(24 * 60 - dur, snapped));
    node.style.top = `${(clamped / 60) * PX_PER_HOUR}px`;
    node.dataset.tmpStart = fromMin(clamped);
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    node.classList.remove('dragging');
    if (moved && node.dataset.tmpStart) {
      const newStart = node.dataset.tmpStart;
      const evObj = state.data.events.find((x) => x.id === ev.id);
      if (evObj) {
        pushUndo('调整时间');
        evObj.start = newStart;
        evObj.end = fromMin(toMin(newStart) + dur);
        evObj.firedAt = null;
        persist();
      }
      renderDay();
      toast('已调整到 ' + newStart);
    } else {
      openEditor(ev.id);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ============================================================
//  渲染调度
// ============================================================
function render() {
  const isStudy = state.view === 'study';
  el.monthView.classList.toggle('hidden', state.view !== 'month');
  el.dayView.classList.toggle('hidden', state.view !== 'day');
  el.studyView.classList.toggle('hidden', !isStudy);

  // 学习视图没有"上一页/下一页"的概念，收起翻页控件
  el.btnPrev.classList.toggle('hidden', isStudy);
  el.btnNext.classList.toggle('hidden', isStudy);
  el.btnToday.classList.toggle('hidden', isStudy);
  el.btnReport.classList.toggle('hidden', isStudy);
  if (el.searchWrap) el.searchWrap.classList.toggle('hidden', isStudy);
  el.periodLabel.textContent = isStudy ? '学习笔记' : el.periodLabel.textContent;

  if (state.view === 'month') renderMonth();
  else if (state.view === 'day') renderDay();
  else renderStudy();

  if (!isStudy) renderSidebar();
  else renderSidebarStatsOnly();
  updateSeg();
}

function updateSeg() {
  [...el.viewSeg.children].forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
}

function openDay(dateStr) {
  state.cursor = parseYmd(dateStr);
  state.selected = dateStr;
  setView('day');
}

function setView(v) {
  state.view = v;
  if (v === 'month' && state.cursor) {
    // 保持月份
  }
  render();
}

// ============================================================
//  抽屉 / 编辑
// ============================================================
function buildColorPicker() {
  el.evColors.innerHTML = '';
  CATS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cat-opt' + (c.key === state.editingColor ? ' on' : '');
    b.dataset.color = c.key;
    b.style.setProperty('--c', c.dot);
    b.innerHTML = `<span class="cd" style="background:${c.dot}"></span><span class="cn">${c.name}</span>`;
    b.onclick = () => {
      state.editingColor = c.key;
      [...el.evColors.children].forEach((x) => x.classList.toggle('on', x.dataset.color === c.key));
    };
    el.evColors.appendChild(b);
  });
}

function openDrawer() {
  state.drawerOpen = true;
  el.app.classList.add('drawer-open');
}

function closeDrawer() {
  state.drawerOpen = false;
  el.app.classList.remove('drawer-open');
  state.editingId = null;
}

function syncUntilField() {
  const hasRepeat = !!el.evRepeat.value;
  el.untilField.classList.toggle('hidden', !hasRepeat);
  if (hasRepeat && !el.evUntil.value) {
    el.evUntil.value = defaultUntil(el.evDate.value || ymd(new Date()), el.evRepeat.value);
  }
}

function newEvent(dateStr, startTime) {
  state.editingId = null;
  state.editingColor = DEFAULT_CAT;
  const start = startTime || '09:00';
  el.drawerTitle.textContent = '新建日程';
  el.evTitle.value = '';
  el.evDate.value = dateStr || ymd(state.cursor);
  el.evStart.value = start;
  el.evEnd.value = fromMin(toMin(start) + 60);
  el.evRemind.value = '10';
  el.evNote.value = '';
  el.evDone.checked = false;
  el.evRepeat.value = '';
  el.evUntil.value = '';
  el.untilField.classList.add('hidden');
  el.applyAllRow.classList.add('hidden');
  el.evApplyAll.checked = false;
  el.repeatTip.classList.add('hidden');
  el.btnDeleteSeries.classList.add('hidden');
  el.btnDelete.textContent = '删除';
  el.btnDelete.classList.add('hidden');
  buildColorPicker();
  openDrawer();
  setTimeout(() => el.evTitle.focus(), 60);
}

function openEditor(id) {
  const ev = state.data.events.find((e) => e.id === id);
  if (!ev) return;
  state.editingId = id;
  state.editingColor = catKey(ev.color);
  el.drawerTitle.textContent = '编辑日程';
  el.evTitle.value = ev.title || '';
  el.evDate.value = ev.date || ymd(state.cursor);
  el.evStart.value = ev.start || '09:00';
  el.evEnd.value = ev.end || '';
  el.evRemind.value = String(ev.remind === undefined || ev.remind === null ? 10 : ev.remind);
  el.evNote.value = ev.note || '';
  el.evDone.checked = !!ev.done;
  el.evRepeat.value = ev.repeat || '';
  el.evUntil.value = ev.until || '';
  syncUntilField();

  const isSeries = !!ev.groupId;
  el.applyAllRow.classList.toggle('hidden', !isSeries);
  el.evApplyAll.checked = false;
  el.btnDeleteSeries.classList.toggle('hidden', !isSeries);
  el.btnDelete.textContent = isSeries ? '删除此条' : '删除';
  el.btnDelete.classList.remove('hidden');

  if (isSeries) {
    const n = seriesCount(ev.groupId);
    el.repeatTip.textContent = `这是「${REPEAT_LABEL[ev.repeat] || '重复'}」系列中的一条，系列共 ${n} 条。只改这条不会影响其他日期。`;
    el.repeatTip.classList.remove('hidden');
  } else {
    el.repeatTip.classList.add('hidden');
  }

  buildColorPicker();
  openDrawer();
}

function saveEvent() {
  const title = el.evTitle.value.trim();
  const date = el.evDate.value || ymd(state.cursor);
  const start = el.evStart.value || '09:00';
  const end = el.evEnd.value || '';
  const repeat = el.evRepeat.value;
  const until = repeat ? (el.evUntil.value || defaultUntil(date, repeat)) : null;

  if (!title) { toast('请填写标题'); el.evTitle.focus(); return; }
  if (end && toMin(end) <= toMin(start)) { toast('结束时间要晚于开始时间'); return; }

  pushUndo(state.editingId ? '修改日程' : '新建日程');

  const now = Date.now();
  const base = {
    title,
    start,
    end,
    remind: Number(el.evRemind.value),
    note: el.evNote.value.trim(),
    color: state.editingColor,
    done: el.evDone.checked,
    repeat: repeat || null,
    until: until,
    firedAt: null,
    createdAt: now
  };

  let message = '';

  if (state.editingId) {
    const ev = state.data.events.find((e) => e.id === state.editingId);
    if (!ev) return;
    const isSeries = !!ev.groupId;
    const applyAll = isSeries && el.evApplyAll.checked;

    if (applyAll) {
      const gid = ev.groupId;
      const from = ev.date;
      state.data.events = state.data.events.filter((x) => !(x.groupId === gid && x.date >= from));

      if (repeat) {
        const dates = expandDates(date, repeat, until);
        dates.forEach((ds) => {
          state.data.events.push({ ...base, id: uid(), date: ds, groupId: gid });
        });
        message = `已更新整个系列（${dates.length} 条）`;
      } else {
        state.data.events.push({ ...base, id: uid(), date, groupId: null });
        message = '已取消重复';
      }
    } else {
      const timeChanged = ev.date !== date || ev.start !== start;
      Object.assign(ev, base, { date });

      if (isSeries && !repeat) {
        ev.groupId = null;
        ev.repeat = null;
        ev.until = null;
        message = '已取消这一条的重复';
      } else if (repeat && repeat !== ev.repeat) {
        ev.groupId = 'g_' + uid();
        const rest = expandDates(date, repeat, until).slice(1);
        rest.forEach((ds) => {
          state.data.events.push({ ...base, id: uid(), date: ds, groupId: ev.groupId });
        });
        message = `已改为「${REPEAT_LABEL[repeat]}」，新增 ${rest.length} 条`;
      } else if (!isSeries && repeat) {
        ev.groupId = 'g_' + uid();
        const rest = expandDates(date, repeat, until).slice(1);
        rest.forEach((ds) => {
          state.data.events.push({ ...base, id: uid(), date: ds, groupId: ev.groupId });
        });
        message = `已开启「${REPEAT_LABEL[repeat]}」，新增 ${rest.length} 条`;
      }

      if (timeChanged) ev.firedAt = null;
      if (!message) message = '已更新';
    }
  } else if (repeat) {
    const gid = 'g_' + uid();
    const dates = expandDates(date, repeat, until);
    dates.forEach((ds) => {
      state.data.events.push({ ...base, id: uid(), date: ds, groupId: gid });
    });
    message = `已创建 ${dates.length} 个「${REPEAT_LABEL[repeat]}」日程`;
  } else {
    state.data.events.push({ ...base, id: uid(), date, groupId: null });
    message = '已新建';
  }

  persist(true);
  state.cursor = parseYmd(date);
  closeDrawer();
  render();
  toast(message);
}

function deleteEvent(wholeSeries) {
  if (!state.editingId) return;
  const ev = state.data.events.find((e) => e.id === state.editingId);
  if (!ev) return;

  if (wholeSeries && ev.groupId) {
    const n = seriesCount(ev.groupId);
    if (!confirm(`删除整个重复系列（共 ${n} 条）？`)) return;
    pushUndo('删除重复系列');
    state.data.events = state.data.events.filter((e) => e.groupId !== ev.groupId);
    persist(true);
    closeDrawer();
    render();
    toast(`已删除 ${n} 条`);
    return;
  }

  if (!confirm(`删除「${ev.title || '这条日程'}」？`)) return;
  pushUndo('删除日程');
  state.data.events = state.data.events.filter((e) => e.id !== state.editingId);
  persist(true);
  closeDrawer();
  render();
  toast('已删除');
}

// ============================================================
//  快速添加（⌘K）
// ============================================================
const WEEK_IDX = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function relDayLabel(dateStr) {
  const diff = Math.round((parseYmd(dateStr) - parseYmd(ymd(new Date()))) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  return '';
}

// 把一句话解析成日程字段
function parseQuick(raw) {
  let s = ' ' + String(raw || '').replace(/\s+/g, ' ').trim() + ' ';
  const now = new Date();
  const r = {
    date: ymd(now),
    start: '09:00',
    end: '10:00',
    repeat: null,
    title: '',
    hasDate: false,
    hasTime: false
  };
  const strip = (re) => { s = s.replace(re, ' '); };

  // --- 重复（工作日要先于"每天"判断）---
  let repDow = null;   // 每周X 的星期几
  let repDom = null;   // 每月X号 的日子
  if (/每(个)?工作日/.test(s)) {
    r.repeat = 'weekday';
    strip(/每(个)?工作日/);
  } else if (/每(天|日)/.test(s)) {
    r.repeat = 'daily';
    strip(/每(天|日)/);
  } else {
    const mWeek = s.match(/每(个)?\s*(周|星期|礼拜)\s*([一二三四五六日天])?/);
    const mMon = s.match(/每(个)?月\s*(\d{1,2})?\s*[日号]?/);
    if (mWeek) {
      r.repeat = 'weekly';
      repDow = mWeek[3] ? WEEK_IDX[mWeek[3]] : null;
      strip(/每(个)?\s*(周|星期|礼拜)\s*[一二三四五六日天]?/);
    } else if (mMon) {
      r.repeat = 'monthly';
      repDom = mMon[2] ? Number(mMon[2]) : null;
      strip(/每(个)?月\s*\d{0,2}\s*[日号]?/);
    }
  }

  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // --- 日期：N月N日 优先（已过去的自动顺延到明年）---
  const mMonth = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (mMonth) {
    const mo = Number(mMonth[1]);
    const dd = Number(mMonth[2]);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
      let cand = new Date(now.getFullYear(), mo - 1, dd);
      if (cand < today0) cand = new Date(now.getFullYear() + 1, mo - 1, dd);
      r.date = ymd(cand);
      r.hasDate = true;
      strip(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    }
  }

  // --- 日期：今天 / 明天 / 后天 ---
  if (!r.hasDate) {
    const rels = [['大后天', 3], ['后天', 2], ['明天', 1], ['明日', 1], ['今天', 0], ['今日', 0]];
    for (const [k, v] of rels) {
      if (s.includes(k)) {
        r.date = ymd(addDays(now, v));
        r.hasDate = true;
        s = s.replace(k, ' ');
        break;
      }
    }
  }

  // --- 日期：周X / 下周X ---
  if (!r.hasDate) {
    const mw = s.match(/(下|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/);
    if (mw) {
      const target = WEEK_IDX[mw[2]];
      // diff = 从今天起的下一个该星期几（0..6）；"下"再加一周
      let diff = (target - now.getDay() + 7) % 7;
      if (mw[1] === '下') diff += 7;
      r.date = ymd(addDays(now, diff));
      r.hasDate = true;
      strip(/(下|这|本)?\s*(?:个)?\s*(?:周|星期|礼拜)\s*[一二三四五六日天]/);
    }
  }

  // --- 日期：由「每周X」或「每月X号」决定起始日 ---
  if (!r.hasDate && repDow !== null) {
    let diff = (repDow - now.getDay() + 7) % 7;
    r.date = ymd(addDays(now, diff));
    r.hasDate = true;
  }
  if (!r.hasDate && repDom !== null) {
    let cand = new Date(now.getFullYear(), now.getMonth(), repDom);
    if (cand < today0) cand = new Date(now.getFullYear(), now.getMonth() + 1, repDom);
    r.date = ymd(cand);
    r.hasDate = true;
  }

  // --- 时间 ---
  const mTime = s.match(/(凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|晚间)?\s*(\d{1,2})\s*([:：点时])\s*(\d{1,2}|半)?\s*分?/);
  if (mTime) {
    const period = mTime[1] || '';
    let h = Number(mTime[2]);
    let mi = 0;
    if (mTime[4] === '半') mi = 30;
    else if (mTime[4]) mi = Number(mTime[4]);

    if (['下午', '傍晚', '晚上', '夜里', '晚间'].includes(period)) {
      if (h < 12) h += 12;
    } else if (period === '中午') {
      if (h < 11) h += 12;
    } else if (['凌晨', '早上', '早晨', '清晨', '上午'].includes(period)) {
      if (h === 12) h = 0;
    }

    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      r.start = `${pad(h)}:${pad(mi)}`;
      r.end = fromMin(h * 60 + mi + 60);
      r.hasTime = true;
      strip(/(凌晨|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|晚间)?\s*\d{1,2}\s*[:：点时]\s*(\d{1,2}|半)?\s*分?/);
    }
  }

  r.title = s.replace(/\s+/g, ' ').trim();
  return r;
}

function renderQuickPreview() {
  const raw = el.quickInput.value.trim();
  if (!raw) {
    el.quickPreview.innerHTML = '<span style="color:#b3b9c4">试试「明天下午3点 开会」「每周一 9:30 站会」</span>';
    return;
  }
  const p = parseQuick(raw);
  const d = parseYmd(p.date);
  const rel = relDayLabel(p.date);

  const bits = [
    `<span class="k">${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()].slice(-1)}${rel ? ' · ' + rel : ''}</span>`,
    `<span class="k">${p.start}–${p.end}</span>`
  ];
  if (p.repeat) bits.push(`<span class="k">${REPEAT_LABEL[p.repeat]}</span>`);
  bits.push(`<b>${escapeHtml(p.title || '未命名日程')}</b>`);
  el.quickPreview.innerHTML = bits.join('');
}

function openQuick() {
  el.quickOverlay.classList.remove('hidden');
  el.quickInput.value = '';
  renderQuickPreview();
  setTimeout(() => el.quickInput.focus(), 40);
}

function closeQuick() {
  el.quickOverlay.classList.add('hidden');
  el.quickInput.blur();
}

function commitQuick() {
  const raw = el.quickInput.value.trim();
  if (!raw) return;
  const p = parseQuick(raw);
  const title = p.title || '未命名日程';
  const base = {
    title,
    start: p.start,
    end: p.end,
    remind: 10,
    note: '',
    color: DEFAULT_CAT,
    done: false,
    repeat: p.repeat,
    until: p.repeat ? defaultUntil(p.date, p.repeat) : null,
    firedAt: null,
    createdAt: Date.now()
  };

  let message = '';
  if (p.repeat) {
    const gid = 'g_' + uid();
    const dates = expandDates(p.date, p.repeat, base.until);
    dates.forEach((ds) => {
      state.data.events.push({ ...base, id: uid(), date: ds, groupId: gid });
    });
    message = `已创建 ${dates.length} 个「${REPEAT_LABEL[p.repeat]}」日程`;
  } else {
    state.data.events.push({ ...base, id: uid(), date: p.date, groupId: null });
    message = `已创建：${title}`;
  }

  persist(true);
  closeQuick();
  state.cursor = parseYmd(p.date);
  state.selected = p.date;
  render();
  toast(message);
}

// ============================================================
//  周报整理
// ============================================================
const MD_WN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const longDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const hh = (min) => (min / 60).toFixed(1);

function buildWeek(anchor) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const strs = days.map(ymd);
  const evs = state.data.events.filter((e) => strs.includes(e.date));

  const perDay = days.map((d, i) => ({
    date: strs[i],
    dateObj: d,
    evs: evs
      .filter((e) => e.date === strs[i])
      .sort((a, b) => toMin(a.start) - toMin(b.start))
  }));

  const total = evs.length;
  const doneCount = evs.filter((e) => e.done).length;
  const totalMin = evs.reduce((s, e) => s + durationMin(e), 0);
  const activeDays = perDay.filter((p) => p.evs.length).length;

  let busiest = null;
  perDay.forEach((p) => {
    if (!busiest || p.evs.length > busiest.evs.length) busiest = p;
  });
  if (busiest && !busiest.evs.length) busiest = null;

  const catMap = {};
  evs.forEach((e) => {
    const k = catKey(e.color);
    catMap[k] = catMap[k] || { n: 0, min: 0, done: 0 };
    catMap[k].n += 1;
    catMap[k].min += durationMin(e);
    if (e.done) catMap[k].done += 1;
  });
  const cats = Object.entries(catMap)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.min - a.min);

  const rangeStart = start.getTime();
  const rangeEnd = addDays(start, 7).getTime();
  const doneTodos = state.data.todos.filter(
    (t) => t.done && t.doneAt && t.doneAt >= rangeStart && t.doneAt < rangeEnd
  );
  const openTodos = state.data.todos.filter((t) => !t.done);

  // 下周前瞻
  const nextStrs = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, 7 + i)));
  const nextEvs = state.data.events
    .filter((e) => nextStrs.includes(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start))
    .slice(0, 6);

  return {
    start, end: days[6], days, strs, perDay,
    total, doneCount, totalMin, activeDays, busiest, cats,
    doneTodos, openTodos, nextEvs
  };
}

function buildWeekText(w) {
  const s = w.start;
  const e = w.end;
  const pct = w.total ? Math.round((w.doneCount / w.total) * 100) : 0;
  const L = [];

  L.push(`# 第 ${weekNumberOf(s)} 周周报（${s.getFullYear()} 年 ${s.getMonth() + 1} 月 ${s.getDate()} 日 – ${e.getMonth() + 1} 月 ${e.getDate()} 日）`);
  L.push('');

  L.push('## 一、本周概览');
  L.push(`- 日程 ${w.total} 项，已完成 ${w.doneCount} 项（${pct}%）`);
  L.push(`- 排期时长 ${hh(w.totalMin)} 小时${w.activeDays ? `，覆盖 ${w.activeDays} 天` : ''}`);
  if (w.busiest) {
    L.push(`- 最忙的一天：${longDate(w.busiest.dateObj)} ${MD_WN[w.busiest.dateObj.getDay()]}（${w.busiest.evs.length} 项）`);
  }
  if (w.doneTodos.length) L.push(`- 完成待办 ${w.doneTodos.length} 项`);
  L.push('');

  L.push('## 二、每日明细');
  let has = false;
  w.perDay.forEach((p) => {
    if (!p.evs.length) return;
    has = true;
    L.push(`**${longDate(p.dateObj)} ${MD_WN[p.dateObj.getDay()]}** · ${p.evs.length} 项`);
    p.evs.forEach((ev) => {
      const tm = ev.start ? `${ev.start}${ev.end ? '–' + ev.end : ''}  ` : '';
      const note = ev.note ? `（${String(ev.note).replace(/\s*\n\s*/g, '；')}）` : '';
      L.push(`- ${tm}${ev.title || '(无标题)'}${ev.done ? ' ✓' : ''}${note}`);
    });
    L.push('');
  });
  if (!has) { L.push('本周暂无日程。'); L.push(''); }

  // 章节编号从「三」起，按实际存在的段落递增
  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八'];
  let sec = 3;

  if (w.cats.length) {
    L.push(`## ${CN_NUM[sec - 1]}、分类分布`);
    sec += 1;
    w.cats.forEach((c) => {
      const share = w.totalMin ? Math.round((c.min / w.totalMin) * 100) : 0;
      L.push(`- ${(CAT[c.key] || CAT[DEFAULT_CAT]).name}：${c.n} 项 / ${hh(c.min)} 小时（${share}%）`);
    });
    L.push('');
  }

  const undone = w.perDay.flatMap((p) =>
    p.evs.filter((ev) => !ev.done).map((ev) => ({ ev, d: p.dateObj }))
  );
  if (undone.length) {
    L.push(`## ${CN_NUM[sec - 1]}、未完成`);
    sec += 1;
    undone.forEach(({ ev, d }) => {
      L.push(`- ${longDate(d)} ${MD_WN[d.getDay()]} ${ev.start || ''} ${ev.title || '(无标题)'}`.replace(/\s+/g, ' '));
    });
    L.push('');
  }

  L.push(`## ${CN_NUM[sec - 1]}、待办`);
  sec += 1;
  if (w.doneTodos.length) {
    L.push(`已完成 ${w.doneTodos.length} 项：`);
    w.doneTodos.slice(0, 12).forEach((t) => L.push(`- [x] ${t.title}`));
  } else {
    L.push('本周没有待办完成记录。');
  }
  if (w.openTodos.length) {
    L.push('');
    L.push(`未完成 ${w.openTodos.length} 项：`);
    w.openTodos.slice(0, 12).forEach((t) => L.push(`- [ ] ${t.title}`));
  }
  L.push('');

  L.push(`## ${CN_NUM[sec - 1]}、下周计划`);
  if (w.nextEvs.length) {
    w.nextEvs.forEach((ev) => {
      const d = parseYmd(ev.date);
      L.push(`- ${longDate(d)} ${MD_WN[d.getDay()]} ${ev.start || ''} ${ev.title || '(无标题)'}`.replace(/\s+/g, ' '));
    });
  } else {
    L.push('-（下周暂无排期，可在此补充计划）');
  }

  return L.join('\n');
}

function renderReport() {
  const w = buildWeek(state.reportAnchor);
  state.reportKey = isoWeekKey(state.reportAnchor);

  el.reportRange.textContent =
    `${w.start.getFullYear()} 年 ${w.start.getMonth() + 1} 月 ${w.start.getDate()} 日 – ` +
    `${w.end.getMonth() + 1} 月 ${w.end.getDate()} 日 · 第 ${weekNumberOf(w.start)} 周`;

  // 概览
  const pct = w.total ? Math.round((w.doneCount / w.total) * 100) : 0;
  el.reportStats.innerHTML = `
    <div class="stat-card">
      <div class="v">${w.total}</div>
      <div class="k">日程总数</div>
    </div>
    <div class="stat-card hl">
      <div class="v">${pct}<small>%</small></div>
      <div class="k">完成 ${w.doneCount} 项</div>
    </div>
    <div class="stat-card">
      <div class="v">${hh(w.totalMin)}<small>h</small></div>
      <div class="k">排期时长</div>
    </div>
    <div class="stat-card">
      <div class="v" style="font-size:${w.busiest ? '14px' : '20px'};letter-spacing:-0.2px">
        ${w.busiest ? longDate(w.busiest.dateObj) : '—'}
      </div>
      <div class="k">${w.busiest ? `最忙 ${w.busiest.evs.length} 项` : '最忙的一天'}</div>
    </div>`;

  // 分类
  el.reportCats.innerHTML = '';
  if (!w.cats.length) {
    el.reportCats.innerHTML = '<div class="empty-tip" style="padding:14px 0">本周没有记录</div>';
  } else {
    const maxMin = Math.max(...w.cats.map((c) => c.min), 1);
    w.cats.forEach((c) => {
      const col = CAT[c.key] || CAT[DEFAULT_CAT];
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = `
        <span class="nm" style="color:${col.dot};font-weight:600">${col.name}</span>
        <span class="cat-track"><span class="cat-fill" style="width:${Math.max(4, (c.min / maxMin) * 100)}%;background:${col.dot}"></span></span>
        <span class="num">${c.n} 项 · ${hh(c.min)}h</span>`;
      el.reportCats.appendChild(row);
    });
  }

  // 每日明细
  const todayStr = ymd(new Date());
  el.reportDays.innerHTML = '';
  w.perDay.forEach((p) => {
    const box = document.createElement('div');
    box.className = 'day-block' + (p.date === todayStr ? ' today-block' : '');
    const head = document.createElement('div');
    head.className = 'day-block-head';
    head.innerHTML =
      `<span class="d">${longDate(p.dateObj)}</span>` +
      `<span class="w">${MD_WN[p.dateObj.getDay()]}</span>` +
      `<span class="c">${p.evs.length ? `${p.evs.length} 项` : '空'}</span>`;
    box.appendChild(head);

    if (!p.evs.length) {
      const em = document.createElement('div');
      em.className = 'day-block-empty';
      em.textContent = '无安排';
      box.appendChild(em);
    } else {
      const rows = document.createElement('div');
      rows.className = 'day-rows';
      p.evs.forEach((ev) => {
        const col = catOf(ev);
        const r = document.createElement('div');
        r.className = 'day-row' + (ev.done ? ' done' : '');
        r.innerHTML =
          `<span class="bar" style="background:${col.dot}"></span>` +
          `<span class="tm">${ev.start || '—'}</span>` +
          `<span class="tt">${escapeHtml(ev.title || '(无标题)')}</span>` +
          (ev.done ? '<span class="ok">✓</span>' : '<span class="no"></span>');
        r.onclick = () => { closeReport(); state.cursor = parseYmd(ev.date); state.selected = ev.date; state.view = 'day'; render(); openEditor(ev.id); };
        rows.appendChild(r);
      });
      box.appendChild(rows);
    }
    el.reportDays.appendChild(box);
  });

  // 待办
  el.reportTodos.innerHTML = '';
  if (!w.doneTodos.length && !w.openTodos.length) {
    el.reportTodos.innerHTML = '<div class="empty-tip" style="padding:12px 0">没有待办</div>';
  } else {
    w.doneTodos.slice(0, 8).forEach((t) => {
      const r = document.createElement('div');
      r.className = 'todo-sum-row ok';
      r.innerHTML = `<span class="bx">✓</span><span class="tx">${escapeHtml(t.title)}</span>`;
      el.reportTodos.appendChild(r);
    });
    const rest = w.openTodos.slice(0, 8);
    rest.forEach((t) => {
      const r = document.createElement('div');
      r.className = 'todo-sum-row';
      r.innerHTML = `<span class="bx">○</span><span class="tx">${escapeHtml(t.title)}</span>`;
      el.reportTodos.appendChild(r);
    });
    const moreDone = w.doneTodos.length - 8;
    const moreOpen = w.openTodos.length - 8;
    if (moreDone > 0 || moreOpen > 0) {
      const r = document.createElement('div');
      r.className = 'todo-sum-row';
      r.style.color = 'var(--text-4)';
      r.innerHTML = `<span class="bx"></span><span class="tx">另有 ${Math.max(0, moreDone)} 项已完成、${Math.max(0, moreOpen)} 项未完成</span>`;
      el.reportTodos.appendChild(r);
    }
  }

  // 正文
  const saved = state.data.weekNotes && state.data.weekNotes[state.reportKey];
  el.reportText.value = typeof saved === 'string' && saved.trim() ? saved : buildWeekText(w);
  el.reportText.classList.toggle('edited', typeof saved === 'string' && !!saved.trim());
  el.reportSaved.textContent = typeof saved === 'string' && saved.trim() ? '手改版本' : '自动生成';
}

let reportSaveTimer = null;

function openReport() {
  if (state.drawerOpen) closeDrawer();
  state.reportAnchor = new Date();
  el.reportOverlay.classList.remove('hidden');
  renderReport();
}

function closeReport() {
  el.reportOverlay.classList.add('hidden');
}

function shiftReportWeek(n) {
  state.reportAnchor = addDays(state.reportAnchor, n * 7);
  renderReport();
}

function regenReport() {
  const saved = state.data.weekNotes && state.data.weekNotes[state.reportKey];
  if (typeof saved === 'string' && saved.trim()) {
    if (!confirm('重新生成会覆盖你手改过的内容，确定？')) return;
    delete state.data.weekNotes[state.reportKey];
    persist(true);
  }
  renderReport();
  toast('已按当前数据重新生成');
}

async function copyReport() {
  const text = el.reportText.value;
  try {
    if (window.api.copyText) await window.api.copyText(text);
    else await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板');
  } catch (e) {
    el.reportText.focus();
    el.reportText.select();
    toast('请按 ⌘C 复制');
  }
}

async function exportReportMd() {
  const res = await window.api.saveFile({
    defaultName: `周报-${state.reportKey}.md`,
    content: el.reportText.value,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.ok) toast('已导出周报');
  else if (res.error) toast('导出失败：' + res.error);
}

// ============================================================
//  设置 / 数据
// ============================================================
async function openSettings() {
  el.settingsOverlay.classList.remove('hidden');
  el.setNotify.checked = state.data.settings.notify !== false;
  try {
    const path = await window.api.dataPath();
    el.dataPathLabel.textContent = `数据保存在本机，每天自动备份一份（保留 14 天）。\n${path}`;
  } catch (e) {}
  try {
    el.setLogin.checked = await window.api.getLogin();
  } catch (e) {}
  try {
    paintAlpha(Math.round((await window.api.widget.getAlpha()) * 100));
  } catch (e) {}
  try {
    paintTheme(await window.api.getTheme());
  } catch (e) {}
  try {
    const info = await window.api.study.info();
    el.mcpDesc.textContent =
      '学习笔记放在本机一个 JSON 文件里，工作台和外部工具读写的是同一份。' +
      '接给 WorkBuddy 后，那边的助手就能直接帮你写学习记录、也能读你记过什么。\n' +
      info.file;
  } catch (e) {}
}

// 外观：跟随系统 / 浅色 / 深色
function paintTheme(pref) {
  [...el.themeSeg.querySelectorAll('button')].forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === (pref || 'system'));
  });
}

[...el.themeSeg.querySelectorAll('button')].forEach((b) => {
  b.onclick = async () => {
    const r = await window.api.setTheme(b.dataset.theme);
    paintTheme(r.pref);
    toast(
      b.dataset.theme === 'system' ? '已跟随系统外观'
        : b.dataset.theme === 'dark' ? '已切换为深色' : '已切换为浅色'
    );
  };
});

// 桌面贴透明度滑杆
function paintAlpha(pct) {
  const v = Math.min(100, Math.max(25, Math.round(pct)));
  el.setWidgetAlpha.value = String(v);
  el.setWidgetAlphaVal.textContent = `${v}%`;
  el.setWidgetAlpha.style.setProperty('--fill', `${((v - 25) / 75) * 100}%`);
}

el.setWidgetAlpha.oninput = () => {
  const v = Number(el.setWidgetAlpha.value) || 55;
  el.setWidgetAlphaVal.textContent = `${v}%`;
  el.setWidgetAlpha.style.setProperty('--fill', `${((v - 25) / 75) * 100}%`);
  window.api.widget.setAlpha(v / 100);
};

function closeSettings() {
  el.settingsOverlay.classList.add('hidden');
}

async function exportJson() {
  const res = await window.api.saveFile({
    defaultName: `日程工作台备份-${ymd(new Date())}.json`,
    content: JSON.stringify(state.data, null, 2),
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  });
  if (res.ok) toast('已导出备份');
  else if (res.error) toast('导出失败：' + res.error);
}

async function importJson() {
  const res = await window.api.openFile({ filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
  if (!res.ok) {
    if (res.error) toast('读取失败：' + res.error);
    return;
  }
  try {
    const incoming = JSON.parse(res.content);
    if (!incoming || !Array.isArray(incoming.events)) throw new Error('文件格式不正确');
    if (!confirm('导入将覆盖当前所有日程与待办，确定继续？')) return;
    pushUndo('导入数据');
    state.data = {
      version: 1,
      events: (incoming.events || []).map((e) => ({ ...e, color: catKey(e.color) })),
      todos: incoming.todos || [],
      settings: { ...state.data.settings, ...(incoming.settings || {}) },
      weekNotes: incoming.weekNotes && typeof incoming.weekNotes === 'object'
        ? incoming.weekNotes
        : (state.data.weekNotes || {})
    };
    persist(true);
    render();
    toast(`已导入 ${state.data.events.length} 个日程、${state.data.todos.length} 项待办`);
  } catch (e) {
    toast('导入失败：' + e.message);
  }
}

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function icsStamp(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

async function exportIcs() {
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ScheduleWorkbench//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  state.data.events.forEach((ev) => {
    const [y, m, d] = ev.date.split('-');
    const s = (ev.start || '09:00').replace(':', '');
    let e = (ev.end || '').replace(':', '');
    if (!e || toMin(ev.end) <= toMin(ev.start)) {
      e = fromMin(toMin(ev.start) + 30).replace(':', '');
    }
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@schedule-workbench.local`);
    lines.push(`DTSTAMP:${icsStamp(now)}`);
    lines.push(`DTSTART:${y}${m}${d}T${s}00`);
    lines.push(`DTEND:${y}${m}${d}T${e}00`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.note) lines.push(`DESCRIPTION:${icsEscape(ev.note)}`);
    if (ev.remind >= 0) {
      lines.push('BEGIN:VALARM');
      lines.push(`TRIGGER:-PT${ev.remind}M`);
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${icsEscape(ev.title)}`);
      lines.push('END:VALARM');
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  const res = await window.api.saveFile({
    defaultName: `日程工作台-${ymd(new Date())}.ics`,
    content: lines.join('\r\n'),
    filters: [{ name: 'iCalendar', extensions: ['ics'] }]
  });
  if (res.ok) toast('已导出 .ics，可导入系统日历');
  else if (res.error) toast('导出失败：' + res.error);
}

// ============================================================
//  学习笔记
// ============================================================
const SOURCES = [
  { key: 'chatgpt', name: 'ChatGPT' },
  { key: 'workbuddy', name: 'WorkBuddy' },
  { key: 'book', name: '书' },
  { key: 'video', name: '视频' },
  { key: 'course', name: '课程' },
  { key: 'other', name: '其他' }
];
const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
const STATUSES = [
  { key: 'new', name: '未消化' },
  { key: 'learning', name: '在学' },
  { key: 'learned', name: '已消化' }
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

const srcOf = (n) => SOURCE[n && n.source] || SOURCE.other;
const stOf = (n) => STATUS[n && n.status] || STATUS.new;

function noteExcerpt(n) {
  const t = String(n.content || '').replace(/[#>*`\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? t.slice(0, 90) + '…' : t;
}

function noteDue(n) {
  if (!n.reviewAt || n.status === 'learned') return null;
  const today = ymd(new Date());
  if (n.reviewAt <= today) return 'due';
  const d = parseYmd(n.reviewAt);
  const days = Math.round((d - parseYmd(today)) / 86400000);
  return days <= 3 ? 'soon' : null;
}

function filteredNotes() {
  const q = state.studySearch.toLowerCase();
  return state.study.notes
    .filter((n) => {
      if (state.studyStatus && n.status !== state.studyStatus) return false;
      if (state.studySource && n.source !== state.studySource) return false;
      if (!q) return true;
      const hay = `${n.title} ${n.content} ${(n.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function renderStudy() {
  const list = filteredNotes();
  const total = state.study.notes.length;
  const openCount = state.study.notes.filter((n) => n.status !== 'learned').length;
  el.studyCount.textContent = state.studyStatus || state.studySource || state.studySearch
    ? `${list.length} / ${total} 条`
    : `${total} 条 · 待消化 ${openCount}`;

  [...el.studyStatusSeg.children].forEach((b) => {
    b.classList.toggle('on', (b.dataset.status || '') === state.studyStatus);
  });

  el.noteList.innerHTML = '';
  if (!list.length) {
    el.noteList.innerHTML = total
      ? '<div class="empty-tip">没有符合条件的笔记<br>换个筛选条件试试</div>'
      : '<div class="empty-tip">还没有学习笔记<br>点右上「新建笔记」，<br>或在 WorkBuddy 里让我帮你记</div>';
  } else {
    const frag = document.createDocumentFragment();
    list.forEach((n) => {
      const src = srcOf(n);
      const st = stOf(n);
      const due = noteDue(n);
      const card = document.createElement('div');
      card.className = 'note-card' + (n.id === state.noteId ? ' on' : '');
      card.dataset.id = n.id;
      card.dataset.src = src.key;
      card.innerHTML = `
        <div class="nc-top">
          <span class="nc-title">${escapeHtml(n.title || '未命名笔记')}</span>
          ${due === 'due' ? '<span class="nc-due">待复习</span>' : ''}
        </div>
        <div class="nc-excerpt">${escapeHtml(noteExcerpt(n)) || '（无正文）'}</div>
        <div class="nc-foot">
          <span class="nc-src">${src.name}</span>
          <span class="nc-st s-${st.key}">${st.name}</span>
          ${(n.tags || []).slice(0, 2).map((t) => `<span class="nc-tag">${escapeHtml(t)}</span>`).join('')}
        </div>`;
      card.onclick = () => openNote(n.id);
      frag.appendChild(card);
    });
    el.noteList.appendChild(frag);
  }

  const cur = state.study.notes.find((n) => n.id === state.noteId);
  if (!cur) {
    state.noteId = null;
    state.studyFormFor = null;
    el.noteEditor.classList.add('hidden');
    el.noteEmpty.classList.remove('hidden');
    return;
  }
  el.noteEmpty.classList.add('hidden');
  el.noteEditor.classList.remove('hidden');
  // 只在切换笔记 / 外部改动时回填，避免保存时重置光标
  if (state.studyFormFor !== cur.id) {
    fillNoteForm(cur);
    state.studyFormFor = cur.id;
  }
}

// 只在切换笔记 / 外部改动时回填，避免打断输入
function fillNoteForm(n) {
  el.noteTitle.value = n.title || '';
  el.noteBody.value = n.content || '';
  el.noteSource.value = n.source || 'other';
  el.noteReview.value = n.reviewAt || '';
  el.noteTags.value = (n.tags || []).join(', ');
  [...el.noteStatus.children].forEach((b) => b.classList.toggle('on', b.dataset.status === n.status));
  const when = new Date(n.updatedAt || Date.now());
  el.noteSaved.textContent = `${n.id} · 更新于 ${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

function openNote(id) {
  const n = state.study.notes.find((x) => x.id === id);
  if (!n) return;
  state.noteId = id;
  state.noteDirty = false;
  state.studyFormFor = null;
  renderStudy();
}

function newNote() {
  const review = ymd(addDays(new Date(), 3));
  window.api.study
    .op({
      op: 'add',
      note: { title: '', content: '', source: 'chatgpt', status: 'new', tags: [], reviewAt: review }
    })
    .then((res) => {
      if (!res || !res.ok) { toast(res && res.error ? res.error : '创建失败'); return; }
      state.study.notes = res.doc.notes;
      state.studyStatus = '';
      state.studySource = '';
      state.studySearch = '';
      el.studySearch.value = '';
      el.studySource.value = '';
      state.noteId = res.id;
      state.noteDirty = false;
      state.studyFormFor = null;
      renderStudy();
      setTimeout(() => { el.noteTitle.focus(); el.noteTitle.select(); }, 60);
    });
}

let noteSaveTimer = null;
function queueNoteSave() {
  state.noteDirty = true;
  el.noteSaved.textContent = '正在保存…';
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(saveNoteNow, 600);
}

async function saveNoteNow() {
  if (!state.noteId) return;
  const payload = {
    op: 'update',
    id: state.noteId,
    patch: {
      title: el.noteTitle.value,
      content: el.noteBody.value,
      source: el.noteSource.value,
      reviewAt: el.noteReview.value || null,
      tags: el.noteTags.value,
      status: (state.study.notes.find((n) => n.id === state.noteId) || {}).status || 'new'
    }
  };
  const res = await window.api.study.op(payload);
  if (!res || !res.ok) { el.noteSaved.textContent = '保存失败'; toast('保存失败'); return; }
  state.study.notes = res.doc.notes;
  state.noteDirty = false;
  const n = state.study.notes.find((x) => x.id === state.noteId);
  if (n) {
    const when = new Date(n.updatedAt || Date.now());
    el.noteSaved.textContent = `${n.id} · 更新于 ${when.getMonth() + 1}/${when.getDate()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  }
  renderNoteListOnly();
}

function renderNoteListOnly() {
  const keepEmpty = el.noteEmpty.classList.contains('hidden');
  renderStudy();
  if (keepEmpty) el.noteEmpty.classList.add('hidden');
}

async function setNoteStatus(st) {
  if (!state.noteId) return;
  clearTimeout(noteSaveTimer);
  const patch = { status: st };
  // 标为已消化时顺手清掉复习日期，免得一直挂着提醒
  if (st === 'learned') patch.reviewAt = null;
  const res = await window.api.study.op({ op: 'update', id: state.noteId, patch });
  if (!res || !res.ok) { toast('更新失败'); return; }
  state.study.notes = res.doc.notes;
  state.noteDirty = false;
  const n = state.study.notes.find((x) => x.id === state.noteId);
  if (n) {
    el.noteReview.value = n.reviewAt || '';
    [...el.noteStatus.children].forEach((b) => b.classList.toggle('on', b.dataset.status === n.status));
    el.noteSaved.textContent = `已标为「${stOf(n).name}」`;
  }
  renderNoteListOnly();
}

async function deleteNote() {
  if (!state.noteId) return;
  const n = state.study.notes.find((x) => x.id === state.noteId);
  if (!n) return;
  if (!window.confirm(`删除「${n.title || '未命名笔记'}」？\n这条笔记会从本机文件里移除，无法撤销。`)) return;
  const res = await window.api.study.op({ op: 'delete', id: state.noteId });
  if (!res || !res.ok) { toast('删除失败'); return; }
  state.study.notes = res.doc.notes;
  state.noteId = null;
  renderStudy();
  toast('已删除');
}

// ============================================================
//  事件绑定
// ============================================================
function bind() {
  // 月 / 日 / 学习 切换
  el.viewSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setView(b.dataset.view);
  });

  // 上/下翻页
  el.btnPrev.onclick = () => {
    if (state.view === 'month') {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
    } else {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), state.cursor.getDate() - 1);
    }
    render();
  };
  el.btnNext.onclick = () => {
    if (state.view === 'month') {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
    } else {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), state.cursor.getDate() + 1);
    }
    render();
  };
  el.btnToday.onclick = () => {
    const now = new Date();
    state.cursor = now;
    state.selected = ymd(now);
    render();
  };

  el.btnNew.onclick = () => {
    const base = state.view === 'day' ? ymd(state.cursor) : state.selected || ymd(new Date());
    const now = new Date();
    const defaultStart = state.view === 'day' ? fromMin(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30) : '09:00';
    newEvent(base, defaultStart);
  };

  // 搜索
  el.searchInput.addEventListener('input', () => {
    state.search = el.searchInput.value.trim();
    render();
  });

  // 待办
  el.todoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTodo(); }
    if (e.key === 'Escape') { el.todoInput.value = ''; el.todoInput.blur(); }
  });
  el.todoAdd.onclick = addTodo;

  // 抽屉
  el.btnSave.onclick = saveEvent;
  el.btnCancel.onclick = closeDrawer;
  el.drawerClose.onclick = closeDrawer;
  el.btnDelete.onclick = () => deleteEvent(false);
  el.btnDeleteSeries.onclick = () => deleteEvent(true);
  el.evRepeat.onchange = syncUntilField;

  // 日视图空白处点击 → 按位置新建
  el.dayBody.addEventListener('click', (e) => {
    if (e.target.closest('.day-ev')) return;
    const rect = el.dayBody.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = Math.max(0, Math.min(23 * 60 + 45, Math.floor((y / PX_PER_HOUR) * 60 / SNAP_MIN) * SNAP_MIN));
    newEvent(ymd(state.cursor), fromMin(min));
  });

  // 快速添加
  el.quickInput.addEventListener('input', renderQuickPreview);
  el.quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitQuick(); }
  });
  el.quickOverlay.addEventListener('click', (e) => {
    if (e.target === el.quickOverlay) closeQuick();
  });

  // 周报
  el.btnReport.onclick = openReport;

  // 桌面组件：常驻小面板，显示今日日程与待办
  el.btnWidget.onclick = async () => {
    const open = await window.api.widget.toggle();
    toast(open ? '组件已显示，可拖动摆到顺手的位置' : '组件已收起');
  };
  el.reportClose.onclick = closeReport;
  el.reportDone.onclick = closeReport;
  el.reportPrev.onclick = () => shiftReportWeek(-1);
  el.reportNext.onclick = () => shiftReportWeek(1);
  el.reportThisWeek.onclick = () => { state.reportAnchor = new Date(); renderReport(); };
  el.reportRegen.onclick = regenReport;
  el.reportCopy.onclick = copyReport;
  el.reportExport.onclick = exportReportMd;
  el.reportOverlay.addEventListener('click', (e) => {
    if (e.target === el.reportOverlay) closeReport();
  });
  el.reportText.addEventListener('input', () => {
    clearTimeout(reportSaveTimer);
    el.reportText.classList.add('edited');
    el.reportSaved.textContent = '正在保存…';
    const key = state.reportKey;
    const val = el.reportText.value;
    reportSaveTimer = setTimeout(() => {
      if (!state.data.weekNotes) state.data.weekNotes = {};
      state.data.weekNotes[key] = val;
      persist(true);
      el.reportSaved.textContent = '已保存手改版本';
    }, 500);
  });

  // ---- 学习笔记 ----
  el.btnNewNote.onclick = newNote;
  el.studyStatusSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.studyStatus = b.dataset.status || '';
    renderStudy();
  });
  el.studySource.onchange = () => {
    state.studySource = el.studySource.value;
    renderStudy();
  };
  el.studySearch.addEventListener('input', () => {
    state.studySearch = el.studySearch.value.trim();
    renderStudy();
  });
  el.studyReveal.onclick = () => window.api.study.reveal();
  el.noteStatus.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setNoteStatus(b.dataset.status);
  });
  el.noteDelete.onclick = deleteNote;
  ['input', 'change'].forEach((evt) => {
    el.noteTitle.addEventListener(evt, queueNoteSave);
    el.noteBody.addEventListener(evt, queueNoteSave);
    el.noteSource.addEventListener(evt, queueNoteSave);
    el.noteReview.addEventListener(evt, queueNoteSave);
    el.noteTags.addEventListener(evt, queueNoteSave);
  });
  el.btnRevealStudy.onclick = () => window.api.study.reveal();
  el.btnCopyMcp.onclick = async () => {
    const info = await window.api.study.info();
    await window.api.copyText(JSON.stringify(info.config, null, 2));
    toast('MCP 配置已复制，粘到 ~/.workbuddy/mcp.json 后重连即可');
  };

  // 设置
  el.btnSettings.onclick = openSettings;
  el.settingsClose.onclick = closeSettings;
  el.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === el.settingsOverlay) closeSettings();
  });

  el.setNotify.onchange = () => {
    state.data.settings.notify = el.setNotify.checked;
    persist();
    toast(el.setNotify.checked ? '提醒已开启' : '提醒已关闭');
  };

  el.setLogin.onchange = async () => {
    const real = await window.api.setLogin(el.setLogin.checked);
    el.setLogin.checked = !!real;
    state.data.settings.launchAtLogin = !!real;
    persist();
    toast(real ? '已设为开机启动' : '已取消开机启动');
  };

  el.btnTestNotify.onclick = async () => {
    await window.api.testNotify();
    toast('已发送，如未看到请到「系统设置 → 通知」允许本应用');
  };

  el.btnExportJson.onclick = exportJson;
  el.btnImportJson.onclick = importJson;
  el.btnExportIcs.onclick = exportIcs;
  el.btnReveal.onclick = () => window.api.revealData();

  // 窗口尺寸变了，格子能放几条也跟着变
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'month') renderMonth();
    }, 140);
  });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if (!el.quickOverlay.classList.contains('hidden')) { closeQuick(); return; }
      if (!el.reportOverlay.classList.contains('hidden')) { closeReport(); return; }
      if (!el.settingsOverlay.classList.contains('hidden')) { closeSettings(); return; }
      if (state.drawerOpen) { closeDrawer(); return; }
      if (inField) document.activeElement.blur();
      return;
    }

    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openQuick(); return; }
    if (meta && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); undo(); return; }
    if (meta && e.key.toLowerCase() === 's' && state.view === 'study') {
      e.preventDefault();
      clearTimeout(noteSaveTimer);
      saveNoteNow();
      toast('已保存');
      return;
    }
    if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); el.btnNew.click(); return; }
    if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); el.searchInput.focus(); el.searchInput.select(); return; }
    if (meta && e.key.toLowerCase() === 't') { e.preventDefault(); el.btnToday.click(); return; }
    if (meta && e.key === 'Enter') {
      if (state.drawerOpen) { e.preventDefault(); saveEvent(); }
      return;
    }
    if (meta) return;

    if (!inField) {
      if (e.key === '1') { setView('month'); }
      if (e.key === '2') { setView('day'); }
      if (e.key === '3') { setView('study'); }
      if (e.key === 'ArrowLeft') { el.btnPrev.click(); }
      if (e.key === 'ArrowRight') { el.btnNext.click(); }
    }
  });

  // 外部（WorkBuddy / MCP / 手动改文件）写入学习笔记：立刻同步过来
  window.api.study.onChanged((doc) => {
    if (!doc || !Array.isArray(doc.notes)) return;
    const prev = state.study.notes;
    state.study.notes = doc.notes;
    if (state.view !== 'study') {
      // 不在学习页时，只在有新增时轻提示，不打断当前操作
      const added = doc.notes.filter((n) => !prev.some((p) => p.id === n.id)).length;
      if (added) toast(`学习笔记 +${added}（来自外部同步）`);
      return;
    }
    const cur = doc.notes.find((n) => n.id === state.noteId);
    if (!cur) {
      state.noteId = null;
      renderStudy();
      return;
    }
    if (!state.noteDirty) {
      state.studyFormFor = null;
      renderStudy();
      el.noteEmpty.classList.add('hidden');
    } else {
      renderNoteListOnly();
    }
  });

  // 主进程推送：数据被后台更新（例如提醒已触发）
  window.api.onDataChanged((data) => {
    if (!data) return;
    state.data.events = data.events || state.data.events;
    state.data.settings = { ...state.data.settings, ...(data.settings || {}) };
    render();
  });

  // 点击通知 → 跳到对应日期
  window.api.onNavigate((payload) => {
    if (payload && payload.view === 'study') {
      setView('study');
      return;
    }
    if (payload && payload.date) {
      state.cursor = parseYmd(payload.date);
      state.selected = payload.date;
      render();
      if (payload.id) openEditor(payload.id);
    }
  });

  // 每分钟刷新当前时间线
  setInterval(() => {
    if (state.view === 'day') updateNowLine();
    renderSidebar();
  }, 60 * 1000);

  // 输入框内允许选中文本
  document.querySelectorAll('input, textarea').forEach((n) => {
    n.style.userSelect = 'text';
  });
}

// ============================================================
//  启动
// ============================================================
async function boot() {
  try {
    const data = await window.api.load();
    if (data) {
      state.data = {
        version: 1,
        events: (data.events || []).map((e) =>
          Object.assign(
            { remind: 10, done: false, firedAt: null, groupId: null, repeat: null, until: null },
            e,
            { color: catKey(e.color) }
          )
        ),
        todos: (data.todos || []).map((t) => ({ done: false, key: false, ...t })),
        settings: { notify: true, ...(data.settings || {}) },
        weekNotes: data.weekNotes && typeof data.weekNotes === 'object' ? data.weekNotes : {}
      };
    }
  } catch (e) {
    console.error('加载数据失败', e);
  }

  try {
    const study = await window.api.study.load();
    if (study && Array.isArray(study.notes)) state.study = study;
  } catch (e) {
    console.error('加载学习笔记失败', e);
  }

  const now = new Date();
  state.cursor = now;
  state.selected = ymd(now);

  bind();
  buildColorPicker();
  render();
}

boot();
