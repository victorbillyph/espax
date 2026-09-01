// ==================================================
// ESPax - Web Desktop System (client-side)
// ==================================================

let token = null;
let sysName = 'ESPax';
let windows = [];
let nextId = 1;
let topZ = 40;
let openedApps = {};

const APP_META = {
  files:    { icon: '📁', title: 'Arquivos' },
  browser:  { icon: '🌐', title: 'Browser' },
  calc:     { icon: '🧮', title: 'Calculadora' },
  notepad:  { icon: '📝', title: 'Bloco de Notas' },
  terminal: { icon: '🖥️', title: 'Terminal' },
  settings: { icon: '⚙️', title: 'Configurações' },
  about:    { icon: 'ℹ️', title: 'Sobre o ESPax' }
};

const DOM = {
  loginScreen: document.getElementById('login-screen'),
  loadingScreen: document.getElementById('loading-screen'),
  desktop: document.getElementById('desktop'),
  loginForm: document.getElementById('login-form'),
  loginUser: document.getElementById('login-user'),
  loginPass: document.getElementById('login-pass'),
  loginError: document.getElementById('login-error'),
  loginName: document.getElementById('login-name'),
  windowHost: document.getElementById('window-host'),
  taskbarTasks: document.getElementById('taskbar-tasks'),
  startButton: document.getElementById('start-button'),
  clock: document.getElementById('taskbar-clock'),
  date: document.getElementById('taskbar-date'),
  desktopIcons: document.getElementById('desktop-icons'),
};

// ---------- Helpers ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    logout();
    throw new Error('Não autorizado');
  }
  return res.json();
}

function prettyBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// ---------- Auth ----------
DOM.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  DOM.loginError.textContent = '';
  const user = DOM.loginUser.value.trim();
  const pass = DOM.loginPass.value;
  if (!user || !pass) { DOM.loginError.textContent = 'Preencha usuário e senha.'; return; }
  try {
    const res = await api('/api/login', 'POST', { user, pass });
    if (res.ok) {
      token = res.token;
      sysName = res.name || sysName;
      enterDesktop();
    } else {
      DOM.loginError.textContent = res.msg || 'Falha no login.';
    }
  } catch (err) {
    DOM.loginError.textContent = 'Erro de conexão com o servidor.';
  }
});

function logout() {
  token = null;
  DOM.desktop.classList.add('hidden');
  DOM.loginScreen.classList.remove('hidden');
  windows.forEach(w => w.el.remove());
  windows = [];
  openedApps = {};
  DOM.taskbarTasks.innerHTML = '';
  DOM.loginPass.value = '';
}

function enterDesktop() {
  DOM.loadingScreen.classList.add('hidden');
  DOM.loginScreen.classList.add('hidden');
  DOM.desktop.classList.remove('hidden');
  DOM.loginName.textContent = sysName;
  updateClock();
  setInterval(updateClock, 1000);
  refreshSystemInfo();
}

// ---------- Clock ----------
function updateClock() {
  const now = new Date();
  DOM.clock.textContent = now.toLocaleTimeString('pt-BR');
  DOM.date.textContent = now.toLocaleDateString('pt-BR');
}

// ---------- Window manager ----------
function activateWindow(id) {
  const w = windows.find(x => x.id === id);
  if (!w) return;
  windows.forEach(x => {
    x.el.classList.remove('active');
    if (x.el === w.el) x.el.classList.add('active');
  });
  w.el.style.zIndex = ++topZ;
  updateTaskbar();
}

function createWindow(appId) {
  const meta = APP_META[appId];
  if (openedApps[appId]) {
    activateWindow(openedApps[appId]);
    return;
  }
  const id = nextId++;
  const el = document.createElement('div');
  el.className = 'window active';
  el.style.zIndex = ++topZ;
  el.style.left = (40 + (windows.length % 5) * 30) + 'px';
  el.style.top = (30 + (windows.length % 4) * 24) + 'px';
  el.style.width = '420px';
  el.style.height = '460px';

  const body = document.createElement('div');
  body.className = 'window-body';

  el.innerHTML = `
    <div class="window-titlebar">
      <span class="window-title-icon">${meta.icon}</span>
      <span class="window-title-text">${meta.title}</span>
      <div class="window-controls">
        <button class="window-btn" data-act="min">—</button>
        <button class="window-btn" data-act="max">▢</button>
        <button class="window-btn close" data-act="close">✕</button>
      </div>
    </div>
  `;
  el.appendChild(body);

  const titlebar = $('.window-titlebar', el);
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-controls')) return;
    startDrag(e, el);
  });

  // Controls
  $$('.window-btn', el).forEach(btn => {
    btn.addEventListener('mousedown', ev => ev.stopPropagation());
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'close') closeWindow(id);
      else if (act === 'min') minimizeWindow(id);
      else if (act === 'max') toggleMaximize(id);
    });
  });

  el.addEventListener('mousedown', () => activateWindow(id));

  DOM.windowHost.appendChild(el);
  const win = { id, appId, el, body, minimized: false, maximized: false };
  windows.push(win);
  openedApps[appId] = id;
  buildAppContent(win);
  updateTaskbar();
  return win;
}

function closeWindow(id) {
  const w = windows.find(x => x.id === id);
  if (!w) return;
  w.el.remove();
  windows = windows.filter(x => x.id !== id);
  if (openedApps[w.appId] === id) delete openedApps[w.appId];
  updateTaskbar();
}

function minimizeWindow(id) {
  const w = windows.find(x => x.id === id);
  if (!w) return;
  w.el.classList.add('hidden');
  w.minimized = true;
  updateTaskbar();
}

function toggleMaximize(id) {
  const w = windows.find(x => x.id === id);
  if (!w) return;
  w.maximized = !w.maximized;
  if (w.maximized) {
    w._restore = { left: w.el.style.left, top: w.el.style.top, w: w.el.style.width, h: w.el.style.height };
    w.el.style.left = '0';
    w.el.style.top = '0';
    w.el.style.width = '100vw';
    w.el.style.height = 'calc(100vh - 48px)';
    w.el.style.borderRadius = '0';
  } else {
    Object.assign(w.el.style, w._restore);
    w.el.style.borderRadius = '10px 10px 8px 8px';
  }
}

function updateTaskbar() {
  DOM.taskbarTasks.innerHTML = '';
  windows.forEach(w => {
    const meta = APP_META[w.appId];
    const btn = document.createElement('div');
    btn.className = 'taskbar-task' + (w.el.classList.contains('active') ? ' active' : '');
    btn.innerHTML = `${meta.icon} ${esc(meta.title)}`;
    btn.addEventListener('click', () => {
      if (w.el.classList.contains('hidden')) {
        w.el.classList.remove('hidden');
        w.minimized = false;
        activateWindow(w.id);
      } else {
        activateWindow(w.id);
      }
    });
    DOM.taskbarTasks.appendChild(btn);
  });
}

// ---------- Drag ----------
function startDrag(e, el) {
  if (el.classList.contains('maximized')) return;
  const win = windows.find(x => x.el === el);
  if (!win) return;
  activateWindow(win.id);
  const rect = el.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  function move(ev) {
    el.style.left = (ev.clientX - dx) + 'px';
    el.style.top = (ev.clientY - dy) + 'px';
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ---------- Build app content ----------
function buildAppContent(win) {
  switch (win.appId) {
    case 'calc': buildCalc(win); break;
    case 'notepad': buildNotepad(win); break;
    case 'terminal': buildTerminal(win); break;
    case 'browser': buildBrowser(win); break;
    case 'files': buildFiles(win); break;
    case 'settings': buildSettings(win); break;
    case 'about': buildAbout(win); break;
  }
}

// ==================================================
// CALCULATOR
// ==================================================
function buildCalc(win) {
  let expr = '';
  win.body.innerHTML = `
    <div class="calc">
      <div class="calc-display" id="disp">0</div>
      <div class="calc-grid">
        <button class="clear" data-k="C">C</button>
        <button class="op" data-k="(">(</button>
        <button class="op" data-k=")">)</button>
        <button class="op" data-k="/">÷</button>
        <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button>
        <button class="op" data-k="*">×</button>
        <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button>
        <button class="op" data-k="-">−</button>
        <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button>
        <button class="op" data-k="+">+</button>
        <button data-k="0" class="zero-col">0</button>
        <button data-k=".">.</button>
        <button class="eq" data-k="=">=</button>
      </div>
    </div>
  `;
  const disp = $('#disp', win.body);
  function update() {
    disp.textContent = expr === '' ? '0' : expr;
    disp.scrollLeft = disp.scrollWidth;
  }
  $$('.calc-grid button', win.body).forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;
      if (k === 'C') { expr = ''; update(); return; }
      if (k === '=') {
        try {
          // translate for JS eval
          let e = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
          // validate
          if (!/^[0-9+\-*/().\s]*$/.test(e)) throw new Error();
          const result = Function('"use strict"; return (' + e + ')')();
          expr = String(parseFloat(result.toPrecision(12)));
        } catch { expr = 'Erro'; }
        update();
        return;
      }
      if (expr === 'Erro') expr = '';
      expr += k;
      update();
    });
  });
}

// ==================================================
// NOTEPAD
// ==================================================
function buildNotepad(win) {
  win.body.innerHTML = `
    <div class="notepad" style="height:100%;display:flex;flex-direction:column;">
      <div class="notepad-toolbar">
        <button id="np-save">💾 Salvar</button>
        <button id="np-new">🧹 Limpar</button>
        <span style="font-size:11px;color:var(--muted)" id="np-status"></span>
      </div>
      <div style="flex:1;display:flex;">
        <textarea id="np-area" placeholder="Digite seu texto aqui..."></textarea>
      </div>
    </div>
  `;
  const area = $('#np-area', win.body);
  const status = $('#np-status', win.body);

  $('#np-new', win.body).addEventListener('click', () => {
    area.value = '';
    status.textContent = 'Novo documento';
  });

  $('#np-save', win.body).addEventListener('click', async () => {
    await saveNotepad(area.value);
    status.textContent = 'Salvo!';
    setTimeout(() => status.textContent = '', 1500);
  });
  // load existing memo on open
  (async () => {
    try {
      const res = await api('/api/notepad');
      if (res && res.ok) { area.value = res.content || ''; status.textContent = 'Bloco de notas local'; }
    } catch {}
  })();
}

async function saveNotepad(content) {
  await api('/api/notepad', 'POST', { content });
}

// ==================================================
// TERMINAL
// ==================================================
// TERMINAL
// ==================================================
function buildTerminal(win) {
  win.body.innerHTML = `
    <div class="terminal">
      <div class="terminal-output" id="term-out"></div>
      <div class="terminal-input">
        <span class="terminal-prompt">user@espax:~$</span>
        <input id="term-in" autocomplete="off" spellcheck="false">
      </div>
    </div>
  `;
  const out = $('#term-out', win.body);
  const input = $('#term-in', win.body);
  const banner = `
ESPax Terminal v1.0
Digite 'help' para comandos. É um terminal remoto do ESP32.
`;
  out.textContent = banner;
  out.scrollTop = out.scrollHeight;

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const cmd = input.value;
    input.value = '';
    out.textContent += `\nuser@espax:~$ ${cmd}\n`;
    out.scrollTop = out.scrollHeight;

    // local helpers
    const c = cmd.trim();
    if (!c) return;
    if (['help', 'clear', 'status'].includes(c)) {
      handleLocalCommand(c, out);
      return;
    }
    try {
      await api('/api/send', 'POST', { cmd });
      out.textContent += `[comando enviado ao ESP32 via serial]\n`;
    } catch (err) {
      out.textContent += `erro: ${err.message}\n`;
    }
    out.scrollTop = out.scrollHeight;
  });
  setTimeout(() => input.focus(), 100);
}

async function refreshSystemInfo() {
  try {
    const s = await api('/api/status');
    if (s.ok) { sysName = s.name; }
  } catch {}
}

async function handleLocalCommand(c, out) {
  if (c === 'help') {
    out.textContent += `Comandos locais: help, clear, status\n`;
  } else if (c === 'clear') {
    out.textContent = '';
  } else if (c === 'status') {
    try {
      const s = await api('/api/status');
      out.textContent += `Nome: ${s.name}\nHostname: ${s.hostname}\nIP: ${s.ip}\nHeap: ${s.heap} bytes\nUptime: ${s.uptime}s\nChip: ${s.chip.model} @${s.chip.frequency}MHz (${s.chip.cores} cores)\nFlash: ${prettyBytes(s.chip.flash_size)}\n`;
    } catch (err) { out.textContent += `erro: ${err.message}\n`; }
  }
}

// ==================================================
// BROWSER
// ==================================================
function buildBrowser(win) {
  win.body.innerHTML = `
    <div class="browser">
      <div class="browser-bar">
        <input class="browser-url" id="b-url" placeholder="Digite uma URL (ex: https://exemplo.com)">
        <button class="browser-go" id="b-go">Ir</button>
      </div>
      <iframe class="browser-frame" id="b-frame" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
    </div>
  `;
  const url = $('#b-url', win.body);
  const frame = $('#b-frame', win.body);
  function go() {
    let u = url.value.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    frame.src = u;
  }
  $('#b-go', win.body).addEventListener('click', go);
  url.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ==================================================
// FILES
// ==================================================
function buildFiles(win) {
  win.body.innerHTML = `
    <div class="files">
      <div class="files-toolbar">
        <button id="f-refresh">🔄 Atualizar</button>
        <button id="f-upload">⬆️ Upload</button>
      </div>
      <div class="files-list" id="f-list"></div>
      <input type="file" id="f-file" style="display:none">
    </div>
  `;
  const list = $('#f-list', win.body);
  const uploadInput = $('#f-file', win.body);

  function render(files) {
    list.innerHTML = '';
    if (!files.length) {
      list.innerHTML = '<div class="file-row" style="color:var(--muted)">Nenhum arquivo no sistema.</div>';
      return;
    }
    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <span class="file-name">📄 ${esc(f.name)}</span>
        <span style="color:var(--muted);font-size:12px">${prettyBytes(f.size)}</span>
      `;
      list.appendChild(row);
    });
  }

  async function load() {
    try {
      const res = await api('/api/files');
      render(res.files);
    } catch {}
  }
  $('#f-refresh', win.body).addEventListener('click', load);
  load();

  $('#f-upload', win.body).addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await fetch('/api/upload?name=' + encodeURIComponent(file.name), { method: 'POST', body: fd });
    } catch {}
    load();
  });
}

// ==================================================
// SETTINGS
// ==================================================
function buildSettings(win) {
  win.body.innerHTML = `
    <div class="settings-list">
      <div class="settings-field">
        <label>Nome do sistema</label>
        <input id="s-name" placeholder="ESPax">
      </div>
      <div class="settings-field">
        <label>Hostname (sem .local) *</label>
        <input id="s-host" placeholder="espax">
      </div>
      <div class="settings-field">
        <label>Usuário de login</label>
        <input id="s-user" placeholder="admin">
      </div>
      <div class="settings-field">
        <label>Nova senha</label>
        <input id="s-pass" type="password" placeholder="••••••">
      </div>
      <div class="settings-field">
        <label>WiFi SSID *</label>
        <input id="s-wssid" placeholder="minha-rede">
      </div>
      <div class="settings-field">
        <label>WiFi Senha *</label>
        <input id="s-wpass" type="password" placeholder="senha-wifi">
      </div>
      <button class="settings-save" id="s-save">Salvar configurações</button>
      <div id="s-msg" style="font-size:12px;margin-top:8px;min-height:16px"></div>
    </div>
    <div style="margin-top:14px;font-size:11px;color:var(--muted)">
      * Campos de rede exigem reboot para aplicar. Você também pode configurar tudo via serial.
    </div>
  `;
  $('#s-save', win.body).addEventListener('click', async () => {
    const body = {
      name: $('#s-name', win.body).value.trim(),
      hostname: $('#s-host', win.body).value.trim(),
      user: $('#s-user', win.body).value.trim(),
      pass: $('#s-pass', win.body).value,
      wifi_ssid: $('#s-wssid', win.body).value.trim(),
      wifi_pass: $('#s-wpass', win.body).value,
    };
    const msg = $('#s-msg', win.body);
    try {
      const res = await api('/api/settings', 'POST', body);
      msg.style.color = 'var(--success)';
      msg.textContent = res.msg || 'Salvo!';
    } catch (err) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Erro ao salvar.';
    }
  });
}

// ==================================================
// ABOUT
// ==================================================
async function buildAbout(win) {
  win.body.innerHTML = `
    <div class="about-hero">
      <div class="about-logo">ESP<span>ax</span></div>
      <div style="color:var(--muted);font-size:13px">Web Desktop System v1.0</div>
    </div>
    <div class="about-stats">
      <div class="stat-row"><span class="k">Nome</span><b id="a-name">—</b></div>
      <div class="stat-row"><span class="k">Hostname</span><b id="a-host">—</b></div>
      <div class="stat-row"><span class="k">IP</span><b id="a-ip">—</b></div>
      <div class="stat-row"><span class="k">Chip</span><b id="a-chip">—</b></div>
      <div class="stat-row"><span class="k">Frequência</span><b id="a-freq">—</b></div>
      <div class="stat-row"><span class="k">Flash</span><b id="a-flash">—</b></div>
      <div class="stat-row"><span class="k">RAM livre</span><b id="a-ram">—</b></div>
      <div class="stat-row"><span class="k">Uptime</span><b id="a-up">—</b></div>
    </div>
    <div style="margin-top:16px;text-align:center">
      <button id="a-reboot" style="padding:9px 16px;border:none;border-radius:6px;background:#fecaca;color:#991b1b;font-weight:600;cursor:pointer">Reiniciar ESP32</button>
    </div>
  `;
  try {
    const s = await api('/api/status');
    $('#a-name', win.body).textContent = s.name;
    $('#a-host', win.body).textContent = s.hostname;
    $('#a-ip', win.body).textContent = s.ip;
    $('#a-chip', win.body).textContent = s.chip.model;
    $('#a-freq', win.body).textContent = s.chip.frequency + ' MHz';
    $('#a-flash', win.body).textContent = prettyBytes(s.chip.flash_size);
    $('#a-ram', win.body).textContent = prettyBytes(s.heap);
    $('#a-up', win.body).textContent = s.uptime + 's';
  } catch {}
  $('#a-reboot', win.body).addEventListener('click', async () => {
    await api('/api/reboot', 'POST');
  });
}

// ---------- Desktop icons ----------
$$('.icon', DOM.desktopIcons).forEach(icon => {
  icon.addEventListener('dblclick', () => createWindow(icon.dataset.app));
  icon.addEventListener('click', () => {
    // single click select highlight styling (optional)
  });
});

// ---------- Init ----------
DOM.startButton.addEventListener('click', () => {
  // open start menu - open About
  createWindow('about');
});
