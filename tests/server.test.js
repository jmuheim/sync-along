import http from 'http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server.js';

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data))));
}

function wsConnect(port, role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?role=${role}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('WebSocket server', () => {
  let server, port;

  beforeEach(async () => {
    server = createServer();
    await new Promise((resolve) => server.httpServer.listen(0, resolve));
    port = server.httpServer.address().port;
  });

  afterEach(() => {
    server.wss.close();
    server.httpServer.close();
  });

  it('broadcasts page message from master to all clients', async () => {
    const master = await wsConnect(port, 'master');
    const client1 = await wsConnect(port, 'client');
    const client2 = await wsConnect(port, 'client');

    const p1 = waitForMessage(client1);
    const p2 = waitForMessage(client2);

    master.send(JSON.stringify({ type: 'page', html: '<html>hello</html>' }));

    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toEqual({ type: 'page', html: '<html>hello</html>' });
    expect(m2).toEqual({ type: 'page', html: '<html>hello</html>' });

    master.close(); client1.close(); client2.close();
  });

  it('broadcasts scroll message from master to all clients', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    const p = waitForMessage(client);
    master.send(JSON.stringify({ type: 'scroll', y: 350 }));
    const msg = await p;

    expect(msg).toEqual({ type: 'scroll', y: 350 });
    master.close(); client.close();
  });

  it('does not echo messages back to master', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    let masterReceived = false;
    master.on('message', () => { masterReceived = true; });

    const p = waitForMessage(client);
    master.send(JSON.stringify({ type: 'scroll', y: 100 }));
    await p;

    await new Promise((r) => setTimeout(r, 50));
    expect(masterReceived).toBe(false);

    master.close(); client.close();
  });

  it('replaces old master when a new master connects', async () => {
    const master1 = await wsConnect(port, 'master');
    const closedPromise = new Promise((r) => master1.once('close', r));

    const master2 = await wsConnect(port, 'master');
    await closedPromise;

    expect(server.getMaster()).not.toBeNull();
    master2.close();
  });

  it('ignores unknown message types', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    let received = false;
    client.on('message', () => { received = true; });

    master.send(JSON.stringify({ type: 'unknown', data: 'x' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toBe(false);
    master.close(); client.close();
  });

  it('removes client from set on disconnect', async () => {
    const client = await wsConnect(port, 'client');
    expect(server.getClients().size).toBe(1);
    await new Promise((resolve) => { client.close(); client.once('close', resolve); });
    await new Promise((r) => setTimeout(r, 30));
    expect(server.getClients().size).toBe(0);
  });

  it('handles malformed JSON from master gracefully', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    let received = false;
    client.on('message', () => { received = true; });

    master.send('not json at all');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toBe(false);
    master.close(); client.close();
  });

  it('forwards client message to master with injected clientId', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    const p = waitForMessage(master);
    client.send(JSON.stringify({ type: 'viewport', height: 812 }));
    const msg = await p;

    expect(msg.type).toBe('viewport');
    expect(msg.height).toBe(812);
    expect(typeof msg.clientId).toBe('number');

    master.close(); client.close();
  });

  it('sends clientLeft to master when a client disconnects', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    // Capture the clientId assigned during connect
    const viewportMsg = await new Promise((resolve) => {
      client.send(JSON.stringify({ type: 'viewport', height: 100 }));
      master.once('message', (data) => resolve(JSON.parse(data)));
    });
    const { clientId } = viewportMsg;

    const leftPromise = waitForMessage(master);
    client.close();
    const leftMsg = await leftPromise;

    expect(leftMsg).toEqual({ type: 'clientLeft', clientId });

    master.close();
  });

  it('sends requestViewport to existing clients when a new master connects', async () => {
    const client = await wsConnect(port, 'client');

    const requestPromise = waitForMessage(client);
    await wsConnect(port, 'master');
    const msg = await requestPromise;

    expect(msg).toEqual({ type: 'requestViewport' });

    client.close();
  });
});

describe('HTTP routes', () => {
  let server, port;

  beforeEach(async () => {
    server = createServer();
    await new Promise((resolve) => server.httpServer.listen(0, resolve));
    port = server.httpServer.address().port;
  });

  afterEach(() => {
    server.wss.close();
    server.httpServer.close();
  });

  it('GET / returns 200 HTML', async () => {
    const { status, headers, body } = await httpGet(port, '/');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(body).toContain('Sync Along');
  });

  it('GET /client.html returns 200 HTML', async () => {
    const { status, headers, body } = await httpGet(port, '/client.html');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(body).toContain('Sync Along client');
  });

  it('GET /bookmarklet-code.js returns JS with no-store header', async () => {
    const { status, headers, body } = await httpGet(port, '/bookmarklet-code.js');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/javascript');
    expect(headers['cache-control']).toBe('no-store');
    expect(body).toContain('role=master');
  });

  it('GET /dev returns 200 HTML', async () => {
    const { status, headers, body } = await httpGet(port, '/dev');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(body).toContain('Sync Along Dev');
  });

  it('GET /unknown returns 404', async () => {
    const { status } = await httpGet(port, '/unknown-path');
    expect(status).toBe(404);
  });

  it('GET /demos/nonexistent.html returns 404', async () => {
    const { status } = await httpGet(port, '/demos/nonexistent.html');
    expect(status).toBe(404);
  });
});
