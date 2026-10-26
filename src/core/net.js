// 网络层雏形：对应 Python 侧 _net.py，走 fetch + 浏览器 Cookie 登录态。

export async function apiFetch(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json, text/plain, */*', ...headers },
    body,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function sendToBackground(msg) {
  return chrome.runtime.sendMessage(msg);
}
