// EazyBB background service worker (MV3)
// 所有对校园系统的网络请求集中在这里发（复用浏览器 Cookie 登录态）。

import { apiFetch } from './core/net.js';
import { AcademicCalendar, todayISO } from './core/calendar.js';
import { Semester } from './core/semester.js';
import { buildSemesterTimetable } from './core/timetable.js';
import { loginToTis, refreshBlackboardSession, refreshTisSession, testCasCredentials } from './core/cas-auth.js';
import { fetchBlackboardAssignmentDetail, fetchBlackboardAssignments, fetchBlackboardCourseAnnouncements, fetchBlackboardCourseMaterials } from './core/blackboard.js';
import { createBlackboardSessionManager } from './core/blackboard-session.js';
import { TisAuthError, TisCorsError, fetchTisSemesterSchedule } from './core/tis.js';
import { fetchTisSemesterScheduleFromPage } from './core/tis-page.js';
import { filterExamsByRange, sortExams } from './core/exam.js';

// 点击工具栏图标时由 Chrome 打开扩展侧边栏。
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
// 避免网页内容脚本读取扩展本地存储中的账号信息。
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const calendarStorage = {
  get: (key) => chrome.storage.local.get(key),
  set: (obj) => chrome.storage.local.set(obj),
};

const calendarCache = new Map();
async function getCalendar(year, level = 'undergraduate') {
  const key = `${year}/${level}`;
  if (!calendarCache.has(key)) {
    calendarCache.set(key, await AcademicCalendar.load(year, level, { storage: calendarStorage }));
  }
  return calendarCache.get(key);
}

function serializeDay(day) {
  return {
    date: day.date,
    weekday: day.weekday,
    week: day.week,
    semester: day.semester ? day.semester.human : null,
    tis: day.semester ? day.semester.tis : null,
    holiday: day.isHoliday() ? day.holiday.name : null,
    isCompensatory: day.isCompensatory(),
    isExtraBreak: day.isExtraBreak(),
    isFinal: day.isFinal(),
    isMidterm: day.isMidterm(),
    isTeachingDay: day.isTeachingDay(),
    hasClass: day.hasClass(),
    summary: String(day),
  };
}

const blackboardSession = createBlackboardSessionManager({
  getCredentials: async () => {
    const { eazybb_credentials: saved } = await chrome.storage.local.get('eazybb_credentials');
    return saved;
  },
  loginWithCredentials: testCasCredentials,
  refreshSession: refreshBlackboardSession,
});
const withBlackboardLogin = blackboardSession.run;

async function getTisTimetable() {
  const current = Semester.current(todayISO());
  const task = async () => {
    try {
      return await fetchTisSemesterSchedule(current.xn, current.xq);
    } catch (error) {
      if (!(error instanceof TisCorsError)) throw error;
      return fetchTisSemesterScheduleFromPage(current.xn, current.xq);
    }
  };
  let schedule;
  try {
    schedule = await task();
  } catch (error) {
    if (!(error instanceof TisAuthError)) throw error;
    let refreshed = false;
    try { refreshed = await refreshTisSession(); }
    catch { /* A failed CAS refresh can still be recovered with saved credentials. */ }
    if (refreshed) {
      try { schedule = await task(); }
      catch (retryError) { if (!(retryError instanceof TisAuthError)) throw retryError; }
    }
    if (!schedule) {
      const { eazybb_credentials: saved } = await chrome.storage.local.get('eazybb_credentials');
      if (!saved?.studentId || !saved?.password) throw new Error('请先在设置中填写并保存校园账号');
      await loginToTis(saved.studentId, saved.password);
      schedule = await task();
    }
  }
  const calendarYear = Number(current.xn.slice(0, 4)) + (current.xq === '2' ? 1 : 0);
  const calendar = await getCalendar(calendarYear);
  const semester = current.xq === '2' ? calendar.spring : calendar.fall;
  return buildSemesterTimetable(semester, schedule, current, todayISO());
}

async function getTisExams() {
  const task = async () => {
    // 调用 TIS 考试时间表 API
    const response = await apiFetch('https://tis.sustech.edu.cn/component/queryKsxxByXs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return response;
  };

  let exams;
  try {
    exams = await task();
  } catch (error) {
    if (!(error instanceof TisAuthError)) throw error;
    let refreshed = false;
    try { refreshed = await refreshTisSession(); }
    catch { /* A failed CAS refresh can still be recovered with saved credentials. */ }
    if (refreshed) {
      try { exams = await task(); }
      catch (retryError) { if (!(retryError instanceof TisAuthError)) throw retryError; }
    }
    if (!exams) {
      const { eazybb_credentials: saved } = await chrome.storage.local.get('eazybb_credentials');
      if (!saved?.studentId || !saved?.password) throw new Error('请先在设置中填写并保存校园账号');
      await loginToTis(saved.studentId, saved.password);
      exams = await task();
    }
  }

  return Array.isArray(exams) ? exams : [];
}

async function handleRuntimeMessage(msg) {
  switch (msg?.type) {
    case 'ping':
      return { ok: true, version: chrome.runtime.getManifest().version };

    case 'auth.test': {
      const data = await testCasCredentials(msg.studentId, msg.password);
      return { ok: true, data };
    }

    case 'bb.overview': {
      const data = await withBlackboardLogin(() => fetchBlackboardAssignments());
      return { ok: true, data };
    }

    case 'tis.timetable': {
      const data = await getTisTimetable();
      return { ok: true, data };
    }

    case 'bb.assignmentDetail': {
      const data = await withBlackboardLogin(() => fetchBlackboardAssignmentDetail(msg.courseId, msg.contentId));
      return { ok: true, data };
    }

    case 'bb.courseAnnouncements': {
      const data = await withBlackboardLogin(() => fetchBlackboardCourseAnnouncements(msg.courseId));
      return { ok: true, data };
    }

    case 'bb.courseMaterials': {
      const key = `bb:menu:${msg.courseId}`;
      const savedMenu = (await chrome.storage.local.get(key))[key];
      const data = await withBlackboardLogin(() => fetchBlackboardCourseMaterials(msg.courseId, fetch, savedMenu));
      return { ok: true, data };
    }

    case 'bb.relogin': {
      await blackboardSession.relogin();
      return { ok: true };
    }

    case 'fetch': {
      const data = await apiFetch(msg.url, {
        method: msg.method ?? 'GET',
        headers: msg.headers,
        body: msg.body,
      });
      return { ok: true, data };
    }

    case 'semester.current': {
      const sem = Semester.current(msg.date ?? null);
      return { ok: true, data: { tis: sem.tis, human: sem.human, xnxqmc: sem.xnxqmc, xn: sem.xn, xq: sem.xq } };
    }

    case 'calendar.day': {
      const iso = msg.date ?? todayISO();
      const cal = await getCalendar(Number(iso.slice(0, 4)));
      return { ok: true, data: serializeDay(cal.day(iso)) };
    }

    case 'calendar.dateOf': {
      const cal = await getCalendar(msg.year);
      const sem = msg.season === 'fall' ? cal.fall : cal.spring;
      return { ok: true, data: sem.dateOf(msg.week, msg.weekday) };
    }

    case 'tis.exams': {
      const allExams = await getTisExams();
      const daysAhead = msg.daysAhead ?? 30;
      const today = msg.today ?? todayISO();
      const filtered = filterExamsByRange(allExams, daysAhead, today);
      const sorted = sortExams(filtered, 'dateAsc');
      return { ok: true, data: sorted };
    }

    default:
      throw new Error(`unknown message type: ${msg?.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleRuntimeMessage(msg)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // async
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ eazybb_context_level: 'terse' });
});
