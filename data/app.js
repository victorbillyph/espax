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
let btMsgHandler = null;

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
      appState.installed = msg.installed || [];
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

    if (btMsgHandler) btMsgHandler(msg);
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

  if (app === 'bluetooth') {
    body.className = 'win-body app-bluetooth';
    body.innerHTML = `
      <div class="bt-header">
        <button class="as-btn" id="bt-scan-btn">Iniciar Scan</button>
        <button class="as-btn" id="bt-stop-btn" style="display:none">Parar</button>
        <button class="as-btn" id="bt-disconnect-btn" style="display:none">Desconectar</button>
        <span id="bt-status" style="color:#94a3b8;font-size:12px;margin-left:8px">Pronto</span>
      </div>
      <div class="bt-content">
        <div class="bt-panel" id="bt-devices-panel">
          <div class="bt-panel-title">Dispositivos</div>
          <div class="bt-list" id="bt-devices-list">
            <div class="bt-empty">Nenhum dispositivo encontrado</div>
          </div>
        </div>
        <div class="bt-panel" id="bt-detail-panel" style="display:none">
          <div class="bt-panel-title" id="bt-detail-name">-</div>
          <div class="bt-services" id="bt-services-list"></div>
          <div class="bt-panel-title" style="margin-top:8px">GATT</div>
          <div class="bt-gatt">
            <div class="bt-gatt-row">
              <select id="bt-char-select" class="bt-input" style="flex:1">
                <option value="">Selecione uma characteristic...</option>
              </select>
              <button class="as-btn as-btn-sm" id="bt-read-btn">Read</button>
            </div>
            <div class="bt-gatt-row">
              <input class="bt-input" id="bt-write-data" placeholder="Dados para escrever (hex ou texto)" style="flex:1">
              <button class="as-btn as-btn-sm" id="bt-write-btn">Write</button>
            </div>
            <div class="bt-gatt-row">
              <button class="as-btn as-btn-sm" id="bt-notify-btn">Notify ON</button>
              <button class="as-btn as-btn-sm" id="bt-notify-off-btn">Notify OFF</button>
            </div>
            <div class="bt-gatt-log" id="bt-gatt-log"></div>
          </div>
        </div>
      </div>
    `;

    const scanBtn = body.querySelector('#bt-scan-btn');
    const stopBtn = body.querySelector('#bt-stop-btn');
    const discBtn = body.querySelector('#bt-disconnect-btn');
    const statusEl = body.querySelector('#bt-status');
    const devList = body.querySelector('#bt-devices-list');
    const detailPanel = body.querySelector('#bt-detail-panel');
    const detailName = body.querySelector('#bt-detail-name');
    const servicesList = body.querySelector('#bt-services-list');
    const charSelect = body.querySelector('#bt-char-select');
    const gattLog = body.querySelector('#bt-gatt-log');

    let selectedCharUuid = '';

    function logGatt(msg) {
      const line = document.createElement('div');
      line.textContent = msg;
      gattLog.appendChild(line);
      gattLog.scrollTop = gattLog.scrollHeight;
    }

    scanBtn.addEventListener('click', () => {
      send({ type: 'bt_scan', duration: 10 });
      statusEl.textContent = 'Escaneando...';
      scanBtn.style.display = 'none';
      stopBtn.style.display = '';
    });

    stopBtn.addEventListener('click', () => {
      send({ type: 'bt_stop' });
      statusEl.textContent = 'Parado';
      scanBtn.style.display = '';
      stopBtn.style.display = 'none';
    });

    discBtn.addEventListener('click', () => {
      send({ type: 'bt_disconnect' });
      detailPanel.style.display = 'none';
      discBtn.style.display = 'none';
      statusEl.textContent = 'Desconectado';
      charSelect.innerHTML = '<option value="">Selecione uma characteristic...</option>';
    });

    body.querySelector('#bt-read-btn').addEventListener('click', () => {
      if (selectedCharUuid) {
        send({ type: 'bt_read', charUuid: selectedCharUuid });
        logGatt('READ ' + selectedCharUuid.substring(0, 8) + '...');
      }
    });

    body.querySelector('#bt-write-btn').addEventListener('click', () => {
      const data = body.querySelector('#bt-write-data').value;
      if (selectedCharUuid && data) {
        send({ type: 'bt_write', charUuid: selectedCharUuid, data });
        logGatt('WRITE ' + selectedCharUuid.substring(0, 8) + '...: ' + data);
      }
    });

    body.querySelector('#bt-notify-btn').addEventListener('click', () => {
      if (selectedCharUuid) {
        send({ type: 'bt_notify', charUuid: selectedCharUuid, enable: true });
        logGatt('NOTIFY ON ' + selectedCharUuid.substring(0, 8) + '...');
      }
    });

    body.querySelector('#bt-notify-off-btn').addEventListener('click', () => {
      if (selectedCharUuid) {
        send({ type: 'bt_notify', charUuid: selectedCharUuid, enable: false });
        logGatt('NOTIFY OFF');
      }
    });

    // handler para mensagens BLE
    const btHandler = (msg) => {
      if (msg.type === 'bt_devices') {
        const devs = msg.devices || [];
        if (devs.length === 0) {
          devList.innerHTML = '<div class="bt-empty">Nenhum dispositivo encontrado</div>';
        } else {
          devList.innerHTML = devs.map((d, i) => `
            <div class="bt-device ${d.connected ? 'bt-connected' : ''}" data-idx="${i}">
              <div class="bt-dev-name">${esc(d.name)}</div>
              <div class="bt-dev-addr">${esc(d.address)} · ${d.rssi} dBm</div>
            </div>
          `).join('');
          devList.querySelectorAll('.bt-device').forEach(el => {
            el.addEventListener('click', () => {
              send({ type: 'bt_connect', index: parseInt(el.dataset.idx) });
              statusEl.textContent = 'Conectando...';
            });
          });
        }
        scanBtn.style.display = '';
        stopBtn.style.display = 'none';
        statusEl.textContent = devs.length + ' dispositivo(s) encontrado(s)';
      } else if (msg.type === 'bt_connected') {
        if (msg.ok) {
          statusEl.textContent = 'Conectado: ' + msg.name;
          discBtn.style.display = '';
          detailPanel.style.display = '';
          detailName.textContent = msg.name + ' (' + msg.address + ')';
          // pedir servicos
          send({ type: 'bt_services' });
        } else {
          statusEl.textContent = 'Falha ao conectar';
        }
      } else if (msg.type === 'bt_services') {
        const svcs = msg.services || [];
        const chars = msg.characteristics || [];
        servicesList.innerHTML = svcs.map(s => `
          <div class="bt-service">
            <div class="bt-svc-name">${esc(s.name)}</div>
            <div class="bt-svc-uuid">${esc(s.uuid)}</div>
            ${s.chars.map(c => `<div class="bt-char-uuid">${esc(c)}</div>`).join('')}
          </div>
        `).join('');

        charSelect.innerHTML = '<option value="">Selecione uma characteristic...</option>';
        chars.forEach(c => {
          const props = [c.read ? 'R' : '', c.write ? 'W' : '', c.notify ? 'N' : ''].filter(Boolean).join('');
          const opt = document.createElement('option');
          opt.value = c.uuid;
          opt.textContent = c.uuid.substring(0, 8) + '... [' + props + ']';
          charSelect.appendChild(opt);
        });
        charSelect.addEventListener('change', () => {
          selectedCharUuid = charSelect.value;
        });
      } else if (msg.type === 'bt_read_result') {
        logGatt('READ [' + msg.charUuid.substring(0, 8) + '] = ' + (msg.value || '(vazio)'));
      } else if (msg.type === 'bt_write_result') {
        logGatt('WRITE [' + msg.charUuid.substring(0, 8) + '] ' + (msg.ok ? 'OK' : 'FALHA'));
      } else if (msg.type === 'bt_notify_result') {
        logGatt('NOTIFY [' + msg.charUuid.substring(0, 8) + '] ' + (msg.ok ? 'OK' : 'FALHA'));
      }
    };

    // registrar handler temporario
    btMsgHandler = btHandler;
    return;
  }

  if (app === 'appstore') {
    body.className = 'win-body app-appstore';
    const installed = state.installed || [];

    body.innerHTML = `
      <div class="as-tabs">
        <button class="as-tab active" data-tab="zip">Instalar ZIP</button>
        <button class="as-tab" data-tab="installed">Instalados</button>
      </div>
      <div class="as-content" id="as-content"></div>
    `;
    const content = body.querySelector('#as-content');
    const tabs = body.querySelectorAll('.as-tab');

    function showZip() {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'zip'));
      content.innerHTML = `
        <div class="as-section">
          <p style="color:#94a3b8;font-size:13px;margin-bottom:12px">
            Selecione um arquivo .zip contendo: <b>manifest.json</b> + <b>template.html</b> (+ <b>style.css</b> opcional)
          </p>
          <div class="as-row">
            <input type="file" id="as-zip-input" accept=".zip" style="
              flex:1;padding:10px;background:rgba(255,255,255,0.06);
              border:1px solid rgba(255,255,255,0.1);border-radius:8px;
              color:#e2e8f0;font-size:13px;
            ">
            <button class="as-btn" id="as-zip-btn">Instalar</button>
          </div>
          <div id="as-zip-status" style="margin-top:10px;font-size:12px;color:#94a3b8"></div>
        </div>
      `;
      content.querySelector('#as-zip-btn').addEventListener('click', async () => {
        const input = content.querySelector('#as-zip-input');
        const status = content.querySelector('#as-zip-status');
        const file = input.files[0];
        if (!file) { status.textContent = 'Selecione um arquivo .zip'; status.style.color = '#ef4444'; return; }
        if (!file.name.endsWith('.zip')) { status.textContent = 'Arquivo deve ser .zip'; status.style.color = '#ef4444'; return; }

        status.textContent = 'Extraindo...';
        status.style.color = '#f59e0b';

        try {
          const zip = await JSZip.loadAsync(file);

          // buscar arquivo no zip (case-insensitive, inclui subpastas)
          function findFile(name) {
            const lower = name.toLowerCase();
            let found = null;
            zip.forEach((path, entry) => {
              if (!found && path.toLowerCase().endsWith(lower)) found = entry;
            });
            return found;
          }

          // ler manifest.json
          const manifestFile = findFile('manifest.json');
          if (!manifestFile) {
            const files = [];
            zip.forEach(p => files.push(p));
            status.textContent = 'manifest.json nao encontrado. Arquivos: ' + files.join(', ');
            status.style.color = '#ef4444';
            return;
          }
          const manifestText = await manifestFile.async('string');
          const manifest = JSON.parse(manifestText);

          // ler template.html
          const templateFile = findFile('template.html');
          if (!templateFile) { status.textContent = 'template.html nao encontrado no zip'; status.style.color = '#ef4444'; return; }
          const template = await templateFile.async('string');

          // ler style.css (opcional)
          let css = '';
          const cssFile = findFile('style.css');
          if (cssFile) css = await cssFile.async('string');

          const appId = manifest.id || file.name.replace('.zip', '');
          const name = manifest.name || appId;
          const desc = manifest.description || '';
          const icon = manifest.icon || '📦';
          const author = manifest.author || '';
          const version = manifest.version || '1.0';

          status.textContent = 'Instalando ' + name + '...';

          send({
            type: 'appstore_install_zip',
            appId, name, desc, icon, author, version,
            template, css
          });

          status.textContent = name + ' instalado com sucesso!';
          status.style.color = '#22c55e';
        } catch (err) {
          status.textContent = 'Erro ao extrair zip: ' + err.message;
          status.style.color = '#ef4444';
        }
      });
    }

    showZip();

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'zip') showZip();
        else if (tab.dataset.tab === 'installed') showInstalled();
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
