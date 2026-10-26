import test from 'node:test';
import assert from 'node:assert/strict';
import { blackboardFileUrl, openBlackboardFile } from '../src/core/blackboard-file.js';

test('Blackboard files open their original URL in an active browser tab', async () => {
  const calls = [];
  const tabs = { create: async (options) => {
    calls.push(options);
    return { id: 42 };
  } };
  const file = { name: 'slides.pdf',
    url: 'https://bb.sustech.edu.cn/learn/api/public/v1/courses/_1_1/contents/_2_1/attachments/_3_1/download' };
  assert.deepEqual(await openBlackboardFile(file, tabs), { id: 42 });
  assert.deepEqual(calls, [{ url: file.url, active: true }]);
});

test('Blackboard file opener rejects missing and external URLs', () => {
  for (const url of ['', 'https://evil.example/file.pdf', 'http://bb.sustech.edu.cn/file.pdf',
    'https://bb.sustech.edu.cn.evil.example/file.pdf',
    'https://someone@bb.sustech.edu.cn/file.pdf']) {
    assert.throws(() => blackboardFileUrl({ url }), /附件地址无效/);
  }
  assert.throws(() => openBlackboardFile('https://bb.sustech.edu.cn/file.pdf', {}),
    /无法创建浏览器标签页/);
});

test('Blackboard file opener passes browser errors to the caller', async () => {
  await assert.rejects(openBlackboardFile('https://bb.sustech.edu.cn/file.pdf', {
    create: async () => { throw new Error('tab blocked'); },
  }), /tab blocked/);
});
