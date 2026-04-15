const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(0, () => {
            const { port } = server.address();
            server.close(err => err ? reject(err) : resolve(port));
        });
    });
}

async function waitForHealth(baseUrl, timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/api/health`);
            if (res.ok) return;
        } catch {
            // server not ready yet
        }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for server health endpoint');
}

async function startServer(t, { password = 'test-password' } = {}) {
    const port = await findFreePort();
    const server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const outputChunks = [];
    const capture = (d) => {
        outputChunks.push(d.toString());
        if (outputChunks.length > 20) outputChunks.shift();
    };
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);

    t.after(() => {
        if (!server.killed) server.kill('SIGTERM');
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);

    return {
        baseUrl,
        password,
        assertAlive() {
            if (server.exitCode !== null && server.exitCode !== 0) {
                throw new Error(`Server exited unexpectedly with code ${server.exitCode}. Logs:\n${outputChunks.join('')}`);
            }
        }
    };
}

test('server health endpoint returns ok with numeric uptime', async (t) => {
    const { baseUrl, assertAlive } = await startServer(t);
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const body = await health.json();

    assert.equal(body.ok, true);
    assert.equal(typeof body.uptime, 'number');
    assert.equal(typeof body.pushSubscribers, 'number');

    assertAlive();
});

test('admin verify endpoint requires password', async (t) => {
    const { baseUrl, password, assertAlive } = await startServer(t);
    const unauthorized = await fetch(`${baseUrl}/api/verify`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/verify`, {
        headers: { 'x-admin-password': password }
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true });
    assertAlive();
});

test('announce endpoint requires auth and validates text', async (t) => {
    const { baseUrl, password, assertAlive } = await startServer(t);

    const unauthorized = await fetch(`${baseUrl}/api/announce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' })
    });
    assert.equal(unauthorized.status, 401);

    const bad = await fetch(`${baseUrl}/api/announce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ text: '   ' })
    });
    assert.equal(bad.status, 400);

    const ok = await fetch(`${baseUrl}/api/announce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ text: 'Test alert', type: 'info' })
    });
    assert.equal(ok.status, 200);
    const msg = await ok.json();
    assert.equal(msg.text, 'Test alert');
    assert.equal(msg.type, 'info');
    assertAlive();
});

test('acknowledge endpoint validates visitor id and deduplicates per message', async (t) => {
    const { baseUrl, password, assertAlive } = await startServer(t);

    const created = await fetch(`${baseUrl}/api/announce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ text: 'Ack me', type: 'info' })
    });
    assert.equal(created.status, 200);
    const { id } = await created.json();

    const invalid = await fetch(`${baseUrl}/api/messages/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitorId: 'bad id with spaces' })
    });
    assert.equal(invalid.status, 400);

    const firstAck = await fetch(`${baseUrl}/api/messages/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitorId: 'viewer-1' })
    });
    assert.equal(firstAck.status, 200);
    assert.equal((await firstAck.json()).ackCount, 1);

    const duplicateAck = await fetch(`${baseUrl}/api/messages/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitorId: 'viewer-1' })
    });
    assert.equal(duplicateAck.status, 200);
    assert.equal((await duplicateAck.json()).ackCount, 1);

    const secondViewer = await fetch(`${baseUrl}/api/messages/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitorId: 'viewer-2' })
    });
    assert.equal(secondViewer.status, 200);
    assert.equal((await secondViewer.json()).ackCount, 2);
    assertAlive();
});

test('unlock endpoint clears lockout with correct password', async (t) => {
    const { baseUrl, password, assertAlive } = await startServer(t);

    // Make 5 failed login attempts to trigger lockout
    for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' })
        });
    }

    // Verify locked out
    const lockedCheck = await fetch(`${baseUrl}/api/security/check-lockout`);
    const lockedBody = await lockedCheck.json();
    assert.equal(lockedBody.locked, true);

    // Wrong password should fail
    const wrongUnlock = await fetch(`${baseUrl}/api/security/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' })
    });
    assert.equal(wrongUnlock.status, 401);

    // Correct password should clear lockout
    const correctUnlock = await fetch(`${baseUrl}/api/security/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password })
    });
    assert.equal(correctUnlock.status, 200);
    const unlockBody = await correctUnlock.json();
    assert.equal(unlockBody.ok, true);
    assert.equal(unlockBody.message, 'Lockout cleared');

    // Verify no longer locked out
    const unlockedCheck = await fetch(`${baseUrl}/api/security/check-lockout`);
    const unlockedBody = await unlockedCheck.json();
    assert.equal(unlockedBody.locked, false);
    assertAlive();
});

test('unlock endpoint rate limits to 2 attempts per minute', async (t) => {
    const { baseUrl, assertAlive } = await startServer(t);

    // First attempt should succeed
    const first = await fetch(`${baseUrl}/api/security/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong1' })
    });
    assert.equal(first.status, 401);

    // Second attempt should succeed
    const second = await fetch(`${baseUrl}/api/security/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong2' })
    });
    assert.equal(second.status, 401);

    // Third attempt should be rate limited
    const third = await fetch(`${baseUrl}/api/security/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong3' })
    });
    assert.equal(third.status, 429);
    assertAlive();
});
