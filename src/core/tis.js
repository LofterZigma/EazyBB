const TIS_ORIGIN = 'https://tis.sustech.edu.cn';

export class TisAuthError extends Error {}
export class TisCorsError extends Error {}

const TIS_RATE_LIMIT = /查询请求频率过高|请求过于频繁|操作过于频繁/;
const TIS_LOGIN_EXPIRED = /统一身份认证|cas\/login|请用户重新登录|重新登录页面|登录已失效|登录超时|session.*(?:失效|expired)|authentication\/require/i;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postTis(path, values = {}, fetcher = fetch) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetcher(`${TIS_ORIGIN}${path}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams(values),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('TIS 请求超时，请稍后重试');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== TIS_ORIGIN || finalUrl.pathname.startsWith('/authentication/require')) {
      throw new TisAuthError('TIS 登录已失效');
    }
    const body = (await response.text()).trim();
    if (response.status === 403 && /Invalid CORS request/i.test(body)) {
      throw new TisCorsError('TIS 拒绝扩展后台的跨域请求');
    }
    if (TIS_LOGIN_EXPIRED.test(body)) throw new TisAuthError('TIS 登录已失效');
    if (TIS_RATE_LIMIT.test(body)) {
      if (attempt === 0) {
        await wait(1100);
        continue;
      }
      throw new Error('TIS 查询过于频繁，请稍后重试');
    }
    if (body.startsWith('<')) {
      if (/登录|认证/i.test(body)) throw new TisAuthError('TIS 登录已失效');
      throw new Error('TIS 返回了非 JSON 页面');
    }
    if (!body) {
      if (!response.ok) throw new Error(`TIS 接口返回 HTTP ${response.status}`);
      return null;
    }
    let data;
    try { data = JSON.parse(body); } catch {
      const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
      throw new Error(`TIS 返回非 JSON 数据（HTTP ${response.status}）：${snippet}`);
    }
    const message = [data?.content, data?.message].filter((value) => typeof value === 'string').join(' ');
    if (/登录|认证|session.*失效|session.*expired/i.test(message)) throw new TisAuthError('TIS 登录已失效');
    if (!response.ok) throw new Error(`TIS 接口返回 HTTP ${response.status}`);
    return data;
  }
}

function normalizeLesson(row) {
  if (!row || typeof row !== 'object') return null;
  const match = /^xq([1-7])_jc(\d+)$/i.exec(String(row.KEY ?? ''));
  const day = Number(match?.[1]);
  const periodStart = Number(row.KSJC || match?.[2]);
  const periodEnd = Number(row.JSJC || periodStart);
  const name = String(row.KCWZSM || String(row.SKSJ || '').split('\n')[0]).trim();
  if (!day || !Number.isInteger(periodStart) || periodStart < 1 || !Number.isInteger(periodEnd) || periodEnd < periodStart || periodEnd > 11 || !name) return null;
  const details = String(row.SKSJ || '').split('\n');
  return {
    name,
    day,
    periodStart,
    periodEnd,
    location: String(row.SKDD || row.JASMC || '').trim(),
    teacher: String(row.SKJS || details[1] || '').trim().replace(/^\[|\]$/g, ''),
    // TIS reserves ZC[0]; ZC[1] represents teaching week 1.
    weeks: [...String(row.ZC || '')].flatMap((bit, index) => index > 0 && bit === '1' ? [index] : []),
  };
}

export async function fetchTisSemesterSchedule(xn, xq, fetcher = fetch) {
  if (!/^\d{4}-\d{4}$/.test(xn) || !/^[123]$/.test(String(xq))) throw new Error('TIS 学期参数无效');
  const result = await postTis('/xszykb/queryxszykbzong', { xn, xq: String(xq) }, fetcher);
  const rows = Array.isArray(result) ? result : result?.content ?? result?.list ?? result?.rows;
  if (!Array.isArray(rows)) throw new Error('TIS 整学期课程表数据格式无效');
  const seen = new Set();
  const lessons = rows.map(normalizeLesson).filter((lesson) => {
    if (!lesson?.weeks.length) return false;
    const key = `${lesson.day}/${lesson.periodStart}/${lesson.periodEnd}/${lesson.name}/${lesson.location}/${lesson.weeks.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (rows.length && !lessons.length) throw new Error('TIS 整学期课程表条目格式无效');
  return { xn, xq: String(xq), lessons };
}

export async function fetchTisTimetable(fetcher = fetch) {
  const semester = await postTis('/component/querydangqianxnxq', {}, fetcher);
  if (!semester?.XN || !semester?.XQ) throw new Error('TIS 暂未返回当前学期');
  if (fetcher === fetch) await new Promise((resolve) => setTimeout(resolve, 550));
  const weekValue = await postTis('/component/querydangqianzc', {}, fetcher);
  const week = Number(weekValue);
  if (!Number.isInteger(week) || week < 1 || week > 36) throw new Error('当前学期尚未开始，暂时无法获取本周课程表');
  if (fetcher === fetch) await new Promise((resolve) => setTimeout(resolve, 550));
  const result = await postTis('/xszykb/queryxszykbzhou', {
    xn: semester.XN, xq: semester.XQ, zc: String(week),
  }, fetcher);
  const rows = Array.isArray(result) ? result : result?.content;
  if (!Array.isArray(rows)) throw new Error('TIS 课程表数据格式无效');
  const seen = new Set();
  const lessons = rows.map(normalizeLesson).filter((lesson) => {
    if (!lesson) return false;
    const key = `${lesson.day}/${lesson.periodStart}/${lesson.periodEnd}/${lesson.name}/${lesson.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.day - b.day || a.periodStart - b.periodStart || a.name.localeCompare(b.name, 'zh-CN'));
  if (rows.length && !lessons.length) throw new Error('TIS 课程表条目格式无效');
  return { semester: `${semester.XN} · 第 ${semester.XQ} 学期`, week, lessons };
}
