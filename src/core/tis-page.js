import { TisAuthError, fetchTisSemesterSchedule } from './tis.js';

const TIS_ORIGIN = 'https://tis.sustech.edu.cn';

function waitForTabComplete(tabId, chromeApi) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('打开 TIS 页面超时')), 25000);
    let settled = false;
    function finish(error, tab) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chromeApi.tabs.onUpdated.removeListener(onUpdated);
      chromeApi.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve(tab);
    }
    function onUpdated(id, changeInfo, tab) {
      if (id === tabId && changeInfo.status === 'complete') finish(null, tab);
    }
    function onRemoved(id) {
      if (id === tabId) finish(new Error('TIS 页面已关闭'));
    }
    chromeApi.tabs.onUpdated.addListener(onUpdated);
    chromeApi.tabs.onRemoved.addListener(onRemoved);
    chromeApi.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish(null, tab);
    }, finish);
  });
}

async function sendSemesterRequest(tabId, xn, xq, chromeApi) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await chromeApi.tabs.sendMessage(tabId, { type: 'tis.semesterRequest', xn, xq }, { frameId: 0 });
    } catch (error) {
      const tab = await chromeApi.tabs.get(tabId);
      if (!tab.url?.startsWith(`${TIS_ORIGIN}/`)) throw new TisAuthError('TIS 登录已失效');
      if (attempt === 4) throw new Error(`无法连接 TIS 页面：${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export async function fetchTisSemesterScheduleFromPage(xn, xq, chromeApi = chrome) {
  const tab = await chromeApi.tabs.create({ url: `${TIS_ORIGIN}/`, active: false });
  try {
    const loaded = await waitForTabComplete(tab.id, chromeApi);
    if (loaded.url?.startsWith('https://cas.sustech.edu.cn/')) throw new TisAuthError('TIS 登录已失效');
    if (!loaded.url?.startsWith(`${TIS_ORIGIN}/`)) throw new Error('无法打开 TIS 页面');
    return await fetchTisSemesterSchedule(xn, xq, async (_url, options) => {
      const result = await sendSemesterRequest(tab.id, options.body.get('xn'), options.body.get('xq'), chromeApi);
      if (result?.error) {
        if (/Failed to fetch|NetworkError/i.test(result.error)) throw new TisAuthError('TIS 登录已失效');
        throw new Error(result.error);
      }
      if (!result || typeof result.url !== 'string' || typeof result.status !== 'number' || typeof result.body !== 'string') {
        throw new Error('TIS 页面返回了无效数据');
      }
      return {
        url: result.url,
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        text: async () => result.body,
      };
    });
  } finally {
    await chromeApi.tabs.remove(tab.id).catch(() => {});
  }
}
