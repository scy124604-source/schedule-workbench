const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  dataPath: () => ipcRenderer.invoke('store:path'),
  revealData: () => ipcRenderer.invoke('app:revealData'),

  // 学习笔记（独立文件，本地 MCP 服务共用同一份数据）
  study: {
    load: () => ipcRenderer.invoke('study:load'),
    op: (payload) => ipcRenderer.invoke('study:op', payload),
    path: () => ipcRenderer.invoke('study:path'),
    reveal: () => ipcRenderer.invoke('study:reveal'),
    info: () => ipcRenderer.invoke('study:info'),
    onChanged: (cb) => {
      const h = (_e, doc) => cb(doc);
      ipcRenderer.on('study:changed', h);
      return () => ipcRenderer.removeListener('study:changed', h);
    }
  },

  // 通知
  testNotify: () => ipcRenderer.invoke('notify:test'),

  // 文件
  saveFile: (opts) => ipcRenderer.invoke('dialog:save', opts),
  openFile: (opts) => ipcRenderer.invoke('dialog:open', opts),

  // 剪贴板
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  // 系统集成
  setLogin: (v) => ipcRenderer.invoke('app:setLogin', v),
  getLogin: () => ipcRenderer.invoke('app:getLogin'),

  // 外观主题
  getTheme: () => ipcRenderer.invoke('app:getTheme'),
  setTheme: (t) => ipcRenderer.invoke('app:setTheme', t),
  onThemeChanged: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('theme:changed', h);
    return () => ipcRenderer.removeListener('theme:changed', h);
  },
  minimize: () => ipcRenderer.invoke('window:minimize'),
  hide: () => ipcRenderer.invoke('window:hide'),

  // 事件订阅
  onDataChanged: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('data:changed', h);
    return () => ipcRenderer.removeListener('data:changed', h);
  },
  onNavigate: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('navigate', h);
    return () => ipcRenderer.removeListener('navigate', h);
  },

  // 桌面组件
  widget: {
    toggle: () => ipcRenderer.invoke('widget:toggle'),
    set: (open) => ipcRenderer.invoke('widget:set', open),
    visible: () => ipcRenderer.invoke('widget:visible'),
    openMain: (payload) => ipcRenderer.invoke('widget:openMain', payload),
    toggleTodo: (id) => ipcRenderer.invoke('widget:toggleTodo', id),
    toggleEvent: (id) => ipcRenderer.invoke('widget:toggleEvent', id),
    getAlpha: () => ipcRenderer.invoke('widget:getAlpha'),
    setAlpha: (v) => ipcRenderer.invoke('widget:setAlpha', v)
  },
  onWidgetAlpha: (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on('widget:alpha', h);
    return () => ipcRenderer.removeListener('widget:alpha', h);
  }
});
