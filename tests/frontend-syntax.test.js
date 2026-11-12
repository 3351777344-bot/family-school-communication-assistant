const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const name of ['家校沟通助手_原型v3.html', '家校沟通助手_演示版.html']) {
  test(name + ' inline JavaScript compiles', () => {
    const html = fs.readFileSync(path.join(__dirname, '../app', name), 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    assert(scripts.length > 0);
    for (const [, source] of scripts) new Function(source);
  });
}
