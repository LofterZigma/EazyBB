import test from 'node:test';
import assert from 'node:assert/strict';
import { TisAuthError, TisCorsError, fetchTisSemesterSchedule, fetchTisTimetable } from '../src/core/tis.js';
import { fetchTisSemesterScheduleFromPage } from '../src/core/tis-page.js';

function reply(url, value, status = 200) {
  return { url, status, ok: status >= 200 && status < 300, text: async () => value };
}

test('loads current TIS week and maps lesson day and periods', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/querydangqianxnxq')) return reply(url, JSON.stringify({ XN: '2026-2027', XQ: '1' }));
    if (url.endsWith('/querydangqianzc')) return reply(url, '7');
    if (url.endsWith('/queryxszykbzhou')) return reply(url, JSON.stringify([
      { KEY: 'xq2_jc3', KSJC: '3', JSJC: '4', KCWZSM: '数据结构', SKDD: '一教 101', SKJS: '张老师' },
      { KEY: 'xq1_jc1', KSJC: '1', JSJC: '2', SKSJ: '高等数学\n其他信息' },
      { KEY: 'xq2_jc3', KSJC: '3', JSJC: '4', KCWZSM: '数据结构', SKDD: '一教 101', SKJS: '张老师' },
    ]));
    throw new Error(`Unexpected URL: ${url}`);
  };
  const timetable = await fetchTisTimetable(fetcher);
  assert.equal(timetable.week, 7);
  assert.equal(timetable.lessons.length, 2);
  assert.deepEqual(timetable.lessons.map(({ day, periodStart, periodEnd, name }) => [day, periodStart, periodEnd, name]), [
    [1, 1, 2, '高等数学'], [2, 3, 4, '数据结构'],
  ]);
  assert.equal(timetable.lessons[1].location, '一教 101');
  assert.equal(requests[2].options.body.get('zc'), '7');
  assert.equal(requests[2].options.body.get('xn'), '2026-2027');
});

test('detects an expired TIS login', async () => {
  const fetcher = async (url) => reply(url, '{"content":"session已失效"}', 401);
  await assert.rejects(fetchTisTimetable(fetcher), TisAuthError);
});

test('detects a plain text TIS session expiry before JSON parsing', async () => {
  const fetcher = async (url) => reply(url, 'session已失效，请用户重新登录页面', 401);
  await assert.rejects(fetchTisSemesterSchedule('2026-2027', '1', fetcher), TisAuthError);
});

test('retries a TIS rate limit response and loads the semester schedule', async () => {
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    return reply(url, calls === 1 ? '查询请求频率过高' : '[]');
  };
  const schedule = await fetchTisSemesterSchedule('2026-2027', '1', fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(schedule.lessons, []);
});

test('reports unexpected TIS text so the failure can be diagnosed', async () => {
  const fetcher = async (url) => reply(url, '服务暂时不可用');
  await assert.rejects(fetchTisSemesterSchedule('2026-2027', '1', fetcher), /TIS 返回非 JSON 数据（HTTP 200）：服务暂时不可用/);
});

test('recognizes when TIS rejects an extension origin', async () => {
  const fetcher = async (url) => reply(url, 'Invalid CORS request', 403);
  await assert.rejects(fetchTisSemesterSchedule('2026-2027', '1', fetcher), TisCorsError);
});

test('loads the semester schedule through a temporary TIS page and closes it', async () => {
  const messages = [];
  const removed = [];
  const chromeApi = { tabs: {
    create: async (options) => {
      assert.deepEqual(options, { url: 'https://tis.sustech.edu.cn/', active: false });
      return { id: 7 };
    },
    get: async () => ({ id: 7, status: 'complete', url: 'https://tis.sustech.edu.cn/' }),
    sendMessage: async (id, message, options) => {
      messages.push({ id, message, options });
      return {
        url: 'https://tis.sustech.edu.cn/xszykb/queryxszykbzong', status: 200,
        body: JSON.stringify([
          { KEY: 'xq1_jc1', KSJC: '1', JSJC: '2', ZC: '011', KCWZSM: 'Data Structures' },
        ]),
      };
    },
    remove: async (id) => { removed.push(id); },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
    onRemoved: { addListener: () => {}, removeListener: () => {} },
  } };
  const schedule = await fetchTisSemesterScheduleFromPage('2026-2027', '1', chromeApi);
  assert.equal(schedule.lessons.length, 1);
  assert.deepEqual(messages[0], {
    id: 7, message: { type: 'tis.semesterRequest', xn: '2026-2027', xq: '1' }, options: { frameId: 0 },
  });
  assert.deepEqual(removed, [7]);
});

test('does not mislabel an unrelated HTTP 401 as an expired login', async () => {
  const fetcher = async (url) => reply(url, '{"error":"access denied"}', 401);
  await assert.rejects(fetchTisTimetable(fetcher), /TIS 接口返回 HTTP 401/);
});

test('rejects malformed timetable data instead of caching an empty week', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/querydangqianxnxq')) return reply(url, JSON.stringify({ XN: '2026-2027', XQ: '1' }));
    if (url.endsWith('/querydangqianzc')) return reply(url, '7');
    return reply(url, '{"unexpected":true}');
  };
  await assert.rejects(fetchTisTimetable(fetcher), /课程表数据格式无效/);
});

test('loads a full semester and interprets the ZC header correctly', async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    return reply(url, JSON.stringify([
      { KEY: 'xq1_jc2', KSJC: '3', JSJC: '4', ZC: '0101', KCWZSM: 'Data Structures', JASMC: 'Room 101', SKJS: 'Teacher A' },
      { KEY: 'xq1_jc2', KSJC: '3', JSJC: '4', ZC: '0101', KCWZSM: 'Data Structures', JASMC: 'Room 101', SKJS: 'Teacher A' },
    ]));
  };
  const schedule = await fetchTisSemesterSchedule('2026-2027', '1', fetcher);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/xszykb\/queryxszykbzong$/);
  assert.equal(requests[0].options.body.get('xn'), '2026-2027');
  assert.equal(requests[0].options.body.get('xq'), '1');
  assert.equal(schedule.lessons.length, 1);
  assert.deepEqual(schedule.lessons[0].weeks, [1, 3]);
  assert.equal(schedule.lessons[0].periodStart, 3);
  assert.equal(schedule.lessons[0].periodEnd, 4);
  assert.equal(schedule.lessons[0].location, 'Room 101');
});
