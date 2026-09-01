// ============================================================================
// ESPax - Thin Client
// O ESP32 processa e mantem o estado (janelas, apps, dados).
// Este arquivo apenas: renderiza o estado recebido e envia eventos de input.
// Renderizacao (HTML) fica no browser; PROCESSAMENTO fica no ESP32.
// ============================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const DOM = {
  loginScreen: $('#login-screen'),
  loadingScreen: $('#loading-screen'),
  desktop: $('#desktop'),
  desktopIcons: $('#desktop-icons'),
  taskbarTasks: $('#taskbar-tasks'),
  taskbarClock: $('#taskbar-clock'),
  taskbarDate: $('#taskbar-date'),
  startButton: $('#start-button'),
  loginForm: $('#login-form'),
  loginUser: $('#login-user'),
  loginPass: $('#login-pass'),
  loginError: $('#login-error'),
  loginName: $('#login-name'),
  windowHost: $('#window-host'),
};

let sysName = 'ESPax';
let authed = false;
let ws = null;
let wsReconnect = null;

// ============================================================================
// Comunicacao ESP32 (WebSocket)
// ============================================================================

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { console.log('[ESPax] websocket conectado'); };
  ws.onclose = () => {
    console.log('[ESPax] websocket fechado, reconectando...');
    // se nao autenticado, mostra login
    if (!authed) showLogin();
    wsReconnect = setTimeout(connectWS, 3000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'hello') {
      sysName = msg.name || sysName;
    } else if (msg.type === 'state') {
      renderState(msg);
    }
  };
}

// ============================================================================
// Login / Logout (via HTTP)
// ============================================================================

async function api(path, method = 'GET', body) {
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, ...data };
}

function showLogin() {
  DOM.loadingScreen.classList.add('hidden');
  DOM.loginScreen.classList.remove('hidden');
  DOM.desktop.classList.add('hidden');
  DOM.loginError.textContent = '';
}

function enterDesktop() {
  authed = true;
  DOM.loadingScreen.classList.add('hidden');
  DOM.loginScreen.classList.add('hidden');
  DOM.desktop.classList.remove('hidden');
  updateClock();
  setInterval(updateClock, 1000);
}

DOM.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  DOM.loginError.textContent = '';
  const user = DOM.loginUser.value.trim();
  const pass = DOM.loginPass.value;
  if (!user || !pass) { DOM.loginError.textContent = 'Preencha usuário e senha.'; return; }
  enterDesktop();
  // o estado completo chega pelo websocket apos o login
});

function logout() {
  authed = false;
  api('/api/logout', 'POST');
  showLogin();
  DOM.loginPass.value = '';
}

function updateClock() {
  const now = new Date();
  DOM.taskbarClock.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  DOM.taskbarDate.textContent = now.toLocaleDateString('pt-BR');
}

// ============================================================================
// Renderizacao do estado (vindo do ESP32)
// ============================================================================

function prettyBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// Mapeia (app, id) -> componente DOM (janela atual)
const windowEls = new Map(); // id -> { win, el }

function renderState(state) {
  sysName = state.name || sysName;
  const order = state.windows
    .slice()
    .sort((a, b) => a.z - b.z);

  // fechar janelas que nao existem mais no estado
  const existing = new Set(order.map(w => w.id));
  for (const [id, entry] of windowEls) {
    if (!existing.has(id)) {
      entry.el.remove();
      windowEls.delete(id);
    }
  }

  // renderizar/criar cada janela
  order.forEach(w => {
    let entry = windowEls.get(w.id);
    if (!entry) {
      const el = createWindowEl(w);
      entry = { w, el };
      windowEls.set(w.id, entry);
      DOM.windowHost.appendChild(el);
    } else {
      entry.w = w;
    }
    applyWindowState(entry, w, state);
  });

  renderTaskbar(order);
}

function createWindowEl(w) {
  const el = document.createElement('div');
  el.className = 'window';
  el.innerHTML = `
    <div class="titlebar">
      <span class="title">${esc(w.title || w.app)}</span>
      <span class="win-controls">
        <button class="win-btn win-min" data-act="min">–</button>
        <button class="win-btn win-max" data-act="max">▢</button>
        <button class="win-btn win-close" data-act="close">✕</button>
      </span>
    </div>
    <div class="win-body"></div>
  `;

  const bar = $('.titlebar', el);
  const body = $('.win-body', el);

  // controles
  $('.win-close', el).addEventListener('click', (e) => {
    e.stopPropagation(); send({ type: 'close', id: w.id });
  });
  $('.win-min', el).addEventListener('click', (e) => {
    e.stopPropagation(); send({ type: 'min', id: w.id });
  });
  $('.win-max', el).addEventListener('click', (e) => {
    e.stopPropagation(); send({ type: 'max', id: w.id });
  });
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.win-controls')) return;
    send({ type: 'focus', id: w.id });
    startDrag(e, w);
  });

  return el;
}

function applyWindowState(entry, w, state) {
  const el = entry.el;
  const body = $('.win-body', el);
  el.style.left = w.x + 'px';
  el.style.top = w.y + 'px';
  el.style.zIndex = w.z;
  el.style.width = w.w + 'px';
  el.style.height = w.h + 'px';

  const minimized = w.min;
  const maximized = w.max;
  el.classList.toggle('maximized', !!maximized && !minimized);
  el.style.display = minimized ? 'none' : '';

  // renderizar conteudo do app (o PROCESSAMENTO ja veio do ESP32)
  renderAppBody(body, w, state);
}

// ============================================================================
// Apps - renderizacao (o estado/processamento vem do ESP32)
// ============================================================================

function renderAppBody(body, w, state) {
  const app = w.app;
  const data = w.data || {};

  if (app === 'calc') {
    body.className = 'win-body app-calc';
    body.innerHTML = `
      <div class="calc-display">${esc(data.display || '0')}</div>
      <div class="calc-grid">
        ${['C', '±', '%', '/'].map(k => `<button data-k="${k}" class="op">${k}</button>`).join('')}
        ${['7','8','9','*'].map(k => `<button data-k="${k}">${k}</button>`).join('')}
        ${['4','5','6','-'].map(k => `<button data-k="${k}">${k}</button>`).join('')}
        ${['1','2','3','+'].map(k => `<button data-k="${k}">${k}</button>`).join('')}
        <button data-k="0" class="span2">0</button>
        <button data-k=".">.</button>
        <button data-k="=" class="eq">=</button>
      </div>
    `;
    $$('button', body).forEach(btn => {
      btn.addEventListener('click', () => send({ type: 'app', id: w.id, action: { action: 'key', key: btn.dataset.k } }));
    });
    return;
  }

  if (app === 'notepad') {
    body.className = 'win-body app-notepad';
    body.innerHTML = '<textarea placeholder="Escreva aqui..."></textarea>';
    const ta = $('textarea', body);
    ta.value = data.text || '';
    const sendTimer = { t: null };
    ta.addEventListener('input', () => {
      clearTimeout(sendTimer.t);
      sendTimer.t = setTimeout(() => {
        send({ type: 'app', id: w.id, action: { action: 'text', text: ta.value } });
      }, 200);
    });
    return;
  }

  if (app === 'terminal') {
    body.className = 'win-body app-terminal';
    body.innerHTML = `
      <pre class="term-out">${esc(data.output || '')}</pre>
      <div class="term-inline">
        <span class="term-prompt">${esc(data.prompt || 'espax> ')}</span>
        <input class="term-input" autocomplete="off" spellcheck="false">
      </div>
    `;
    const inp = $('.term-input', body);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        send({ type: 'app', id: w.id, action: { action: 'cmd', cmd: inp.value } });
        inp.value = '';
      }
    });
    inp.focus();
    return;
  }

  if (app === 'files') {
    body.className = 'win-body app-files';
    body.innerHTML = '<div class="file-list"></div>';
    const list = $('.file-list', body);
    const files = w.files || w.data && w.data.files || [];
    if (files.length === 0) {
      list.innerHTML = '<div class="file-empty">Pasta vazia</div>';
      return;
    }
    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `<span class="file-ico">📄</span><span class="file-name">${esc(f.name)}</span><span class="file-size">${prettyBytes(f.size)}</span>`;
      list.appendChild(row);
    });
    return;
  }

  if (app === 'settings') {
    body.className = 'win-body app-settings';
    body.innerHTML = `
      <div class="set-row"><label>Nome</label><input id="s-name" value="${esc(data.name || '')}"></div>
      <div class="set-row"><label>Hostname</label><input id="s-host" value="${esc(data.hostname || '')}"></div>
      <div class="set-row"><label>WiFi SSID</label><input id="s-ssid" value="${esc(data.ssid || '')}"></div>
      <div class="set-row"><label>IP</label><span class="set-static">${esc(data.ip || '')}</span></div>
      <div class="set-row"><label>Uptime</label><span class="set-static">${data.uptime || 0}s</span></div>
      <button id="s-save">Salvar</button>
    `;
    return;
  }

  if (app === 'about' || app === 'info') {
    body.className = 'win-body app-about';
    body.innerHTML = `
      <div class="about-logo">ESP<span>ax</span></div>
      <p>Web Desktop System v1.1</p>
      <p>Processamento: <b>ESP32</b></p>
      <p>Renderizacao: <b>Browser</b></p>
      <table class="info-table">
        <tr><td>Nome</td><td>${esc(data.name || '')}</td></tr>
        <tr><td>Hostname</td><td>${esc(data.hostname || '')}</td></tr>
        <tr><td>IP</td><td>${esc(data.ip || '')}</td></tr>
        <tr><td>WiFi</td><td>${esc(data.ssid || '')}</td></tr>
        <tr><td>Chip</td><td>${esc(data.chip ? data.chip.model : '')}</td></tr>
        <tr><td>Freq</td><td>${data.chip && data.chip.frequency ? data.chip.frequency + ' MHz' : ''}</td></tr>
        <tr><td>Heap</td><td>${prettyBytes(data.heap || 0)}</td></tr>
        <tr><td>Uptime</td><td>${(data.uptime || 0)}s</td></tr>
      </table>
    `;
    return;
  }

  if (app === 'taskmanager') {
    body.className = 'win-body app-taskmanager';
    const windows = state.windows || [];
    const totalRAM = windows.reduce((s, w) => s + (w.ram || 0), 0);
    const heap = state.heap || 0;
    const heapMax = 320000;
    const heapPct = Math.round((heap / heapMax) * 100);
    const chip = state.chip || {};
    const uptime = state.uptime || 0;
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const sec = uptime % 60;

    body.innerHTML = `
      <div class="tm-section">
        <div class="tm-header">Sistema</div>
        <div class="tm-bars">
          <div class="tm-bar-row">
            <span class="tm-label">RAM Heap</span>
            <div class="tm-bar"><div class="tm-fill" style="width:${100 - heapPct}%"></div></div>
            <span class="tm-val">${prettyBytes(heap)} / 320 KB</span>
          </div>
          <div class="tm-bar-row">
            <span class="tm-label">Janelas</span>
            <div class="tm-bar"><div class="tm-fill tm-fill-purple" style="width:${(windows.length / 6) * 100}%"></div></div>
            <span class="tm-val">${windows.length} / 6</span>
          </div>
          <div class="tm-bar-row">
            <span class="tm-label">RAM Apps</span>
            <div class="tm-bar"><div class="tm-fill tm-fill-cyan" style="width:${Math.min(100, (totalRAM / heapMax) * 100)}%"></div></div>
            <span class="tm-val">${prettyBytes(totalRAM)}</span>
          </div>
        </div>
      </div>
      <div class="tm-section">
        <div class="tm-header">Processos</div>
        <div class="tm-process-list">
          <div class="tm-proc tm-proc-head">
            <span class="tm-proc-id">ID</span>
            <span class="tm-proc-app">App</span>
            <span class="tm-proc-ram">RAM</span>
            <span class="tm-proc-status">Status</span>
          </div>
          ${windows.map(w => `
            <div class="tm-proc">
              <span class="tm-proc-id">#${w.id}</span>
              <span class="tm-proc-app">${esc(w.title || w.app)}</span>
              <span class="tm-proc-ram">${prettyBytes(w.ram || 0)}</span>
              <span class="tm-proc-status ${w.min ? 'tm-minimized' : 'tm-running'}">${w.min ? 'Minimizado' : 'Executando'}</span>
            </div>
          `).join('')}
          ${windows.length === 0 ? '<div class="tm-empty">Nenhum processo ativo</div>' : ''}
        </div>
      </div>
      <div class="tm-section">
        <div class="tm-header">Info</div>
        <div class="tm-info-grid">
          <div class="tm-info"><span class="tm-info-label">Uptime</span><span class="tm-info-val">${h}h ${m}m ${sec}s</span></div>
          <div class="tm-info"><span class="tm-info-label">Chip</span><span class="tm-info-val">${esc(chip.model || '')}</span></div>
          <div class="tm-info"><span class="tm-info-label">Freq</span><span class="tm-info-val">${chip.frequency || 0} MHz</span></div>
          <div class="tm-info"><span class="tm-info-label">WiFi</span><span class="tm-info-val">${esc(state.ssid || 'N/A')}</span></div>
          <div class="tm-info"><span class="tm-info-label">IP</span><span class="tm-info-val">${esc(state.ip || '')}</span></div>
        </div>
      </div>
    `;
    return;
  }

  // app desconhecido
  body.className = 'win-body';
  body.innerHTML = `<p>App não disponível: <b>${esc(app)}</b></p>`;
}

// ============================================================================
// Arrastar / redimensionar (inputs -> ESP32)
// ============================================================================

function startDrag(e, w) {
  const startX = e.clientX, startY = e.clientY;
  const origX = w.x, origY = w.y;

  const move = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    send({ type: 'move', id: w.id, x: origX + dx, y: origY + dy });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ============================================================================
// Taskbar
// ============================================================================

function renderTaskbar(order) {
  DOM.taskbarTasks.innerHTML = '';
  order.forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'task-btn' + (w.min ? '' : '');
    btn.textContent = w.title;
    btn.addEventListener('click', () => {
      if (w.min) send({ type: 'restore', id: w.id });
      else send({ type: 'min', id: w.id });
    });
    DOM.taskbarTasks.appendChild(btn);
  });
}

// ============================================================================
// Escaping HTML
// ============================================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================================
// Icons + Start
// ============================================================================

$$('.icon', DOM.desktopIcons).forEach(icon => {
  icon.addEventListener('dblclick', () => send({ type: 'open', app: icon.dataset.app }));
});

DOM.startButton.addEventListener('click', () => {
  send({ type: 'open', app: 'about' });
});

// ============================================================================
// Init
// ============================================================================

DOM.loadingScreen.classList.add('hidden');
DOM.loginScreen.classList.remove('hidden');
connectWS();
