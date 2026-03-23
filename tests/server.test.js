const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function findFreePort() {
    return await new Promise((resolve, reject) => {
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

test('server health endpoint returns ok with numeric uptime', async (t) => {
    const port = await findFreePort();
    const server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: 'test-password' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let logs = '';
    server.stdout.on('data', d => { logs += d.toString(); });
    server.stderr.on('data', d => { logs += d.toString(); });

    t.after(() => {
        if (!server.killed) server.kill('SIGTERM');
    });

    await waitForHealth(`http://127.0.0.1:${port}`);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    const body = await health.json();

    assert.equal(body.ok, true);
    assert.equal(typeof body.uptime, 'number');
    assert.equal(typeof body.pushSubscribers, 'number');

    if (server.exitCode !== null && server.exitCode !== 0) {
        throw new Error(`Server exited unexpectedly with code ${server.exitCode}. Logs:\n${logs}`);
    }
});

test('admin verify endpoint requires password', async (t) => {
    const port = await findFreePort();
    const password = 'test-password';
    const server = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: password },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    t.after(() => {
        if (!server.killed) server.kill('SIGTERM');
    });

    await waitForHealth(`http://127.0.0.1:${port}`);

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/verify`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/api/verify`, {
        headers: { 'x-admin-password': password }
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { ok: true });
});
