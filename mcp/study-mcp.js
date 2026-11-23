#!/usr/bin/env node
/* ============================================================
   日程工作台 · 学习笔记 MCP 服务（stdio）
   与桌面工作台共用同一个 study.json：这边写入，那边立刻刷新。
   不依赖任何第三方包。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');

const STUDY_FILE =
  process.env.STUDY_FILE ||
  path.join(os.homedir(), 'Library', 'Application Support', 'ScheduleWorkbench', 'study.json');

const SOURCES = ['chatgpt', 'workbuddy', 'book', 'video', 'course', 'other'];
const STATUS = ['new', 'learning', 'learned'];
const STATUS_CN = { new: '未消化', learning: '在学', learned: '已消化' };
const SOURCE_CN = {
  chatgpt: 'ChatGPT', workbuddy: 'WorkBuddy', book: '书', video: '视频', course: '课程', other: '其他'
};

function log(...a) {
  process.stderr.write('[study-mcp] ' + a.join(' ') + '\n');
}

// ---------- 存储 ----------
function readDoc() {
  try {
    const p = JSON.parse(fs.readFileSync(STUDY_FILE, 'utf8'));
    return { version: 1, notes: Array.isArray(p && p.notes) ? p.notes.filter((n) => n && n.id) : [] };
  } catch (e) {
    if (e.code !== 'ENOENT') log('读取失败', e.message);
    return { version: 1, notes: [] };
  }
}

function writeDoc(doc) {
  fs.mkdirSync(path.dirname(STUDY_FILE), { recursive: true });
  const tmp = STUDY_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
  fs.renameSync(tmp, STUDY_FILE);
}

function normTags(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/);
  const out = [];
  arr.forEach((t) => {
    const s = String(t || '').trim().replace(/^#/, '');
    if (s && !out.includes(s) && out.length < 12) out.push(s);
  });
  return out;
}

function normNote(raw, now, keep) {
  return {
    id: raw.id || null,
    title: String(raw.title || '').trim().slice(0, 200) || '未命名笔记',
    content: String(raw.content || ''),
    source: SOURCES.includes(raw.source) ? raw.source : 'other',
    tags: normTags(raw.tags),
    status: STATUS.includes(raw.status) ? raw.status : 'new',
    reviewAt: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.reviewAt || '')) ? raw.reviewAt : null,
    createdAt: keep && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: now
  };
}

const ymdOf = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const today = () => ymdOf(new Date());

function excerpt(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function fmtNote(n, withBody) {
  const head = `- [${n.id}] ${n.title}`;
  const meta = `  来源 ${SOURCE_CN[n.source] || n.source} · ${STATUS_CN[n.status] || n.status}` +
    (n.tags && n.tags.length ? ` · 标签 ${n.tags.join('/')}` : '') +
    (n.reviewAt ? ` · 复习 ${n.reviewAt}` : '');
  const body = withBody ? `\n${String(n.content || '').trim() || '（无正文）'}` :
    (n.content ? `\n  ${excerpt(n.content, 120)}` : '');
  return head + '\n' + meta + body;
}

// ---------- 工具 ----------
const TOOLS = [
  {
    name: 'study_list',
    description: '列出日程工作台里的学习笔记（默认按最近更新排序）。可按消化状态、来源、标签、关键词过滤。返回带 id，便于后续 study_get / study_update。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS, description: '消化状态：new 未消化 / learning 在学 / learned 已消化' },
        source: { type: 'string', enum: SOURCES, description: '来源：chatgpt / workbuddy / book / video / course / other' },
        tag: { type: 'string', description: '按标签过滤（包含匹配）' },
        query: { type: 'string', description: '关键词，匹配标题、正文、标签' },
        limit: { type: 'number', description: '最多返回条数，默认 20' }
      }
    }
  },
  {
    name: 'study_get',
    description: '读取一条学习笔记的完整正文。需要 study_list 返回的 id。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '笔记 id' } },
      required: ['id']
    }
  },
  {
    name: 'study_add',
    description: '往学习板块新增一条笔记。用于把对话中学到的东西沉淀下来：给标题和正文即可，来源默认 workbuddy（若内容来自 ChatGPT 可传 chatgpt）。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话说清这条学的是什么' },
        content: { type: 'string', description: '正文，支持多行；结论、代码、出处都可以写' },
        source: { type: 'string', enum: SOURCES, description: '来源，默认 workbuddy' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签，2–4 个足够' },
        status: { type: 'string', enum: STATUS, description: '默认 new（未消化）' },
        reviewAt: { type: 'string', description: '复习日期 YYYY-MM-DD；不传则默认 3 天后' }
      },
      required: ['title']
    }
  },
  {
    name: 'study_update',
    description: '修改一条学习笔记的任意字段（标题、正文、来源、标签、状态、复习日期）。只传要改的字段。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        source: { type: 'string', enum: SOURCES },
        tags: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: STATUS },
        reviewAt: { type: 'string', description: 'YYYY-MM-DD，传空字符串则清空' }
      },
      required: ['id']
    }
  },
  {
    name: 'study_delete',
    description: '删除一条学习笔记（不可撤销，确认后再用）。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'study_stats',
    description: '学习板块的总览：总数、按状态、按来源、待复习数量。',
    inputSchema: { type: 'object', properties: {} }
  }
];

function callTool(name, args) {
  const a = args || {};
  const now = Date.now();

  if (name === 'study_list') {
    const doc = readDoc();
    const q = String(a.query || '').toLowerCase();
    let list = doc.notes.filter((n) => {
      if (a.status && n.status !== a.status) return false;
      if (a.source && n.source !== a.source) return false;
      if (a.tag && !(n.tags || []).some((t) => String(t).toLowerCase().includes(String(a.tag).toLowerCase()))) return false;
      if (q) {
        const hay = `${n.title} ${n.content} ${(n.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
    const limit = Number.isFinite(a.limit) ? Math.max(1, Math.min(100, a.limit)) : 20;
    const shown = list.slice(0, limit);
    if (!shown.length) return `没有符合条件的笔记（总 ${doc.notes.length} 条）。`;
    return `共 ${list.length} 条，显示前 ${shown.length} 条：\n\n` + shown.map((n) => fmtNote(n, false)).join('\n');
  }

  if (name === 'study_get') {
    const n = readDoc().notes.find((x) => x.id === a.id);
    if (!n) return { text: `找不到 id 为 ${a.id} 的笔记`, isError: true };
    return fmtNote(n, true) + `\n\n（创建于 ${new Date(n.createdAt || now).toLocaleString('zh-CN')}，更新于 ${new Date(n.updatedAt || now).toLocaleString('zh-CN')}）`;
  }

  if (name === 'study_add') {
    const doc = readDoc();
    const reviewAt = a.reviewAt === undefined ? ymdOf(new Date(now + 3 * 86400000)) : a.reviewAt;
    const n = normNote({
      id: 'n_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: a.title,
      content: a.content,
      source: a.source || 'workbuddy',
      tags: a.tags,
      status: a.status || 'new',
      reviewAt,
      createdAt: now
    }, now, true);
    doc.notes.unshift(n);
    writeDoc(doc);
    return `已写入学习板块：\n${fmtNote(n, true)}\n\n工作台若开着，会立即刷出来。`;
  }

  if (name === 'study_update') {
    const doc = readDoc();
    const i = doc.notes.findIndex((x) => x.id === a.id);
    if (i < 0) return { text: `找不到 id 为 ${a.id} 的笔记`, isError: true };
    const merged = Object.assign({}, doc.notes[i], { id: a.id });
    ['title', 'content', 'source', 'tags', 'status'].forEach((k) => {
      if (a[k] !== undefined) merged[k] = a[k];
    });
    if (a.reviewAt !== undefined) merged.reviewAt = a.reviewAt || null;
    const n = normNote(merged, now, true);
    doc.notes[i] = n;
    writeDoc(doc);
    return `已更新：\n${fmtNote(n, false)}`;
  }

  if (name === 'study_delete') {
    const doc = readDoc();
    const before = doc.notes.length;
    const target = doc.notes.find((x) => x.id === a.id);
    if (!target) return { text: `找不到 id 为 ${a.id} 的笔记`, isError: true };
    doc.notes = doc.notes.filter((x) => x.id !== a.id);
    writeDoc(doc);
    return `已删除「${target.title}」（${before} → ${doc.notes.length} 条）`;
  }

  if (name === 'study_stats') {
    const doc = readDoc();
    const byStatus = { new: 0, learning: 0, learned: 0 };
    const bySource = {};
    let due = 0;
    const t = today();
    doc.notes.forEach((n) => {
      byStatus[n.status] = (byStatus[n.status] || 0) + 1;
      bySource[n.source] = (bySource[n.source] || 0) + 1;
      if (n.status !== 'learned' && n.reviewAt && n.reviewAt <= t) due += 1;
    });
    return [
      `总计 ${doc.notes.length} 条`,
      '状态：' + Object.entries(byStatus).map(([k, v]) => `${STATUS_CN[k]} ${v}`).join(' · '),
      '来源：' + (Object.entries(bySource).map(([k, v]) => `${SOURCE_CN[k] || k} ${v}`).join(' · ') || '—'),
      `今天需要复习：${due} 条`,
      `数据文件：${STUDY_FILE}`
    ].join('\n');
  }

  return { text: `未知工具：${name}`, isError: true };
}

// ---------- JSON-RPC over stdio ----------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handle(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    const v = params && typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05';
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'schedule-study', version: '1.0.0' },
        instructions: '日程工作台的「学习笔记」板块。写入这里的内容会直接出现在 Mac 上的日程工作台里。'
      }
    });
  }

  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });

  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    let out;
    try {
      out = callTool(name, args);
    } catch (e) {
      out = { text: '执行失败：' + e.message, isError: true };
    }
    const isErr = !!(out && out.isError);
    const text = typeof out === 'string' ? out : out.text;
    return send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text }], isError: isErr }
    });
  }

  // notifications 无需回应
  if (typeof id === 'undefined') return;

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (Array.isArray(req)) req.forEach(handle);
    else handle(req);
  }
});

process.stdin.on('end', () => process.exit(0));
log('started, data file =', STUDY_FILE);
