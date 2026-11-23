/* 桌面小组件 —— 今日日程 + 待办 */

const CATS = {
  work: { name: '工作', dot: 'var(--cat-work)' },
  study: { name: '学习', dot: 'var(--cat-study)' },
  fun: { name: '娱乐', dot: 'var(--cat-fun)' }
};
const LEGACY = { blue: 'work', green: 'study', orange: 'fun', red: 'work', purple: 'study', cyan: 'fun' };
const catOf = (v) => CATS[v] || CATS[LEGACY[v]] || CATS.work;

const WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const $ = (id) => document.getElementById(id);

let data = { events: [], todos: [] };
let alpha = 0.55;

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toMin = (t) => {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const nowMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
const gapText = (mins) => {
  if (mins <= 0) return '';
  if (mins < 60) return `${mins} 分钟后`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} 小时 ${m} 分后` : `${h} 小时后`;
};

// ---------- 透明度 ----------
const ALPHA_STEPS = [1, 0.85, 0.7, 0.55, 0.4, 0.28];

function applyAlpha(a) {
  const v = Math.min(1, Math.max(0.25, Number(a) || 0.55));
  alpha = v;
  document.documentElement.style.setProperty('--sheet', String(v));
  const btn = $('wAlpha');
  btn.title = `透明度 ${Math.round(v * 100)}%（点击切换）`;
  btn.classList.toggle('on', v < 0.65);
}

$('wAlpha').onclick = async (e) => {
  e.stopPropagation();
  const next = ALPHA_STEPS.find((v) => v < alpha - 0.02);
  applyAlpha(await window.api.widget.setAlpha(next == null ? ALPHA_STEPS[0] : next));
};

function render() {
  const now = new Date();
  const today = ymd(now);
  const cur = nowMin();
  const tomorrowStr = ymd(addDays(now, 1));

  const todayEvs = (data.events || [])
    .filter((e) => e.date === today)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  const doneEvs = todayEvs.filter((e) => e.done);

  $('wNum').textContent = now.getDate();
  $('wWeek').textContent = WEEK_CN[now.getDay()];
  $('wSub').textContent = `${now.getMonth() + 1} 月 · 今天 ${todayEvs.length} 个日程`;

  // 下一个日程（进行中的优先，其次是还没开始的）
  const ongoing = todayEvs.find(
    (e) => !e.done && toMin(e.start) <= cur && e.end && toMin(e.end) > cur
  );
  const upcoming = todayEvs.find((e) => !e.done && toMin(e.start) > cur);
  const next = ongoing || upcoming;
  const band = $('wNext');
  if (next) {
    band.classList.remove('hidden');
    const c = catOf(next.color);
    $('wNextBar').style.background = c.dot;
    $('wNextTime').textContent = `${next.start || ''}${next.end ? ' – ' + next.end : ''} · ${c.name}`;
    $('wNextTitle').textContent = next.title || '(无标题)';
    $('wNextGap').textContent = ongoing ? '进行中' : gapText(toMin(next.start) - cur);
    band.onclick = () => window.api.widget.openMain({ date: today, id: next.id });
  } else {
    band.classList.add('hidden');
  }

  // 今日日程
  const list = $('wEvents');
  list.innerHTML = '';
  $('wEvCount').textContent = doneEvs.length
    ? `${doneEvs.length}/${todayEvs.length}`
    : String(todayEvs.length);
  if (!todayEvs.length) {
    list.innerHTML = '<div class="empty">今天还没有安排</div>';
  } else {
    todayEvs.forEach((ev) => {
      const c = catOf(ev.color);
      const isNext = next && ev.id === next.id;
      const row = document.createElement('div');
      row.className = 'ev' + (ev.done ? ' done' : '') + (isNext ? ' soon' : '');
      row.innerHTML =
        `<span class="ck" title="${ev.done ? '取消完成' : '标记完成'}"></span>` +
        `<span class="eb" style="background:${c.dot}"></span>` +
        `<span class="et">${ev.start || ''}</span>` +
        `<span class="en">${esc(ev.title || '(无标题)')}</span>` +
        (isNext ? `<span class="badge">${ongoing && ev.id === next.id ? '进行中' : '下一个'}</span>` : '');
      row.title = `${c.name} · ${ev.start || ''}${ev.end ? '–' + ev.end : ''}\n${ev.title || ''}${ev.note ? '\n' + ev.note : ''}`;

      // 圆圈：直接在桌面贴上勾掉，不进主窗口
      row.querySelector('.ck').onclick = async (e) => {
        e.stopPropagation();
        row.classList.toggle('done');
        await window.api.widget.toggleEvent(ev.id);
      };
      // 其余区域：跳到主窗口那一天
      row.onclick = () => window.api.widget.openMain({ date: today, id: ev.id });
      list.appendChild(row);
    });
  }

  // 待办
  const open = (data.todos || []).filter((t) => !t.done);
  const doneToday = (data.todos || [])
    .filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) === today)
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const tl = $('wTodos');
  tl.innerHTML = '';
  $('wTodoCount').textContent = open.length;

  open
    .slice()
    .sort((a, b) => (b.key ? 1 : 0) - (a.key ? 1 : 0))
    .forEach((t) => {
      const row = document.createElement('div');
      row.className = 'td';
      row.dataset.id = t.id;
      row.innerHTML =
        `<span class="box"></span>` +
        `<span class="tt">${esc(t.title)}</span>` +
        (t.key ? '<span class="star">★</span>' : '');
      row.onclick = async () => {
        row.classList.add('on');
        await window.api.widget.toggleTodo(t.id);
      };
      tl.appendChild(row);
    });

  if (doneToday.length) {
    const sep = document.createElement('div');
    sep.className = 'done-sep';
    sep.textContent = '今天已完成';
    tl.appendChild(sep);
    doneToday.forEach((t) => {
      const row = document.createElement('div');
      row.className = 'td on';
      row.dataset.id = t.id;
      row.title = '点击可取消完成';
      row.innerHTML = `<span class="box"></span><span class="tt">${esc(t.title)}</span>`;
      row.onclick = async () => {
        row.classList.remove('on');
        await window.api.widget.toggleTodo(t.id);
      };
      tl.appendChild(row);
    });
  }

  if (!open.length && !doneToday.length) {
    tl.innerHTML = '<div class="empty">暂无待办</div>';
  }

  // 明天
  const tomorrowEvs = (data.events || [])
    .filter((e) => e.date === tomorrowStr)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  const tm = $('wTomorrow');
  tm.innerHTML = '';
  $('wTmCount').textContent = tomorrowEvs.length;
  if (!tomorrowEvs.length) {
    tm.innerHTML = '<div class="empty">明天暂无安排</div>';
  } else {
    tomorrowEvs.slice(0, 4).forEach((ev) => {
      const c = catOf(ev.color);
      const row = document.createElement('div');
      row.className = 'ev dim';
      row.innerHTML =
        `<span class="eb" style="background:${c.dot}"></span>` +
        `<span class="et">${ev.start || ''}</span>` +
        `<span class="en">${esc(ev.title || '(无标题)')}</span>`;
      row.onclick = () => window.api.widget.openMain({ date: tomorrowStr, id: ev.id });
      tm.appendChild(row);
    });
    if (tomorrowEvs.length > 4) {
      const more = document.createElement('div');
      more.className = 'empty';
      more.textContent = `还有 ${tomorrowEvs.length - 4} 项`;
      more.onclick = () => window.api.widget.openMain({ date: tomorrowStr });
      tm.appendChild(more);
    }
  }

  // 底部
  const weekLeft = countThisWeek(now);
  $('wFoot').innerHTML =
    `<span>本周还有 <b>${weekLeft}</b> 个日程</span>` +
    `<span>今天完成 <b>${doneEvs.length + doneToday.length}</b> 项</span>`;
}

function countThisWeek(now) {
  const dow = now.getDay();               // 0=周日，按周一起算
  const offset = dow === 0 ? 6 : dow - 1;
  const monday = addDays(now, -offset);
  const start = ymd(monday);
  const end = ymd(addDays(monday, 6));
  const today = ymd(now);
  const cur = nowMin();
  return (data.events || []).filter((e) => {
    if (e.date < start || e.date > end) return false;
    if (e.date === today) return !e.done && toMin(e.start) >= cur;
    return !e.done && e.date > today;
  }).length;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function load() {
  try {
    const d = await window.api.load();
    data = { events: [], todos: [], ...(d || {}) };
  } catch (e) { /* 用空数据渲染 */ }
  try {
    applyAlpha(await window.api.widget.getAlpha());
  } catch (e) { /* 用默认透明度 */ }
  render();
}

$('wOpen').onclick = (e) => { e.stopPropagation(); window.api.widget.openMain({}); };
$('wHide').onclick = (e) => { e.stopPropagation(); window.api.widget.set(false); };

window.api.onDataChanged((d) => {
  if (!d) return;
  data = { events: [], todos: [], ...d };
  render();
});

window.api.onWidgetAlpha((v) => applyAlpha(v));

load();
// 到点/倒计时每分钟刷新一次
setInterval(render, 20000);
// 跨天时重新拉一次数据
let lastDay = ymd(new Date());
setInterval(() => {
  const d = ymd(new Date());
  if (d !== lastDay) { lastDay = d; load(); }
}, 60000);
