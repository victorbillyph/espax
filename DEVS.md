# ESPax - Guia do Desenvolvedor

## Visao Geral

O ESPax roda um sistema de desktop no ESP32, acessivel via navegador. O browser e um **thin client** que renderiza o que o ESP32 manda via WebSocket.

Voce pode criar apps customizados para o ESPax usando HTML, CSS e JavaScript simples.

## Arquitetura

```
ESP32 (servidor)          Browser (thin client)
┌─────────────────┐       ┌─────────────────┐
│  Estado das      │  WS   │  Renderiza DOM   │
│  janelas/apps    │◄─────►│  Envia inputs    │
│  Logica dos apps │       │  Desenha estado  │
│  Dados (FS)      │       │                  │
└─────────────────┘       └─────────────────┘
```

- **ESP32**: processa tudo (janelas, logica dos apps, dados)
- **Browser**: so renderiza e envia eventos de input
- **WebSocket**: comunicacao em tempo real

## Estrutura de um App

Cada app e uma pasta dentro de `apps/` no repo:

```
meu-app/
├── manifest.json    (obrigatorio)
├── template.html    (obrigatorio)
└── style.css        (opcional)
```

### manifest.json

```json
{
  "id": "meu-app",
  "name": "Meu App",
  "description": "Descricao do app",
  "icon": "🚀",
  "author": "Seu Nome",
  "version": "1.0"
}
```

Campos:
- `id` (string, obrigatorio): identificador unico do app
- `name` (string, obrigatorio): nome exibido no desktop e no App Store
- `description` (string): descricao curta
- `icon` (string): emoji ou caractere para o icone
- `author` (string): nome do autor
- "version" (string): versao do app

### template.html

O template e HTML puro que sera renderizado dentro da janela do app.

```html
<div style="padding: 20px;">
  <h2>Meu App</h2>
  <p>Conteudo do app aqui.</p>

  <script>
    // JavaScript do app
    // Use window.parent para comunicar com o ESPax (WebSocket)
    console.log('App carregado!');
  </script>
</div>
```

**Regras:**
- O template e HTML valido (sem `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`)
- `<script>` e permitido e executado quando a janela abre
- CSS inline ou via `<style>` e permitido
- O template e injetado no `.win-body` da janela

### style.css (opcional)

CSS adicional para o app. Injete via `<style>` no template ou salve como `style.css`.

## Como Criar um App

### 1. Crie a pasta do app

```
apps/meu-app/
├── manifest.json
├── template.html
└── style.css
```

### 2. Escreva o manifest.json

```json
{
  "id": "meu-app",
  "name": "Meu App Incrivel",
  "description": "Um app que faz coisas incriveis no ESP32",
  "icon": "🚀",
  "author": "Desenvolvedor",
  "version": "1.0"
}
```

### 3. Escreva o template.html

```html
<div id="meu-app" style="padding: 16px; font-family: sans-serif;">
  <h2 style="color: #0f172a;">Meu App</h2>
  <div id="output" style="
    padding: 12px; background: #f8fafc;
    border-radius: 8px; margin: 12px 0;
    font-family: monospace; min-height: 60px;
  ">Aguardando...</div>

  <button onclick="fazerAlgo()" style="
    padding: 10px 20px; border: none; border-radius: 6px;
    background: #6366f1; color: #fff; font-weight: 600;
    cursor: pointer;
  ">Fazer Algo</button>

  <script>
    function fazerAlgo() {
      const out = document.getElementById('output');
      out.textContent = 'Processando no ESP32...';
      // Enviar acao via WebSocket (se necessario)
      // O ESP32 processa e devolve o estado
      setTimeout(() => {
        out.textContent = 'Pronto! ' + new Date().toLocaleTimeString();
      }, 1000);
    }
  </script>
</div>
```

### 4. Publique no repo

Envie os arquivos para seu repositorio (GitHub, servidor HTTP, etc).

### 5. Instale via App Store

1. Abra o App Store no ESPax
2. Va em "Repositorios"
3. Adicione a URL do repo
4. Va em "Explorar" e busque o repo
5. Clique "Instalar" no seu app

## Formato do Repositorio

### Repo direto (HTTP)

O repo retorna um JSON array com a lista de apps:

```json
[
  {
    "id": "meu-app",
    "name": "Meu App",
    "description": "Descricao",
    "icon": "🚀",
    "author": "Autor",
    "version": "1.0",
    "dir": "meu-app"
  }
]
```

Cada app tem uma pasta com `manifest.json` e `template.html`.

URL do repo: `https://exemplo.com/apps/`
URL do app: `https://exemplo.com/apps/meu-app/manifest.json`

### Repo GitHub

Para repos no GitHub, o ESPax converte automaticamente:

```
https://github.com/usuario/repo
```

Para:

```
https://api.github.com/repos/usuario/repo/contents/apps
```

E busca cada pasta de app automaticamente.

**Estrutura esperada no GitHub:**

```
meu-repo/
└── apps/
    ├── app-1/
    │   ├── manifest.json
    │   ├── template.html
    │   └── style.css
    └── app-2/
        ├── manifest.json
        └── template.html
```

## API WebSocket

O ESP32 se comunica via WebSocket em `/ws`.

### Mensagens do Browser para o ESP32

| Tipo | Campos | Descricao |
|------|--------|-----------|
| `open` | `app` | Abre um app |
| `close` | `id` | Fecha uma janela |
| `min` | `id` | Minimiza |
| `max` | `id` | Maximiza |
| `restore` | `id` | Restaura |
| `focus` | `id` | Traz para frente |
| `move` | `id`, `x`, `y` | Move janela |
| `resize` | `id`, `w`, `h` | Redimensiona |
| `app` | `id`, `action` | Acao do app |
| `appstore_list` | - | Lista repos e apps |
| `appstore_browse` | `url` | Busca apps num repo |
| `appstore_addrepo` | `url`, `nickname` | Adiciona repo |
| `appstore_removerepo` | `index` | Remove repo |
| `appstore_install` | `repo`, `appId`, `dir` | Instala app |
| `appstore_uninstall` | `appId` | Desinstala app |

### Mensagens do ESP32 para o Browser

| Tipo | Descricao |
|------|-----------|
| `hello` | Conexao estabelecida |
| `state` | Estado completo (janelas, chip, heap, etc) |
| `appstore_data` | Lista de repos e apps instalados |
| `appstore_browse` | Resultado da busca num repo |

## Dicas

- **Memoria**: ESP32 tem ~320KB de RAM. Apps complexos devem ser leves.
- **Templates**: mantenha os templates curtos. Use HTML inline quando possivel.
- **JavaScript**: pode usar JS normal no `<script>` do template.
- **CSS**: prefira estilos inline ou `<style>` no template.
- **Persistencia**: para salvar dados, use o notepad ou crie um endpoint customizado.
- **Seguranca**: apps de repos sao executados no browser. Nao instale apps de fontes nao confiaveis.

## Comunicacao com o ESP32

Apps customizados podem se comunicar com o ESP32 de 3 formas: HTTP API, WebSocket, e Upload/Download de arquivos.

### Requisicoes API (HTTP)

O ESP32 expoe endpoints HTTP que podem ser chamados via `fetch()`:

```javascript
// Ler status do sistema
const res = await fetch('/api/status');
const data = await res.json();
console.log(data.name, data.heap, data.uptime);

// Ler bloco de notas
const notepad = await fetch('/api/notepad');
const { content } = await notepad.json();

// Salvar bloco de notas
await fetch('/api/notepad', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Meu texto' })
});

// Listar arquivos
const files = await fetch('/api/files');
const { files: list } = await files.json();
```

**Endpoints disponiveis:**

| Metodo | Endpoint | Descricao |
|--------|----------|-----------|
| GET | `/api/status` | Info do sistema (nome, heap, chip, etc) |
| GET | `/api/notepad` | Ler conteudo do notepad |
| POST | `/api/notepad` | Salvar conteudo do notepad |
| GET | `/api/files` | Listar arquivos do LittleFS |
| POST | `/api/reboot` | Reiniciar ESP32 |

**Nota:** Os endpoints exigem autenticacao. O token e gerenciado automaticamente pelo ESPax. Apps customizados rodam dentro do contexto autenticado.

### WebSocket (comunicacao em tempo real)

Para comunicacao bidirecional, use o WebSocket que ja esta aberto:

```javascript
// Enviar mensagem para o ESP32
window.parent.postMessage({
  type: 'app',
  id: WINDOW_ID,
  action: { action: 'meucomando', param: 'valor' }
}, '*');

// Ou usar a conexao WebSocket diretamente (se acessivel)
```

**Dica:** Para apps que precisam de atualizacoes em tempo real (sensores, status), o WebSocket e mais eficiente que polling HTTP.

### Download de Arquivos

Para baixar arquivos do ESP32:

```javascript
// Download de um arquivo
async function downloadFile(filename) {
  const res = await fetch('/api/files');
  const { files } = await res.json();

  // Encontrar o arquivo
  const file = files.find(f => f.name === filename);
  if (!file) {
    alert('Arquivo nao encontrado');
    return;
  }

  // Criar link de download
  // Nota: o ESP32 nao serve arquivos diretamente por nome
  // Use o conteudo do notepad ou endpoints customizados
  alert(`Arquivo: ${file.name} (${file.size} bytes)`);
}
```

**Para servir arquivos customizados**, crie um endpoint no firmware:

```cpp
// No main.cpp
server.on("/api/myfile", HTTP_GET, [](AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false}");
    return;
  }
  File f = LittleFS.open("/meu_arquivo.txt", "r");
  if (f) {
    String content = f.readString();
    f.close();
    request->send(200, "text/plain", content);
  } {
    request->send(404, "text/plain", "Not found");
  }
});
```

E no app:

```javascript
const res = await fetch('/api/myfile');
const content = await res.text();
document.getElementById('output').textContent = content;
```

### Upload de Arquivos

Para enviar arquivos do browser para o ESP32:

```javascript
// Upload de arquivo
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', file.name);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  const result = await res.json();
  if (result.ok) {
    alert('Arquivo enviado com sucesso!');
  } else {
    alert('Erro ao enviar: ' + (result.msg || 'desconhecido'));
  }
}

// Input de arquivo no HTML
// <input type="file" id="file-input" onchange="handleUpload(this)">
function handleUpload(input) {
  const file = input.files[0];
  if (file) uploadFile(file);
}
```

**Exemplo completo com input:**

```html
<div style="padding: 16px;">
  <h3>Upload de Arquivo</h3>
  <input type="file" id="file-input"
    style="margin: 10px 0;">
  <button onclick="doUpload()">Enviar</button>
  <div id="status" style="
    margin-top: 10px; padding: 8px;
    background: #f8fafc; border-radius: 6px;
    font-size: 13px;
  "></div>

  <script>
    async function doUpload() {
      const input = document.getElementById('file-input');
      const file = input.files[0];
      if (!file) {
        alert('Selecione um arquivo');
        return;
      }

      const status = document.getElementById('status');
      status.textContent = 'Enviando...';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
        status.textContent = result.ok
          ? 'Enviado com sucesso!'
          : 'Erro: ' + result.msg;
      } catch (err) {
        status.textContent = 'Erro de conexao';
      }
    }
  </script>
</div>
```

**Limitacoes do upload:**
- Tamanho maximo: depende da memoria disponivel (~100KB recomendado)
- Formato: qualquer arquivo (texto, imagem, etc)
- Destino: LittleFS (armazenamento persistente do ESP32)
- Auth: requer token de autenticacao

### Exemplo: App com API + Upload

```html
<div style="padding: 16px; font-family: sans-serif;">
  <h2 style="color: #0f172a;">Meu App Completo</h2>

  <!-- Status do sistema -->
  <div id="status" style="
    padding: 12px; background: #f8fafc;
    border-radius: 8px; margin: 12px 0;
    font-size: 13px;
  ">Carregando...</div>

  <!-- Upload -->
  <input type="file" id="file-input">
  <button onclick="upload()">Enviar</button>

  <!-- Lista de arquivos -->
  <div id="files" style="
    margin-top: 12px; font-size: 13px;
  "></div>

  <script>
    // Carregar status ao abrir
    async function init() {
      const res = await fetch('/api/status');
      const data = await res.json();
      document.getElementById('status').innerHTML =
        `<b>${data.name}</b> | Heap: ${data.heap} bytes | Uptime: ${data.uptime}s`;
    }

    // Upload
    async function upload() {
      const file = document.getElementById('file-input').files[0];
      if (!file) return alert('Selecione um arquivo');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', file.name);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const r = await res.json();
      alert(r.ok ? 'Enviado!' : 'Erro: ' + r.msg);
      loadFiles();
    }

    // Listar arquivos
    async function loadFiles() {
      const res = await fetch('/api/files');
      const { files } = await res.json();
      document.getElementById('files').innerHTML =
        files.map(f => `<div>${f.name} (${f.size} bytes)</div>`).join('');
    }

    init();
    loadFiles();
  </script>
</div>
```

## Exemplo Completo

Veja `apps/hello-world/` para um exemplo funcional.

## Limitacoes

- Maximo de 6 janelas simultaneas
- Maximo de 16 apps instalados
- Maximo de 4 repos
- Templates renderizados via innerHTML (sem sandboxing)
- Sem suporte a frames/iframes externos no template

## Suporte

- Issues: https://github.com/victorbillyph/espax/issues
- Docs: https://github.com/victorbillyph/espax
