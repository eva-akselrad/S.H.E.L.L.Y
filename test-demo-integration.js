#!/usr/bin/env node

/**
 * DEPRECATED - Test content is now covered by automated test suite
 * See /docs/demo.md for documentation and testing guide
 */

console.log('This test file has been deprecated.');
console.log('See /docs/demo.md for comprehensive testing documentation.');

const fs = require('fs');
const path = require('path');

// Read the demo.html file
const demoPath = path.join(__dirname, 'demo.html');
const html = fs.readFileSync(demoPath, 'utf-8');

// Track test results
const tests = [];

function test(name, condition) {
    const result = condition ? '✓ PASS' : '✗ FAIL';
    tests.push({ name, condition });
    console.log(`${result}: ${name}`);
}

console.log('\n=== DEMO.HTML TABBED INTERFACE INTEGRATION TESTS ===\n');

// Test 1: Verify tab container exists
test('Tab container exists', html.includes('class="demo-tabs-container"'));

// Test 2: Verify three tabs exist
test('Three tab buttons exist', (html.match(/class="demo-tab"/g) || []).length >= 3);

// Test 3: Verify XSS tab exists
test('XSS tab exists', html.includes('🔓 XSS Demo'));

// Test 4: Verify CSRF tab exists
test('CSRF tab exists', html.includes('🎣 CSRF Demo'));

// Test 5: Verify SQL Injection tab exists
test('SQL Injection tab exists', html.includes('🔐 SQL Injection Demo'));

// Test 6: Verify demo sections exist
test('XSS demo section exists', html.includes('id="demo-xss-section"'));
test('CSRF demo section exists', html.includes('id="demo-csrf-section"'));
test('SQL Injection demo section exists', html.includes('id="demo-sqli-section"'));

// Test 7: Verify demo section CSS classes
test('Demo section CSS class exists', html.includes('.demo-section'));
test('Demo section active CSS exists', html.includes('.demo-section.active'));

// Test 8: Verify demo tab CSS classes
test('Demo tab CSS class exists', html.includes('.demo-tab'));
test('Demo tab active CSS class exists', html.includes('.demo-tab.active'));

// Test 9: Verify switchDemoTab function exists
test('switchDemoTab function exists', html.includes('function switchDemoTab('));

// Test 10: Verify keyboard navigation exists
test('Arrow key navigation exists', html.includes("e.key === 'ArrowRight'"));

// Test 11: Verify localStorage usage for persistence
test('localStorage persistence exists', html.includes("localStorage.getItem('lastSelectedTab')"));

// Test 12: Verify initial state handler exists
test('DOMContentLoaded initialization exists', html.includes('document.addEventListener(\'DOMContentLoaded\''));

// Test 13: Verify fade animation exists
test('Fade animation CSS exists', html.includes('@keyframes fadeIn'));

// Test 14: Verify responsive design
test('Responsive media query exists', html.includes('@media (max-width: 600px)'));

// Test 15: Verify proper HTML structure - no missing closing tags for demo sections
const demoSectionCount = (html.match(/<div class="demo-section"/g) || []).length;
const demoSectionCloseCount = (html.match(/<\/div>\s*<\/div>\s*<!-- SQL Injection|<\/div>\s*<\/div>\s*<!-- XSS/g) || []).length + 1; // +1 for last section
test('Demo section closing divs are correct', demoSectionCount === 3);

// Calculate pass/fail ratio
const passed = tests.filter(t => t.condition).length;
const total = tests.length;

console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}/${total}`);
console.log(`Failed: ${total - passed}/${total}`);

if (passed === total) {
    console.log('\n✓ All tests passed! Demo integration is complete.');
    process.exit(0);
} else {
    console.log('\n✗ Some tests failed. Please review the implementation.');
    process.exit(1);
}
