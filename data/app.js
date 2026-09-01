// ============================================================================
// ESPax - Mobile Dashboard Client
// ============================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

let ws = null;
let wsReconnect = null;
let appState = {};
let currentPage = 'dashboard';
let sysName = 'ESPax';

// =================== WebSocket ===================

function connectWS() {
  if (ws && ws.readyState <= 1) return;
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { console.log('[ws] connected'); };
  ws.onclose = () => {
    console.log('[ws] closed');
    wsReconnect = setTimeout(connectWS, 3000);
  };
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'hello') {
      sysName = msg.name || sysName;
    } else if (msg.type === 'state') {
      appState = msg;
      renderDashboard();
      renderSettings();
    } else if (msg.type === 'appstore_data') {
      appState.installed = msg.installed || [];
      renderDashboard();
    }

    // forward to active page handler
    if (currentPage === 'bluetooth' && btMsgHandler) btMsgHandler(msg);
    if (currentPage === 'appstore') asMsgHandler(msg);
    if (msg.type === 'update_info') handleUpdateInfo(msg);
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// =================== Navigation ===================

function navigate(page) {
  currentPage = page;
  $$('.page').forEach(p => p.classList.remove('active'));
  $$('.tab').forEach(t => t.classList.remove('active'));

  if (page === 'app') {
    $('#page-app').classList.add('active');
    $('#sb-page-title').textContent = appState._appTitle || 'App';
  } else {
    const el = $(`#page-${page}`);
    if (el) el.classList.add('active');
    const tab = $(`.tab[data-page="${page}"]`);
    if (tab) tab.classList.add('active');
    const titles = { dashboard: 'Dashboard', bluetooth: 'Bluetooth', appstore: 'Loja', settings: 'Config' };
    $('#sb-page-title').textContent = titles[page] || page;
  }
}

// =================== Dashboard ===================

function renderDashboard() {
  const s = appState;

  // greeting
  const h = new Date().getHours();
  const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  $('#dash-greeting').textContent = `${greet}, ESPax`;
  $('#dash-sub').textContent = `v${s.version || '?'}`;

  // cards
  if (s.chip) {
    $('#card-cpu').textContent = `${s.chip.frequency}MHz`;
    $('#card-chip').textContent = s.chip.model || 'ESP32';
  }
  if (s.heap !== undefined) {
    const total = 327680;
    const used = total - s.heap;
    const pct = Math.round((used / total) * 100);
    $('#card-ram').textContent = `${Math.round(s.heap / 1024)}KB`;
    $('#card-ram-bar').style.width = `${pct}%`;
  }
  if (s.ip) {
    $('#card-ip').textContent = s.ip;
    $('#card-ssid').textContent = s.ssid || 'WiFi';
  }
  if (s.uptime !== undefined) {
    const m = Math.floor(s.uptime / 60);
    const h2 = Math.floor(m / 60);
    const d = Math.floor(h2 / 24);
    if (d > 0) $('#card-uptime').textContent = `${d}d ${h2 % 24}h`;
    else if (h2 > 0) $('#card-uptime').textContent = `${h2}h ${m % 60}m`;
    else $('#card-uptime').textContent = `${m}m`;
  }

  // installed apps
  const apps = s.installed || [];
  const dashApps = $('#dash-apps');
  if (apps.length === 0) {
    dashApps.innerHTML = '<div class="dash-empty">Nenhum app instalado</div>';
  } else {
    dashApps.innerHTML = apps.map(a => `
      <div class="dash-app-card" data-app="${esc(a.id)}">
        <div class="dash-app-icon">${esc(a.icon)}</div>
        <div class="dash-app-info">
          <div class="dash-app-name">${esc(a.name)}</div>
          <div class="dash-app-desc">${esc(a.desc)}</div>
        </div>
      </div>
    `).join('');
    dashApps.querySelectorAll('.dash-app-card').forEach(el => {
      el.addEventListener('click', () => openApp(el.dataset.app));
    });
  }

  // clock
  updateClock();
}

function openApp(appId) {
  const app = (appState.installed || []).find(a => a.id === appId);
  if (!app) return;
  appState._appTitle = app.name;
  const page = $('#page-app');
  page.innerHTML = app.template || `<div class="empty-state">${esc(app.name)}</div>`;
  page.style.display = 'block';
  navigate('app');
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  $('#sb-time').textContent = `${hh}:${mm}`;
}

// =================== Settings ===================

function renderSettings() {
  const s = appState;
  $('#cfg-hostname').textContent = s.hostname || 'espax';
  $('#cfg-version').textContent = s.version || '-';
  if (s.chip) $('#cfg-chip').textContent = s.chip.model || 'ESP32';
  $('#cfg-ssid').textContent = s.ssid || '-';
  $('#cfg-ip').textContent = s.ip || '-';
}

function handleUpdateInfo(msg) {
  const el = $('#update-status');
  if (!el) return;
  if (msg.ok && msg.updateAvailable) {
    el.innerHTML = `v${msg.latest} disponivel <button class="btn btn-primary btn-sm" id="btn-install-update" style="margin-left:8px">Instalar</button>`;
    el.style.color = 'var(--green)';
    const btn = el.querySelector('#btn-install-update');
    if (btn) btn.addEventListener('click', () => {
      el.textContent = 'Instalando...';
      send({ type: 'install_update', binUrl: msg.binUrl });
    });
  } else if (msg.ok) {
    el.textContent = 'Atualizado!';
    el.style.color = 'var(--green)';
  } else {
    el.textContent = 'Erro';
    el.style.color = 'var(--red)';
  }
}

// =================== App Store ===================

let asTab = 'zip';

function asMsgHandler(msg) {
  if (msg.type === 'appstore_browse') {
    // (removed - no more browse)
  }
}

function renderAppStore() {
  const content = $('#as-content');
  const installed = appState.installed || [];

  if (asTab === 'zip') {
    content.innerHTML = `
      <div style="margin-bottom:12px">
        <p style="color:var(--text3);font-size:13px;margin-bottom:12px">
          Selecione um <b>.zip</b> com: manifest.json + template.html (+ style.css)
        </p>
        <input type="file" id="as-zip-input" accept=".zip" style="width:100%;margin-bottom:10px">
        <button class="btn btn-primary" id="as-zip-btn" style="width:100%">Instalar</button>
        <div id="as-zip-status" style="margin-top:8px;font-size:12px;color:var(--text3)"></div>
      </div>
    `;
    $('#as-zip-btn').addEventListener('click', handleZipInstall);
  } else {
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
          <div class="as-app-actions">
            <button class="btn btn-primary btn-sm" data-app="${esc(a.id)}">Abrir</button>
            <button class="btn btn-danger btn-sm" data-app="${esc(a.id)}">Remover</button>
          </div>
        </div>
      </div>
    `).join('');
    content.querySelectorAll('.btn-primary[data-app]').forEach(btn => {
      btn.addEventListener('click', () => openApp(btn.dataset.app));
    });
    content.querySelectorAll('.btn-danger[data-app]').forEach(btn => {
      btn.addEventListener('click', () => {
        send({ type: 'appstore_uninstall', appId: btn.dataset.app });
      });
    });
  }
}

async function handleZipInstall() {
  const input = $('#as-zip-input');
  const status = $('#as-zip-status');
  const file = input.files[0];
  if (!file) { status.textContent = 'Selecione um arquivo'; status.style.color = 'var(--red)'; return; }
  if (!file.name.endsWith('.zip')) { status.textContent = 'Deve ser .zip'; status.style.color = 'var(--red)'; return; }

  status.textContent = 'Extraindo...'; status.style.color = 'var(--yellow)';
  try {
    const zip = await JSZip.loadAsync(file);
    function findFile(name) {
      const lower = name.toLowerCase();
      let found = null;
      zip.forEach((path, entry) => { if (!found && path.toLowerCase().endsWith(lower)) found = entry; });
      return found;
    }

    const mf = findFile('manifest.json');
    if (!mf) { const f = []; zip.forEach(p => f.push(p)); status.textContent = 'Sem manifest.json. Arquivos: ' + f.join(', '); status.style.color = 'var(--red)'; return; }
    const manifest = JSON.parse(await mf.async('string'));

    const tf = findFile('template.html');
    if (!tf) { status.textContent = 'Sem template.html'; status.style.color = 'var(--red)'; return; }
    const template = await tf.async('string');
    let css = ''; const cf = findFile('style.css'); if (cf) css = await cf.async('string');

    const appId = manifest.id || file.name.replace('.zip', '');
    status.textContent = 'Instalando ' + (manifest.name || appId) + '...';

    send({
      type: 'appstore_install_zip',
      appId, name: manifest.name || appId,
      desc: manifest.description || '', icon: manifest.icon || '📦',
      author: manifest.author || '', version: manifest.version || '1.0',
      template, css
    });
    status.textContent = (manifest.name || appId) + ' instalado!';
    status.style.color = 'var(--green)';
  } catch (err) {
    status.textContent = 'Erro: ' + err.message;
    status.style.color = 'var(--red)';
  }
}

// =================== Bluetooth ===================

let btMsgHandler = null;
let btScanInterval = null;

function initBluetooth() {
  const scanBtn = $('#bt-scan-btn');
  const stopBtn = $('#bt-stop-btn');
  const statusEl = $('#bt-status');
  const devList = $('#bt-devices');
  const detail = $('#bt-detail');
  const backBtn = $('#bt-back-btn');
  const discBtn = $('#bt-disconnect-btn');
  const charSelect = $('#bt-char-select');
  const logEl = $('#bt-log');

  let selectedChar = '';

  function log(msg) {
    const d = document.createElement('div');
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  scanBtn.addEventListener('click', () => {
    send({ type: 'bt_scan', duration: 10 });
    statusEl.textContent = 'Escaneando...';
    scanBtn.style.display = 'none';
    stopBtn.style.display = '';
    if (btScanInterval) clearInterval(btScanInterval);
    btScanInterval = setInterval(() => send({ type: 'bt_devices' }), 2000);
    setTimeout(() => { if (btScanInterval) { clearInterval(btScanInterval); btScanInterval = null; } }, 11000);
  });

  stopBtn.addEventListener('click', () => {
    send({ type: 'bt_stop' });
    statusEl.textContent = 'Parado';
    scanBtn.style.display = '';
    stopBtn.style.display = 'none';
    if (btScanInterval) { clearInterval(btScanInterval); btScanInterval = null; }
  });

  backBtn.addEventListener('click', () => { detail.style.display = 'none'; });
  discBtn.addEventListener('click', () => {
    send({ type: 'bt_disconnect' });
    detail.style.display = 'none';
    statusEl.textContent = 'Desconectado';
  });

  $('#bt-read-btn').addEventListener('click', () => {
    if (selectedChar) { send({ type: 'bt_read', charUuid: selectedChar }); log('READ ' + selectedChar.substring(0, 8)); }
  });
  $('#bt-write-btn').addEventListener('click', () => {
    const data = $('#bt-write-data').value;
    if (selectedChar && data) { send({ type: 'bt_write', charUuid: selectedChar, data }); log('WRITE ' + selectedChar.substring(0, 8) + ': ' + data); }
  });
  $('#bt-notify-btn').addEventListener('click', () => {
    if (selectedChar) { send({ type: 'bt_notify', charUuid: selectedChar, enable: true }); log('NOTIFY ON'); }
  });
  $('#bt-notify-off-btn').addEventListener('click', () => {
    if (selectedChar) { send({ type: 'bt_notify', charUuid: selectedChar, enable: false }); log('NOTIFY OFF'); }
  });

  btMsgHandler = (msg) => {
    if (msg.type === 'bt_devices') {
      const devs = msg.devices || [];
      if (devs.length === 0) {
        devList.innerHTML = '<div class="empty-state">Nenhum dispositivo encontrado</div>';
      } else {
        devList.innerHTML = devs.map((d, i) => `
          <div class="bt-device ${d.connected ? 'connected' : ''}" data-idx="${i}">
            <div class="bt-dev-icon">${d.connected ? '&#128268;' : '&#128267;'}</div>
            <div class="bt-dev-info">
              <div class="bt-dev-name">${esc(d.name)}</div>
              <div class="bt-dev-addr">${esc(d.address)}</div>
            </div>
            <div class="bt-dev-rssi">${d.rssi} dBm</div>
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
      statusEl.textContent = `${devs.length} dispositivo(s)`;
    } else if (msg.type === 'bt_connected') {
      if (msg.ok) {
        statusEl.textContent = msg.name;
        detail.style.display = '';
        $('#bt-detail-name').textContent = msg.name;
        $('#bt-detail-addr').textContent = msg.address;
        send({ type: 'bt_services' });
      } else {
        statusEl.textContent = 'Falha ao conectar';
      }
    } else if (msg.type === 'bt_services') {
      const svcs = msg.services || [];
      const chars = msg.characteristics || [];
      $('#bt-services').innerHTML = svcs.map(s => `
        <div class="bt-service">
          <div class="bt-svc-name">${esc(s.name)}</div>
          <div class="bt-svc-uuid">${esc(s.uuid)}</div>
          ${s.chars.map(c => `<div class="bt-char-uuid">${esc(c)}</div>`).join('')}
        </div>
      `).join('');
      charSelect.innerHTML = '<option value="">Selecione characteristic...</option>';
      chars.forEach(c => {
        const props = [c.read ? 'R' : '', c.write ? 'W' : '', c.notify ? 'N' : ''].filter(Boolean).join('');
        const opt = document.createElement('option');
        opt.value = c.uuid;
        opt.textContent = c.uuid.substring(0, 8) + '... [' + props + ']';
        charSelect.appendChild(opt);
      });
      charSelect.addEventListener('change', () => { selectedChar = charSelect.value; });
    } else if (msg.type === 'bt_read_result') {
      log('READ [' + msg.charUuid.substring(0, 8) + '] = ' + (msg.value || '(vazio)'));
    } else if (msg.type === 'bt_write_result') {
      log('WRITE [' + msg.charUuid.substring(0, 8) + '] ' + (msg.ok ? 'OK' : 'FALHA'));
    } else if (msg.type === 'bt_notify_result') {
      log('NOTIFY [' + msg.charUuid.substring(0, 8) + '] ' + (msg.ok ? 'OK' : 'FALHA'));
    }
  };
}

// =================== Init ===================

document.addEventListener('DOMContentLoaded', () => {
  connectWS();

  // tab navigation
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page;
      if (page === 'appstore') { renderAppStore(); }
      navigate(page);
    });
  });

  // appstore tabs
  $$('.as-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      asTab = tab.dataset.tab;
      $$('.as-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === asTab));
      renderAppStore();
    });
  });

  // settings
  $('#cfg-check-update')?.addEventListener('click', () => {
    $('#update-status').textContent = 'Verificando...';
    send({ type: 'check_update' });
  });
  $('#cfg-reboot')?.addEventListener('click', () => {
    if (confirm('Reiniciar ESP32?')) {
      fetch('/api/reboot', { method: 'POST' });
    }
  });
  $('#cfg-wifi-reset')?.addEventListener('click', () => {
    if (confirm('Reconfigurar WiFi? O ESP32 vai reiniciar em modo AP.')) {
      fetch('/api/reboot', { method: 'POST' });
    }
  });

  initBluetooth();

  // clock update
  setInterval(updateClock, 10000);
  updateClock();

  // initial render
  renderDashboard();
});
