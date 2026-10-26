import test from 'node:test';
import assert from 'node:assert/strict';
import { loginToTis, refreshBlackboardSession, refreshTisSession, testCasCredentials } from '../src/core/cas-auth.js';

const loginPage = '<form><input value="e1s1" name="execution" /></form>';

function response(url, body = '', status = 200) {
  return { url, ok: status >= 200 && status < 300, status, text: async () => body };
}

test('accepts a CAS login that reaches Blackboard', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? response(url, loginPage)
      : response('https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp');
  };

  const result = await testCasCredentials('12345678', 'secret', fetcher);
  assert.equal(result.valid, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.body.get('username'), '12345678');
  assert.equal(calls[1].options.body.get('password'), 'secret');
  assert.equal(calls[1].options.body.get('execution'), 'e1s1');
  assert.equal(calls[1].options.credentials, 'include');
  assert.match(calls[0].url, /renew=true/);
});

test('rejects credentials when CAS returns to its login page', async () => {
  let count = 0;
  const fetcher = async (url) => {
    count += 1;
    return response(url, count === 1 ? loginPage : '用户名或密码错误');
  };
  const result = await testCasCredentials('12345678', 'wrong', fetcher);
  assert.equal(result.valid, false);
});

test('does not treat an existing browser session as a password test', async () => {
  const fetcher = async () => response('https://bb.sustech.edu.cn/', 'already signed in');
  await assert.rejects(
    testCasCredentials('12345678', 'untested', fetcher),
    /无法获取登录表单/,
  );
});

test('can refresh Blackboard using an existing CAS session', async () => {
  const fetcher = async () => response('https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp');
  assert.equal(await refreshBlackboardSession(fetcher), true);
});

test('can exchange an existing CAS session for a TIS session', async () => {
  const fetcher = async (url) => {
    assert.match(url, /service=https%3A%2F%2Ftis\.sustech\.edu\.cn%2Fcas/);
    return response('https://tis.sustech.edu.cn/');
  };
  assert.equal(await refreshTisSession(fetcher), true);
});

test('does not treat the TIS authentication-required page as a session', async () => {
  const fetcher = async () => response('https://tis.sustech.edu.cn/authentication/require');
  assert.equal(await refreshTisSession(fetcher), false);
});

test('logs in to TIS with saved credentials when its session expires', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(url, loginPage) : response('https://tis.sustech.edu.cn/');
  };
  await loginToTis('12345678', 'secret', fetcher);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.body.get('username'), '12345678');
  assert.equal(calls[1].options.body.get('password'), 'secret');
  assert.equal(calls[1].options.body.has('submit'), false);
  assert.match(calls[0].url, /renew=true/);
});

test('lets the TIS API verify a ticket even when its final page requires authentication', async () => {
  let count = 0;
  const fetcher = async (url) => {
    count += 1;
    return count === 1 ? response(url, loginPage)
      : response('https://tis.sustech.edu.cn/authentication/require', '', 401);
  };
  await loginToTis('12345678', 'secret', fetcher);
  assert.equal(count, 2);
});

test('rejects saved credentials when CAS returns to its login form', async () => {
  let count = 0;
  const fetcher = async (url) => {
    count += 1;
    return response(url, count === 1 ? loginPage : 'Invalid credentials');
  };
  await assert.rejects(loginToTis('12345678', 'wrong', fetcher), /已保存的学号或密码不正确/);
});
