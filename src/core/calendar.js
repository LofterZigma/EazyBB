// ported from sustech_survival/calendar.py — academic calendar date intelligence.
// 日期一律用 'YYYY-MM-DD' ISO 字符串（可字典序比较/排序，避开时区问题）。

import { Season, Semester as TisSemester } from './semester.js';

export { Season };

export const WEEKDAY_INDEX = Object.freeze({
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3,
  Friday: 4, Saturday: 5, Sunday: 6,
});
export const INDEX_WEEKDAY = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

export const BUNDLED_CALENDAR_BASE = new URL('../../data/calendar/', import.meta.url).href;
export const CALENDAR_PROXY_BASE = 'https://jsd.onmicrosoft.cn/gh/dumixthestpd/sustech-calendar@main';

export class CalendarError extends Error {}

// -- date helpers -------------------------------------------------

const MS_DAY = 86400000;

export function isoToUTC(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
export function utcToISO(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function addDays(iso, n) { return utcToISO(isoToUTC(iso) + n * MS_DAY); }
export function diffDays(a, b) { return Math.round((isoToUTC(b) - isoToUTC(a)) / MS_DAY); }
export function weekdayOf(iso) { return (new Date(isoToUTC(iso)).getUTCDay() + 6) % 7; } // 0=Mon..6=Sun
export function monthOf(iso) { return +iso.slice(5, 7); }
export function yearOf(iso) { return +iso.slice(0, 4); }
export function todayISO() {
  const d = new Date();
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// -- records -------------------------------------------------------

export class Compensatory {
  constructor({ date, weekType, workday }) {
    this.date = date;
    this.weekType = weekType;
    this.workday = workday;
  }
  static fromDict(d) {
    return new Compensatory({ date: d.date, weekType: d.week_type, workday: d.workday_type });
  }
}

export class Holiday {
  constructor({ name, start, end }) {
    this.name = name;
    this.start = start;
    this.end = end;
  }
  static fromDict(d) { return new Holiday({ name: d.name, start: d.start, end: d.end }); }
}

export class ClassTime {
  constructor({ weeks, weekday, periods, title = '', teacher = '', room = '' }) {
    this.weeks = weeks;
    this.weekday = weekday;
    this.periods = periods;
    this.title = title;
    this.teacher = teacher;
    this.room = room;
  }

  equals(o) {
    return o instanceof ClassTime &&
      this.weekday === o.weekday &&
      this.weeks.join(',') === o.weeks.join(',') &&
      this.periods.join(',') === o.periods.join(',') &&
      this.title === o.title && this.teacher === o.teacher && this.room === o.room;
  }

  matchesDate(iso, semester) {
    if (weekdayOf(iso) !== this.weekday) return false;
    const week = semester.weekOf(iso);
    if (week === 0) return false;
    return this.weeks.includes(week);
  }
}

// -- Day -----------------------------------------------------------

export class Day {
  constructor({ date, week, weekday, semester, holiday = null, comp = null,
                inFinalWeek = false, inMidtermWeek = false }) {
    this.date = date;
    this.week = week;
    this.weekday = weekday;
    this.semester = semester;
    this.holiday = holiday;
    this.comp = comp;
    this.inFinalWeek = inFinalWeek;
    this.inMidtermWeek = inMidtermWeek;
  }

  isHoliday() { return this.holiday !== null; }
  isCompensatory() { return this.comp !== null; }
  isExtraBreak() {
    return this.semester !== null && this.semester.extraBreaks.has(this.date);
  }
  isFinal() { return this.inFinalWeek; }
  isMidterm() {
    return this.inMidtermWeek && !this.isHoliday() && !this.isCompensatory() &&
      !this.isFinal() && !this.isExtraBreak();
  }
  isWeekend() { return weekdayOf(this.date) >= 5; }
  isTeachingDay() {
    if (this.semester === null) return false;
    if (this.isHoliday() || this.isCompensatory()) return false;
    if (this.isFinal() || this.isExtraBreak()) return false;
    if (this.isWeekend()) return false;
    return true;
  }
  hasClass() { return this.isTeachingDay() || this.isCompensatory(); }

  get schedule() {
    const sem = this.semester;
    if (sem === null) return [];
    if (this.isHoliday() || this.isFinal() || this.isExtraBreak()) return [];
    if (this.isCompensatory() && this.comp !== null) {
      const nearest = sem._holidayFor(this.comp);
      if (nearest === null || nearest === undefined) return [];
      return sem.classes.filter((c) => c.matchesDate(nearest, sem));
    }
    return sem.classes.filter((c) => c.matchesDate(this.date, sem));
  }

  toString() {
    const parts = [this.date, this.weekday];
    if (this.week > 0) parts.push(`Week ${this.week}`);
    if (this.semester !== null) parts.push(this.semester.human);
    const notes = [];
    if (this.isHoliday() && this.holiday !== null) notes.push(`(${this.holiday.name})`);
    if (this.isCompensatory()) notes.push('(makeup-class day)');
    if (this.isExtraBreak()) notes.push('(school break)');
    if (this.isFinal()) notes.push('(finals)');
    if (this.isMidterm()) notes.push('(midterm)');
    if (notes.length) parts.push(notes.join(' '));
    return parts.join(' — ');
  }
}

// -- Semester ------------------------------------------------------

export class Semester {
  constructor({ tis, level, teachingStart, teachingEnd, signIn, freshmanArrival,
                totalTeachingWeeks, midtermStart, midtermEnd, midtermWeeks,
                finalStart, finalEnd, finalWeeks, compensatories, extraBreaks }) {
    this._tis = tis;
    this.level = level;
    this.teachingStart = teachingStart;
    this.teachingEnd = teachingEnd;
    this.signIn = signIn;
    this.freshmanArrival = freshmanArrival;
    this.totalTeachingWeeks = totalTeachingWeeks;
    this.midtermStart = midtermStart;
    this.midtermEnd = midtermEnd;
    this.midtermWeeks = new Set(midtermWeeks);
    this.finalStart = finalStart;
    this.finalEnd = finalEnd;
    this.finalWeeks = new Set(finalWeeks);
    this.compensatories = compensatories;
    this.extraBreaks = new Set(extraBreaks);
    this.classes = [];
    this._calendar = null;
  }

  get season() { return this._tis.season; }
  get tis() { return this._tis.tis; }
  get tisHuman() { return this._tis.tisHuman; }
  get human() { return this._tis.human; }
  get xn() { return this._tis.xn; }
  get xq() { return this._tis.xq; }
  get calendar() { return this._calendar; }
  set calendar(value) { this._calendar = value; }

  dateOf(week, weekday) {
    const maxFinal = this.finalWeeks.size ? Math.max(...this.finalWeeks) : 0;
    const maxWeek = this.totalTeachingWeeks + maxFinal;
    if (!(1 <= week && week <= maxWeek)) {
      throw new CalendarError(`week ${week} out of range for ${this.human} (valid: 1..${maxWeek})`);
    }
    if (!(0 <= weekday && weekday <= 6)) {
      throw new CalendarError(`weekday must be 0..6, got ${weekday}`);
    }
    const teachingMonday = addDays(this.teachingStart, -weekdayOf(this.teachingStart));
    return addDays(teachingMonday, 7 * (week - 1) + weekday);
  }

  weekOf(iso) {
    if (!this.isInSemester(iso)) return 0;
    const teachingMonday = addDays(this.teachingStart, -weekdayOf(this.teachingStart));
    return Math.floor(diffDays(teachingMonday, iso) / 7) + 1;
  }

  isInSemester(iso) { return this.signIn <= iso && iso <= this.finalEnd; }

  day(d = null) { return this._buildDay(d ?? todayISO()); }

  _buildDay(iso) {
    const week = this.weekOf(iso);
    const weekday = INDEX_WEEKDAY[weekdayOf(iso)];
    const holiday = this._holidayAt(iso);
    const comp = this._compensatoryAt(iso);
    const inFinal = week > 0 && this.finalWeeks.has(week);
    const inMidterm = week > 0 && this.midtermWeeks.has(week);
    return new Day({
      date: iso, week, weekday, semester: this,
      holiday, comp, inFinalWeek: inFinal, inMidtermWeek: inMidterm,
    });
  }

  _holidayAt(iso) {
    if (this.calendar === null) return null;
    for (const h of this.calendar.holidays) {
      if (h.start <= iso && iso <= h.end) return h;
    }
    return null;
  }

  _compensatoryAt(iso) {
    for (const c of this.compensatories) {
      if (c.date === iso) return c;
    }
    return null;
  }

  fill(classTime) {
    if (this.classes.some((c) => c.equals(classTime))) return false;
    const dates = this._computeDates(classTime);
    if (!dates.length) return false;
    this.classes.push(classTime);
    return true;
  }

  dates(classTime) { return this._computeDates(classTime); }

  _computeDates(classTime) {
    const weekday = classTime.weekday;
    const weekdayName = INDEX_WEEKDAY[weekday];
    const out = [];
    for (const week of classTime.weeks) {
      let iso;
      try {
        iso = this.dateOf(week, weekday);
      } catch {
        continue;
      }
      if (!this.isInSemester(iso)) continue;
      if (weekdayOf(iso) >= 5) continue;
      if (this._compensatoryAt(iso) !== null) continue;
      const day = this._buildDay(iso);
      if (day.isHoliday() || day.isFinal() || day.isExtraBreak()) {
        const parity = week % 2 === 1 ? 'odd' : 'even';
        const comp = this._compForFlushed(iso, parity, weekdayName);
        if (comp !== null) out.push(comp.date);
      } else if (day.isMidterm() || day.isTeachingDay()) {
        out.push(iso);
      }
    }
    return [...new Set(out)].sort();
  }

  _holidayFor(comp) {
    if (this.calendar === null) return null;
    const wi = WEEKDAY_INDEX[comp.workday];
    const candidates = [];
    for (const h of this.calendar.holidays) {
      const nDays = diffDays(h.start, h.end) + 1;
      for (let offset = 0; offset < nDays; offset++) {
        const iso = addDays(h.start, offset);
        if (weekdayOf(iso) !== wi) continue;
        const w = this.weekOf(iso);
        if (w === 0) continue;
        if ((w % 2 === 1 ? 'odd' : 'even') !== comp.weekType) continue;
        candidates.push(iso);
      }
    }
    if (!candidates.length) return null;
    const forward = candidates.filter((d) => d <= comp.date).sort();
    const backward = candidates.filter((d) => d > comp.date).sort();
    return forward.length ? forward[forward.length - 1]
      : (backward.length ? backward[0] : null);
  }

  _compForFlushed(flushedDate, parity, workday) {
    const candidates = this.compensatories.filter(
      (c) => c.weekType === parity && c.workday === workday &&
        this._holidayFor(c) === flushedDate
    );
    if (!candidates.length) return null;
    const forward = candidates.filter((c) => c.date >= flushedDate)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (forward.length) return forward[0];
    return candidates.reduce((m, c) => (c.date > m.date ? c : m));
  }

  static fromPayload(payload, level) {
    if (!('teaching_start' in payload)) {
      throw new CalendarError(`payload missing 'teaching_start': ${JSON.stringify(payload)}`);
    }
    const ts = payload.teaching_start;
    const season = monthOf(ts) <= 7 ? Season.SPRING : Season.FALL;
    const tis = new TisSemester(yearOf(ts), season);
    const signIn = payload.sign_in;
    const finalEnd = payload.final.end;
    const teachingEnd = lastTeachingDay(payload, ts, finalEnd);
    return new Semester({
      tis,
      level,
      teachingStart: ts,
      teachingEnd,
      signIn,
      freshmanArrival: 'freshman_arrival' in payload ? payload.freshman_arrival : null,
      totalTeachingWeeks: Number(payload.total_teaching_weeks),
      midtermStart: payload.midterm.start,
      midtermEnd: payload.midterm.end,
      midtermWeeks: [...payload.midterm.equivalent_weeks],
      finalStart: payload.final.start,
      finalEnd,
      finalWeeks: [...payload.final.equivalent_weeks],
      compensatories: (payload.compensatories ?? []).map(Compensatory.fromDict),
      extraBreaks: [...(payload.extra_breaks ?? [])],
    });
  }

  toString() { return `Semester('${this.human}', level='${this.level}')`; }
}

function lastTeachingDay(payload, teachingStart, finalEnd) {
  const finalWeeks = payload.final.equivalent_weeks.map(Number).sort((a, b) => a - b);
  const firstFinalWeek = finalWeeks[0];
  const lastTeachingWeek = firstFinalWeek - 1;
  if (lastTeachingWeek < 1) return addDays(teachingStart, -1);
  const teachingMonday = addDays(teachingStart, -weekdayOf(teachingStart));
  const lastDay = addDays(teachingMonday, 7 * (lastTeachingWeek - 1) + 6);
  const bound = addDays(finalEnd, -1);
  return lastDay <= bound ? lastDay : bound;
}

// -- AcademicCalendar ----------------------------------------------

export class AcademicCalendar {
  constructor({ year, level, spring, fall, summer, holidays }) {
    if (level !== 'undergraduate' && level !== 'graduate') {
      throw new CalendarError(`level must be 'undergraduate' or 'graduate', got '${level}'`);
    }
    this.year = year;
    this.level = level;
    this.spring = spring;
    this.fall = fall;
    this.summer = summer;
    this.holidays = holidays;
    spring.calendar = this;
    fall.calendar = this;
    if (summer !== null) summer.calendar = this;
  }

  day(d = null) {
    const iso = d ?? todayISO();
    if (this.spring.isInSemester(iso)) return this.spring._buildDay(iso);
    if (this.fall.isInSemester(iso)) return this.fall._buildDay(iso);
    if (this.summer !== null && this.summer.isInSemester(iso)) return this.summer._buildDay(iso);
    return new Day({ date: iso, week: 0, weekday: INDEX_WEEKDAY[weekdayOf(iso)], semester: null });
  }

  // 优先从国内 GitHub CDN 更新校历；离线时使用本地缓存或扩展内置版本。
  static async load(year, level = 'undergraduate', {
    baseUrl = null, storage = null, refresh = false, fetchImpl = null,
  } = {}) {
    if (level !== 'undergraduate' && level !== 'graduate') {
      throw new CalendarError(`level must be 'undergraduate' or 'graduate', got '${level}'`);
    }
    const bases = baseUrl ? [baseUrl.replace(/\/$/, '')] : [
      `${CALENDAR_PROXY_BASE}/${year}`,
      new URL(`${year}/`, BUNDLED_CALENDAR_BASE).href.replace(/\/$/, ''),
    ];
    const files = [`${level}.json`, 'general.json'];
    const payloads = {};
    for (const name of files) {
      payloads[name] = await fetchJsonCached(bases.map((base) => `${base}/${name}`),
        { storage, year, name, refresh, fetchImpl });
    }
    return AcademicCalendar._fromJsonPayloads(year, level, payloads);
  }

  static async refresh(year, level = 'undergraduate', opts = {}) {
    return AcademicCalendar.load(year, level, { ...opts, refresh: true });
  }

  static fromPayloads(year, level, { undergraduate, graduate, general }) {
    for (const h of general.holidays ?? []) {
      for (const key of ['start', 'end']) {
        if (key in h && yearOf(h[key]) !== year) {
          throw new CalendarError(
            `holiday '${h.name ?? '?'}' ${key}=${h[key]} is in ${yearOf(h[key])}, expected ${year}`);
        }
      }
    }
    for (const compDate of general.compensatory_workdays ?? []) {
      if (yearOf(compDate) !== year) {
        throw new CalendarError(`compensatory_workday ${compDate} is in ${yearOf(compDate)}, expected ${year}`);
      }
    }
    return AcademicCalendar._fromJsonPayloads(year, level, {
      'undergraduate.json': undergraduate, 'graduate.json': graduate, 'general.json': general,
    });
  }

  static _fromJsonPayloads(year, level, payloads) {
    const semPayload = payloads[level === 'undergraduate' ? 'undergraduate.json' : 'graduate.json'];
    const general = payloads['general.json'];
    const spring = Semester.fromPayload(semPayload.spring_semester, level);
    const fall = Semester.fromPayload(semPayload.fall_semester, level);
    const summerPayload = semPayload.summer_semester;
    const summer = (summerPayload && 'teaching_start' in summerPayload)
      ? Semester.fromPayload(summerPayload, level) : null;
    return new AcademicCalendar({
      year, level, spring, fall, summer,
      holidays: general.holidays.map(Holiday.fromDict),
    });
  }

  toString() { return `AcademicCalendar(year=${this.year}, level='${this.level}')`; }
}

// -- fetch + optional storage cache --------------------------------

async function fetchJsonCached(urls, { storage, year, name, refresh, fetchImpl }) {
  const doFetch = fetchImpl ?? fetch;
  const key = `calendar/${year}/${name}`;
  const metaKey = `calendar/${year}/.meta`;

  const readCache = async () => storage ? (await storage.get(key))[key] ?? null : null;
  const readMeta = async () => storage ? (await storage.get(metaKey))[metaKey] ?? {} : {};
  const write = async (k, v) => { if (storage) await storage.set({ [k]: v }); };

  const cachedBody = await readCache();
  const meta = await readMeta();
  let lastError;
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const headers = {};
      const cachedEtag = !refresh && meta?.source_url === url.slice(0, url.lastIndexOf('/'))
        ? meta?.files?.[name]?.etag : null;
      if (cachedEtag) headers['If-None-Match'] = cachedEtag;
      const res = await doFetch(url, { headers, signal: controller.signal });
      if (res.status === 304 && cachedBody !== null) return cachedBody;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText ?? ''}`.trim());
      const text = await res.text();
      const data = JSON.parse(text);
      if (name === 'general.json' ? !Array.isArray(data?.holidays)
        : !data?.spring_semester?.teaching_start || !data?.fall_semester?.teaching_start) {
        throw new Error('校历格式无效');
      }
      await write(key, data);
      meta.year = year;
      meta.source_url = url.slice(0, url.lastIndexOf('/'));
      meta.files ??= {};
      meta.files[name] = {
        etag: res.headers?.get?.('etag') ?? null,
        fetched_at: new Date().toISOString(),
        size: text.length,
      };
      await write(metaKey, meta);
      return data;
    } catch (error) {
      lastError = error;
      if (cachedBody !== null) return cachedBody;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new CalendarError(`校历数据读取失败（${year}/${name}）：${lastError?.message ?? '未知错误'}`);
}
