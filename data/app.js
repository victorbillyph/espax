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
let appState = { repos: [], installed: [] };

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
  ws.onopen = () => {
    console.log('[ESPax] websocket conectado');
    ws.send(JSON.stringify({ type: 'appstore_list' }));
  };
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
    } else if (msg.type === 'appstore_data') {
      // atualizar state local com repos e installed
      appState.repos = msg.repos || [];
      appState.installed = msg.installed || [];
    } else if (msg.type === 'appstore_browse') {
      // mostrar resultados da busca
      const results = document.querySelector('#as-results');
      if (results && msg.ok) {
        const apps = msg.apps || [];
        if (apps.length === 0) {
          results.innerHTML = '<div class="as-empty">Nenhum app encontrado</div>';
          return;
        }
        results.innerHTML = apps.map(a => `
          <div class="as-app-card">
            <div class="as-app-icon">${esc(a.icon)}</div>
            <div class="as-app-info">
              <div class="as-app-name">${esc(a.name)}</div>
              <div class="as-app-desc">${esc(a.desc)}</div>
              <div class="as-app-meta">${esc(a.author || 'Desconhecido')} · v${esc(a.version || '1.0')}</div>
            </div>
            <div class="as-app-actions">
              <button class="as-btn as-btn-install" data-repo="${esc(msg.url)}" data-app="${esc(a.id)}" data-dir="${esc(a.dir || a.id)}">Instalar</button>
            </div>
          </div>
        `).join('');
        results.querySelectorAll('.as-btn-install').forEach(btn => {
          btn.addEventListener('click', () => {
            send({ type: 'appstore_install', repo: btn.dataset.repo, appId: btn.dataset.app, dir: btn.dataset.dir });
          });
        });
      } else if (results) {
        results.innerHTML = '<div class="as-empty">Erro ao buscar repositorio</div>';
      }
    } else if (msg.type === 'update_info') {
      const status = document.querySelector('#update-status');
      if (status) {
        if (msg.ok && msg.updateAvailable) {
          status.innerHTML = `Nova versao: <b>${esc(msg.latest)}</b> (atual: ${esc(msg.current)})` +
            `<br><button id="btn-install-update" style="margin-top:8px;padding:8px 16px;border:none;border-radius:6px;background:#22c55e;color:#fff;font-weight:600;cursor:pointer;font-size:12px">Instalar</button>`;
          status.style.color = '#22c55e';
          status.querySelector('#btn-install-update').addEventListener('click', () => {
            status.textContent = 'Instalando...';
            send({ type: 'install_update', binUrl: msg.binUrl });
          });
        } else if (msg.ok) {
          status.textContent = 'Firmware atualizado!';
          status.style.color = '#22c55e';
        } else {
          status.textContent = 'Erro: ' + (msg.msg || 'desconhecido');
          status.style.color = '#ef4444';
        }
      }
    } else if (msg.type === 'update_progress') {
      const status = document.querySelector('#update-status');
      if (status) {
        status.textContent = msg.msg || 'Atualizando...';
        status.style.color = '#f59e0b';
      }
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
  state.repos = appState.repos;
  state.installed = appState.installed;
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
      <p>Web Desktop System v${esc(state.version || '?')}</p>
      <p>Processamento: <b>ESP32</b></p>
      <p>Renderizacao: <b>Browser</b></p>
      <table class="info-table">
        <tr><td>Nome</td><td>${esc(data.name || '')}</td></tr>
        <tr><td>Hostname</td><td>${esc(data.hostname || '')}</td></tr>
        <tr><td>Versao</td><td>${esc(state.version || '')}</td></tr>
        <tr><td>IP</td><td>${esc(data.ip || '')}</td></tr>
        <tr><td>WiFi</td><td>${esc(data.ssid || '')}</td></tr>
        <tr><td>Chip</td><td>${esc(data.chip ? data.chip.model : '')}</td></tr>
        <tr><td>Freq</td><td>${data.chip && data.chip.frequency ? data.chip.frequency + ' MHz' : ''}</td></tr>
        <tr><td>Heap</td><td>${prettyBytes(data.heap || 0)}</td></tr>
        <tr><td>Uptime</td><td>${(data.uptime || 0)}s</td></tr>
      </table>
      <div style="margin-top:16px;text-align:center">
        <button id="about-update" style="
          padding:10px 20px;border:none;border-radius:8px;
          background:linear-gradient(135deg,var(--accent),var(--accent2));
          color:#fff;font-weight:600;cursor:pointer;font-size:13px;
        ">Buscar Atualizacoes</button>
        <div id="update-status" style="margin-top:10px;font-size:12px;color:#94a3b8"></div>
      </div>
    `;
    body.querySelector('#about-update').addEventListener('click', () => {
      const status = body.querySelector('#update-status');
      status.textContent = 'Verificando...';
      status.style.color = '#94a3b8';
      send({ type: 'check_update' });
    });
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

  if (app === 'appstore') {
    body.className = 'win-body app-appstore';
    const repos = state.repos || [];
    const installed = state.installed || [];

    body.innerHTML = `
      <div class="as-tabs">
        <button class="as-tab active" data-tab="browse">Explorar</button>
        <button class="as-tab" data-tab="installed">Instalados</button>
        <button class="as-tab" data-tab="repos">Repositorios</button>
      </div>
      <div class="as-content" id="as-content"></div>
    `;
    const content = body.querySelector('#as-content');
    const tabs = body.querySelectorAll('.as-tab');

    function showBrowse() {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'browse'));
      content.innerHTML = `
        <div class="as-section">
          <div class="as-row">
            <input class="as-input" id="as-browse-url" placeholder="URL do repositorio (ex: https://github.com/user/repo)">
            <button class="as-btn" id="as-browse-btn">Buscar</button>
          </div>
          <div id="as-results" class="as-results"></div>
        </div>
      `;
      content.querySelector('#as-browse-btn').addEventListener('click', () => {
        const url = content.querySelector('#as-browse-url').value.trim();
        if (url) send({ type: 'appstore_browse', url });
      });
    }

    function showInstalled() {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'installed'));
      if (installed.length === 0) {
        content.innerHTML = '<div class="as-empty">Nenhum app instalado</div>';
        return;
      }
      content.innerHTML = installed.map(a => `
        <div class="as-app-card">
          <div class="as-app-icon">${esc(a.icon)}</div>
          <div class="as-app-info">
            <div class="as-app-name">${esc(a.name)}</div>
            <div class="as-app-desc">${esc(a.desc)}</div>
            <div class="as-app-meta">${esc(a.author || 'Desconhecido')} · v${esc(a.version || '1.0')}</div>
          </div>
          <div class="as-app-actions">
            <button class="as-btn as-btn-open" data-app="${esc(a.id)}">Abrir</button>
            <button class="as-btn as-btn-remove" data-app="${esc(a.id)}">Remover</button>
          </div>
        </div>
      `).join('');
      content.querySelectorAll('.as-btn-open').forEach(btn => {
        btn.addEventListener('click', () => send({ type: 'open', app: btn.dataset.app }));
      });
      content.querySelectorAll('.as-btn-remove').forEach(btn => {
        btn.addEventListener('click', () => send({ type: 'appstore_uninstall', appId: btn.dataset.app }));
      });
    }

    function showRepos() {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'repos'));
      content.innerHTML = `
        <div class="as-section">
          <div class="as-row">
            <input class="as-input" id="as-repo-url" placeholder="URL do repositorio">
            <input class="as-input as-input-sm" id="as-repo-nick" placeholder="Apelido">
            <button class="as-btn" id="as-add-repo">Adicionar</button>
          </div>
          <div class="as-repo-list">
            ${repos.map((r, i) => `
              <div class="as-repo">
                <div class="as-repo-info">
                  <span class="as-repo-name">${esc(r.nickname || r.url)}</span>
                  <span class="as-repo-url">${esc(r.url)}</span>
                </div>
                <button class="as-btn as-btn-remove as-btn-sm" data-idx="${i}">Remover</button>
              </div>
            `).join('')}
            ${repos.length === 0 ? '<div class="as-empty">Nenhum repositorio adicionado</div>' : ''}
          </div>
        </div>
      `;
      content.querySelector('#as-add-repo').addEventListener('click', () => {
        const url = content.querySelector('#as-repo-url').value.trim();
        const nick = content.querySelector('#as-repo-nick').value.trim();
        if (url) send({ type: 'appstore_addrepo', url, nickname: nick });
      });
      content.querySelectorAll('.as-btn-remove[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => send({ type: 'appstore_removerepo', index: parseInt(btn.dataset.idx) }));
      });
    }

    showBrowse();

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'browse') showBrowse();
        else if (tab.dataset.tab === 'installed') showInstalled();
        else if (tab.dataset.tab === 'repos') showRepos();
      });
    });
    return;
  }

  // ---------- App customizado (template vindo do repo) ----------
  const customApp = (state.installed || []).find(a => a.id === app);
  if (customApp && customApp.template) {
    body.className = 'win-body app-custom';
    body.innerHTML = customApp.template;
    // injetar CSS se houver
    if (customApp.css) {
      const style = document.createElement('style');
      style.textContent = customApp.css;
      body.appendChild(style);
    }
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
