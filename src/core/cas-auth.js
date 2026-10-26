// 与项目 Python CASAuthorizer 相同的 CAS 表单流程，用于校验输入的账号密码。
const BB_SERVICE_URL = 'https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp';
const CAS_LOGIN_URL = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(BB_SERVICE_URL)}`;
const CAS_RENEW_URL = `${CAS_LOGIN_URL}&renew=true`;
const TIS_SERVICE_URL = 'https://tis.sustech.edu.cn/cas';
const TIS_CAS_LOGIN_URL = `https://cas.sustech.edu.cn/cas/login?service=${encodeURIComponent(TIS_SERVICE_URL)}`;
const REQUEST_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url, options, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接校园认证服务超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function executionToken(html) {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  const input = inputs.find((tag) => /\bname\s*=\s*(["'])execution\1/i.test(tag));
  return input?.match(/\bvalue\s*=\s*(["'])(.*?)\1/i)?.[2] ?? null;
}

// BB Cookie 过期但浏览器 CAS 会话仍有效时，可直接换取新的 BB 会话。
export async function refreshBlackboardSession(fetcher = fetch) {
  const response = await fetchWithTimeout(CAS_LOGIN_URL, {
    method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow',
  }, fetcher);
  return response.ok && new URL(response.url).origin === 'https://bb.sustech.edu.cn';
}

export async function refreshTisSession(fetcher = fetch) {
  const response = await fetchWithTimeout(TIS_CAS_LOGIN_URL, {
    method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }, fetcher);
  const url = new URL(response.url);
  return response.ok && url.origin === 'https://tis.sustech.edu.cn'
    && !url.pathname.startsWith('/authentication/');
}

export async function loginToTis(studentId, password, fetcher = fetch) {
  if (!studentId?.trim() || !password) throw new Error('请先在设置中填写并保存校园账号');
  // The browser may already have a CAS session, so renew forces a credentials
  // form. TIS's CAS flow omits the submit field (unlike Blackboard's flow).
  const renewUrl = `${TIS_CAS_LOGIN_URL}&renew=true`;
  const loginPage = await fetchWithTimeout(renewUrl, {
    method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'follow',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  }, fetcher);
  if (!loginPage.ok) throw new Error(`无法打开校园认证页面（HTTP ${loginPage.status}）`);
  const token = executionToken(await loginPage.text());
  if (!token) {
    const url = new URL(loginPage.url);
    if (url.origin === 'https://tis.sustech.edu.cn' && !url.pathname.startsWith('/authentication/')) return;
    throw new Error('无法获取 TIS 登录表单');
  }
  const result = await fetchWithTimeout(renewUrl, {
    method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      username: studentId.trim(), password, execution: token,
      _eventId: 'submit',
    }),
  }, fetcher);
  const url = new URL(result.url);
  if (url.origin === 'https://cas.sustech.edu.cn' && url.pathname.startsWith('/cas/login')) {
    throw new Error('已保存的学号或密码不正确，请在设置中修改');
  }
  // TIS may set its session cookie while exchanging the CAS ticket and then
  // still finish on /authentication/require. Only a protected API request can
  // confirm whether that cookie works; getTisTimetable retries that request.
  if (url.origin !== 'https://tis.sustech.edu.cn') {
    throw new Error('TIS 登录结果无法确认，请稍后重试');
  }
}

export async function testCasCredentials(studentId, password, fetcher = fetch) {
  if (!studentId?.trim() || !password) throw new Error('请填写学号和密码');

  const loginPage = await fetchWithTimeout(CAS_RENEW_URL, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
  }, fetcher);
  if (!loginPage.ok) throw new Error(`无法打开校园认证页面（HTTP ${loginPage.status}）`);

  const token = executionToken(await loginPage.text());
  if (!token) {
    throw new Error('无法获取登录表单，当前 CAS 会话可能不支持独立校验');
  }

  const form = new URLSearchParams({
    username: studentId.trim(),
    password,
    execution: token,
    _eventId: 'submit',
    submit: '提交',
  });
  const result = await fetchWithTimeout(CAS_RENEW_URL, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  }, fetcher);

  const finalUrl = new URL(result.url);
  if (finalUrl.origin === 'https://cas.sustech.edu.cn' && finalUrl.pathname.startsWith('/cas/login')) {
    return { valid: false, message: '学号或密码不正确' };
  }
  if (result.ok && finalUrl.origin === 'https://bb.sustech.edu.cn') {
    return { valid: true, message: '账号密码有效，Blackboard 登录成功' };
  }
  throw new Error('认证结果无法确认，请稍后重试');
}
