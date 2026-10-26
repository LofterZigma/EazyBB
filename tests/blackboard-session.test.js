import test from 'node:test';
import assert from 'node:assert/strict';
import { BlackboardAuthError } from '../src/core/blackboard.js';
import { createBlackboardSessionManager } from '../src/core/blackboard-session.js';

test('uses saved credentials and retries once after Blackboard login expires', async () => {
  let requests = 0;
  let logins = 0;
  const session = createBlackboardSessionManager({
    getCredentials: async () => ({ studentId: '12345678', password: 'secret' }),
    loginWithCredentials: async (id, password) => {
      assert.equal(id, '12345678');
      assert.equal(password, 'secret');
      logins += 1;
      return { valid: true };
    },
    refreshSession: async () => { throw new Error('Should not use CAS fallback'); },
  });
  const result = await session.run(async () => {
    requests += 1;
    if (requests === 1) throw new BlackboardAuthError('expired');
    return 'loaded';
  });
  assert.equal(result, 'loaded');
  assert.equal(requests, 2);
  assert.equal(logins, 1);
});

test('shares one login attempt between simultaneous expired requests', async () => {
  let finishLogin;
  let logins = 0;
  const session = createBlackboardSessionManager({
    getCredentials: async () => ({ studentId: '12345678', password: 'secret' }),
    loginWithCredentials: async () => {
      logins += 1;
      await new Promise((resolve) => { finishLogin = resolve; });
      return { valid: true };
    },
    refreshSession: async () => false,
  });
  const first = session.relogin();
  const second = session.relogin();
  assert.equal(first, second);
  while (!finishLogin) await Promise.resolve();
  finishLogin();
  await Promise.all([first, second]);
  assert.equal(logins, 1);
});

test('reports invalid saved credentials without endlessly retrying', async () => {
  let requests = 0;
  const session = createBlackboardSessionManager({
    getCredentials: async () => ({ studentId: '12345678', password: 'wrong' }),
    loginWithCredentials: async () => ({ valid: false }),
    refreshSession: async () => false,
  });
  await assert.rejects(session.run(async () => {
    requests += 1;
    throw new BlackboardAuthError('expired');
  }), /学号或密码不正确/);
  assert.equal(requests, 1);
});
