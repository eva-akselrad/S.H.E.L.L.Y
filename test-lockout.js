#!/usr/bin/env node
/**
 * DEPRECATED - Test content is now covered by automated test suite
 * See /docs/demo.md for documentation and testing guide
 */

console.log('This test file has been deprecated.');
console.log('See /docs/demo.md for comprehensive testing documentation.');

const http = require('http');

function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: 'localhost',
            port: 3000,
            path,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        body: JSON.parse(data),
                        headers: res.headers
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        body: data,
                        headers: res.headers
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
    console.log('🧪 Testing Lockout Screen Implementation\n');

    try {
        // Test 1: Check unlocked status
        console.log('Test 1: Check initial lockout status (should be unlocked)');
        const initialCheck = await makeRequest('/api/security/check-lockout');
        console.log('✓ Status:', initialCheck.status);
        console.log('✓ Response:', JSON.stringify(initialCheck.body, null, 2));
        
        if (!initialCheck.body.locked) {
            console.log('✅ PASS: Initial status shows not locked\n');
        } else {
            console.log('❌ FAIL: Initial status shows locked\n');
        }

        // Test 2: Make multiple failed login attempts
        console.log('Test 2: Make 5 failed login attempts to trigger lockout');
        for (let i = 1; i <= 5; i++) {
            const login = await makeRequest('/api/login', {
                method: 'POST',
                body: { password: 'wrongpassword' }
            });
            console.log(`✓ Attempt ${i}: Status ${login.status}, Error: ${login.body.error}`);
        }
        console.log('');

        // Test 3: Check lockout status after failed attempts
        console.log('Test 3: Check lockout status after failed attempts (should be locked)');
        const lockedCheck = await makeRequest('/api/security/check-lockout');
        console.log('✓ Status:', lockedCheck.status);
        console.log('✓ Response:', JSON.stringify(lockedCheck.body, null, 2));
        
        if (lockedCheck.body.locked && lockedCheck.body.minutesRemaining) {
            console.log('✅ PASS: Lockout detected with minutes remaining\n');
        } else {
            console.log('❌ FAIL: Lockout not properly detected\n');
        }

        // Test 4: Verify HTML contains lockout screen markup
        console.log('Test 4: Verify index.html contains lockout screen markup');
        const fs = require('fs');
        const indexContent = fs.readFileSync('./index.html', 'utf8');
        
        const checks = [
            { name: 'lockout-screen div', pattern: /id="lockout-screen"/ },
            { name: 'lockout-password input', pattern: /id="lockout-password"/ },
            { name: 'lockout-submit button', pattern: /id="lockout-submit"/ },
            { name: 'lockout-minutes span', pattern: /id="lockout-minutes"/ },
        ];

        let allPresent = true;
        for (const check of checks) {
            if (check.pattern.test(indexContent)) {
                console.log(`✓ ${check.name} found`);
            } else {
                console.log(`✗ ${check.name} NOT found`);
                allPresent = false;
            }
        }

        if (allPresent) {
            console.log('✅ PASS: All lockout screen markup present\n');
        } else {
            console.log('❌ FAIL: Some lockout screen markup missing\n');
        }

        // Test 5: Verify CSS contains lockout styling
        console.log('Test 5: Verify weather.css contains lockout styling');
        const cssContent = fs.readFileSync('./css/weather.css', 'utf8');
        
        const cssChecks = [
            { name: '.lockout-screen class', pattern: /\.lockout-screen\s*\{/ },
            { name: '.lockout-container class', pattern: /\.lockout-container\s*\{/ },
            { name: '.lockout-btn class', pattern: /\.lockout-btn\s*\{/ },
        ];

        let allCSSPresent = true;
        for (const check of cssChecks) {
            if (check.pattern.test(cssContent)) {
                console.log(`✓ ${check.name} found`);
            } else {
                console.log(`✗ ${check.name} NOT found`);
                allCSSPresent = false;
            }
        }

        if (allCSSPresent) {
            console.log('✅ PASS: All lockout styling present\n');
        } else {
            console.log('❌ FAIL: Some lockout styling missing\n');
        }

        console.log('✅ All tests completed!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

runTests();
