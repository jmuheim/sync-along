import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { getLocalIP } from './lib/network.js';
import { buildIndexHTML } from './lib/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

export function createServer() {
  let master = null;
  const clients = new Set();

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      const ip = getLocalIP();
      const html = await buildIndexHTML(ip, PORT);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (req.url === '/client.html') {
      const clientHTML = fs.readFileSync(path.join(__dirname, 'client.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(clientHTML);
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
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
    }
  });

  return { httpServer, wss, getClients: () => clients, getMaster: () => master };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { httpServer } = createServer();
  const ip = getLocalIP();
  httpServer.listen(PORT, () => {
    console.log(`circle-sync running at http://${ip}:${PORT}`);
    console.log(`Local:   http://localhost:${PORT}`);
  });
}
