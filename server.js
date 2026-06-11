import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { getLocalIP } from './lib/network.js';
import { buildIndexHTML, buildDevHTML } from './lib/ui.js';
import { buildBookmarkletCode } from './lib/bookmarklet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const LIVE_RELOAD = process.env.LIVE_RELOAD === '1';

// EventSource auto-reconnects on its own; we just track whether the connection
// has ever been open so we can reload on the *next* onopen (= server restarted).
const LIVE_RELOAD_SCRIPT = `<script>(function(){var d=false;var e=new EventSource('/livereload');e.onopen=function(){if(d)location.reload();};e.onmessage=function(m){if(m.data==='reload')location.reload();};e.onerror=function(){d=true;};})();</script>`;

function injectLiveReload(html) {
  return html.replace(/<\/body>/i, LIVE_RELOAD_SCRIPT + '</body>');
}

function serve(res, html) {
  res.end(LIVE_RELOAD ? injectLiveReload(html) : html);
}

export function createServer() {
  let master = null;
  const clients = new Set();
  const reloadClients = new Set();
  let nextClientId = 0;

  function broadcastReload() {
    for (const client of reloadClients) client.write('data: reload\n\n');
  }

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      const ip = getLocalIP();
      const html = await buildIndexHTML(ip, PORT);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      serve(res, html);
      return;
    }

    if (req.url === '/client.html') {
      const html = fs.readFileSync(path.join(__dirname, 'client.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      serve(res, html);
      return;
    }

    if (req.url === '/bookmarklet-code.js') {
      const ip = getLocalIP();
      const code = buildBookmarkletCode(ip, PORT);
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      res.end(code);
      return;
    }

    if (LIVE_RELOAD && req.url === '/livereload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('retry: 500\ndata: connected\n\n');
      reloadClients.add(res);
      req.on('close', () => reloadClients.delete(res));
      return;
    }

    if (req.url === '/dev') {
      const ip = getLocalIP();
      const demoPagesDir = path.join(__dirname, 'demos');
      let demoPages = [];
      try { demoPages = fs.readdirSync(demoPagesDir).filter(f => f.endsWith('.html')).sort(); } catch {}
      const html = buildDevHTML(ip, PORT, demoPages);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    const demoMatch = req.url.match(/^\/demos\/([^/?#]+\.html)$/);
    if (demoMatch) {
      const filePath = path.join(__dirname, 'demos', demoMatch[1]);
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost`);
    const role = url.searchParams.get('role');

    if (role === 'master') {
      if (master) master.close();
      master = ws;
      for (const client of clients) {
        if (client.readyState === client.OPEN) {
          client.send(JSON.stringify({ type: 'requestViewport' }));
        }
      }

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg.type === 'page' || msg.type === 'scroll') {
          for (const client of clients) {
            if (client.readyState === client.OPEN) {
              client.send(data.toString());
            }
          }
        }
      });

      ws.on('close', () => { if (master === ws) master = null; });
    } else {
      const clientId = ++nextClientId;
      clients.add(ws);

      ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (master && master.readyState === master.OPEN) {
          master.send(JSON.stringify({ ...msg, clientId }));
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
        if (master && master.readyState === master.OPEN) {
          master.send(JSON.stringify({ type: 'clientLeft', clientId }));
        }
      });
    }
  });

  return { httpServer, wss, getClients: () => clients, getMaster: () => master, broadcastReload };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { httpServer, broadcastReload } = createServer();
  const ip = getLocalIP();

  if (LIVE_RELOAD) {
    fs.watch(path.join(__dirname, 'client.html'), () => broadcastReload());
    fs.watch(path.join(__dirname, 'demos'), { recursive: true }, (_, filename) => {
      if (!filename || filename.endsWith('.html')) broadcastReload();
    });
    console.log('Live reload enabled.');
  }

  httpServer.listen(PORT, () => {
    console.log(`Sync Along running at http://${ip}:${PORT}`);
    console.log(`Local:   http://localhost:${PORT}`);
  });
}
