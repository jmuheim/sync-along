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

// Waits for the next message of a specific type, skipping others.
function waitForMessageOfType(ws, type) {
  return new Promise((resolve) => {
    function handler(data) {
      const m = JSON.parse(data);
      if (m.type === type) { ws.off('message', handler); resolve(m); }
    }
    ws.on('message', handler);
  });
}

function wsConnect(port, role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?role=${role}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Like wsConnect but collects all messages from the start (including those that
// arrive before 'open' resolves, which can happen on loopback).
function wsConnectCollecting(port, role) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}?role=${role}`);
    const collected = [];
    ws.on('message', (data) => collected.push(JSON.parse(data)));
    ws.once('open', () => resolve({ ws, collected }));
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

  it('does not echo page/scroll messages back to master', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    // Drain the clientJoined message the server sends when client connects
    await waitForMessage(master);

    let masterEchoed = false;
    master.on('message', (data) => {
      const m = JSON.parse(data);
      if (m.type === 'scroll' || m.type === 'page') masterEchoed = true;
    });

    const p = waitForMessage(client);
    master.send(JSON.stringify({ type: 'scroll', y: 100 }));
    await p;

    await new Promise((r) => setTimeout(r, 50));
    expect(masterEchoed).toBe(false);

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

  it('forwards client message to master with injected clientId, name, and colorIndex', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    // Drain the clientJoined message sent on connect
    await waitForMessage(master);

    const p = waitForMessage(master);
    client.send(JSON.stringify({ type: 'viewport', height: 812 }));
    const msg = await p;

    expect(msg.type).toBe('viewport');
    expect(msg.height).toBe(812);
    expect(typeof msg.clientId).toBe('number');
    expect(typeof msg.name).toBe('string');
    expect(typeof msg.colorIndex).toBe('number');

    master.close(); client.close();
  });

  it('sends clientLeft with clientId and name to master when a client disconnects', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');

    // First message is clientJoined — capture clientId and name from it
    const joinedMsg = await waitForMessage(master);
    expect(joinedMsg.type).toBe('clientJoined');
    const { clientId, name } = joinedMsg;

    const leftPromise = waitForMessage(master);
    client.close();
    const leftMsg = await leftPromise;

    expect(leftMsg).toEqual({ type: 'clientLeft', clientId, name });

    master.close();
  });

  it('sends requestViewport to existing clients when a new master connects', async () => {
    const client = await wsConnect(port, 'client');

    // Skip clientInfo (may arrive before waitForMessage is set up on loopback)
    const requestPromise = waitForMessageOfType(client, 'requestViewport');
    await wsConnect(port, 'master');
    const msg = await requestPromise;

    expect(msg).toEqual({ type: 'requestViewport' });

    client.close();
  });

  it('sends clientInfo to newly connected client with name and colorIndex', async () => {
    // Collect from the start so we don't miss clientInfo on loopback.
    const { ws: client, collected } = await wsConnectCollecting(port, 'client');

    const msg = await new Promise((resolve) => {
      const found = collected.find((m) => m.type === 'clientInfo');
      if (found) return resolve(found);
      waitForMessageOfType(client, 'clientInfo').then(resolve);
    });

    expect(msg.type).toBe('clientInfo');
    expect(typeof msg.name).toBe('string');
    expect(msg.name.length).toBeGreaterThan(0);
    expect(typeof msg.colorIndex).toBe('number');
    expect(msg.colorIndex).toBeGreaterThanOrEqual(0);
    expect(msg.colorIndex).toBeLessThan(5);

    client.close();
  });

  it('sends clientJoined to master when a new client connects', async () => {
    const master = await wsConnect(port, 'master');
    const client = await wsConnect(port, 'client');
    const msg = await waitForMessageOfType(master, 'clientJoined');

    expect(msg.type).toBe('clientJoined');
    expect(typeof msg.clientId).toBe('number');
    expect(typeof msg.name).toBe('string');
    expect(typeof msg.colorIndex).toBe('number');

    master.close(); client.close();
  });

  it('announces existing clients to a reconnecting master', async () => {
    const client = await wsConnect(port, 'client');

    const { ws: master, collected } = await wsConnectCollecting(port, 'master');

    const msg = await new Promise((resolve) => {
      const found = collected.find((m) => m.type === 'clientJoined');
      if (found) return resolve(found);
      waitForMessageOfType(master, 'clientJoined').then(resolve);
    });

    expect(msg.type).toBe('clientJoined');
    expect(typeof msg.name).toBe('string');

    master.close(); client.close();
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
