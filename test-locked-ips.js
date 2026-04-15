#!/usr/bin/env node
/**
 * Test script for Locked IPs Admin Management Feature
 * 
 * This script demonstrates:
 * 1. Triggering a lockout by attempting failed logins
 * 2. Retrieving locked IPs via admin endpoint
 * 3. Removing individual IPs from lockout
 * 4. Clearing all locked IPs
 * 
 * Run with: node test-locked-ips.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
let adminToken = null;

function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        body: JSON.parse(data),
                        headers: res.headers,
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        body: data,
                        headers: res.headers,
                    });
                }
            });
        });

        req.on('error', reject);
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

async function runTests() {
    console.log('🔐 Locked IPs Admin Management Feature Test\n');
    console.log('═'.repeat(60));

    try {
        // Step 1: Get admin token
        console.log('\n1️⃣  Attempting admin login (with correct password)...');
        let res = await makeRequest('/api/login', {
            method: 'POST',
            body: { password: process.env.ADMIN_PASSWORD || 'weathernow' },
        });
        if (res.status === 200 && res.body.token) {
            adminToken = res.body.token;
            console.log('✅ Login successful! Token obtained.');
        } else {
            console.log('❌ Login failed:', res.body);
            return;
        }

        // Step 2: Trigger some failed logins to lock IPs
        console.log('\n2️⃣  Triggering lockout (5 failed login attempts from 127.0.0.1)...');
        for (let i = 1; i <= 5; i++) {
            res = await makeRequest('/api/login', {
                method: 'POST',
                body: { password: 'wrongpassword' },
            });
            console.log(`   Attempt ${i}: ${res.status === 401 ? '❌ Failed (expected)' : '⚠️  Unexpected'}`);
        }

        // Step 3: Verify IP is locked
        console.log('\n3️⃣  Verifying IP is locked...');
        res = await makeRequest('/api/security/check-lockout');
        if (res.body.locked) {
            console.log(`✅ IP is locked! Remaining: ${res.body.minutesRemaining} minutes`);
        } else {
            console.log('⚠️  IP not locked (may be different from 127.0.0.1)');
        }

        // Step 4: Get list of locked IPs
        console.log('\n4️⃣  Retrieving list of locked IPs (admin endpoint)...');
        res = await makeRequest('/api/security/locked-ips', {
            headers: {
                'Authorization': `Bearer ${adminToken}`,
            },
        });
        if (res.status === 200 && res.body.ips) {
            console.log(`✅ Found ${res.body.ips.length} locked IP(s):`);
            res.body.ips.forEach((ip) => {
                console.log(`   - ${ip.ip}: ${ip.remainingSeconds} seconds remaining`);
            });
        } else {
            console.log('❌ Failed to retrieve locked IPs:', res.body);
        }

        // Step 5: Verify authentication is required
        console.log('\n5️⃣  Testing authentication requirement...');
        res = await makeRequest('/api/security/locked-ips');
        if (res.status === 401) {
            console.log('✅ Authentication required - endpoint properly protected');
        } else {
            console.log('❌ Authentication should be required!');
        }

        // Step 6: Remove a specific IP (if available)
        if (res.body.ips && res.body.ips.length > 0) {
            const targetIp = res.body.ips[0].ip;
            console.log(`\n6️⃣  Removing specific IP from lockout: ${targetIp}...`);
            res = await makeRequest(`/api/security/locked-ips/${encodeURIComponent(targetIp)}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                },
            });
            if (res.status === 200 && res.body.ok) {
                console.log('✅ IP successfully removed:', res.body.message);
            } else {
                console.log('❌ Failed to remove IP:', res.body);
            }

            // Step 7: Verify removal
            console.log('\n7️⃣  Verifying IP was removed...');
            res = await makeRequest('/api/security/locked-ips', {
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                },
            });
            const stillLocked = res.body.ips.some((ip) => ip.ip === targetIp);
            if (!stillLocked) {
                console.log(`✅ IP ${targetIp} is no longer in locked list`);
            } else {
                console.log(`❌ IP ${targetIp} should have been removed!`);
            }
        }

        // Step 8: Clear all remaining locked IPs
        console.log('\n8️⃣  Clearing all remaining locked IPs...');
        res = await makeRequest('/api/security/locked-ips', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${adminToken}`,
            },
        });
        if (res.status === 200 && res.body.ok) {
            console.log('✅ All locked IPs cleared:', res.body.message);
        } else {
            console.log('❌ Failed to clear locked IPs:', res.body);
        }

        // Step 9: Verify all cleared
        console.log('\n9️⃣  Verifying all IPs were cleared...');
        res = await makeRequest('/api/security/locked-ips', {
            headers: {
                'Authorization': `Bearer ${adminToken}`,
            },
        });
        if (res.body.ips && res.body.ips.length === 0) {
            console.log('✅ No locked IPs remaining');
        } else {
            console.log('⚠️  Some IPs still locked:', res.body.ips);
        }

        console.log('\n' + '═'.repeat(60));
        console.log('✅ Test suite completed!\n');
    } catch (err) {
        console.error('❌ Test error:', err.message);
        process.exit(1);
    }
}

// Run tests
runTests().catch(console.error);
