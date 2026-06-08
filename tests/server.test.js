import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server.js';

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
});
