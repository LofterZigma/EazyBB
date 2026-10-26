// ported from sustech_survival/semester.py — TIS semester codes.

export const Season = {};

const SEASONS_BY_VALUE = {};

function defineSeason(name, value) {
  const season = { value, name };
  Object.defineProperty(season, 'chinese', {
    get: () => ({ fall: '秋季', spring: '春季', summer: '夏季' }[value]),
  });
  Object.defineProperty(season, 'termNum', {
    get: () => ({ fall: 1, spring: 2, summer: 3 }[value]),
  });
  Object.freeze(season);
  Season[name] = season;
  SEASONS_BY_VALUE[value] = season;
  return season;
}

Season.FALL = defineSeason('FALL', 'fall');
Season.SPRING = defineSeason('SPRING', 'spring');
Season.SUMMER = defineSeason('SUMMER', 'summer');

Season.fromInt = function (n) {
  return { 1: Season.FALL, 2: Season.SPRING, 3: Season.SUMMER }[n];
};

// 学季归属：1/2 月视为春季，7/8 月夏季，9-12 月秋季。
Season.fromMonths = function (month) {
  if ([9, 10, 11, 12].includes(month)) return Season.FALL;
  if ([1, 2, 3, 4, 5, 6].includes(month)) return Season.SPRING;
  return Season.SUMMER;
};

Season.fromTermNum = Season.fromInt;

Object.freeze(Season);

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

function code(end, cohort, season) {
  return `${end}-${cohort}${season.termNum}`;
}

export class Semester {
  // value: TIS code 字符串（"2025-20262"/"2025-2026-2"），或 (cohort_year, season)，或 (xn 字符串, xq 字符串)。
  constructor(value, season = null) {
    if (typeof value === 'string' && season !== null && typeof season === 'string') {
      this.endYear = Number(value.slice(0, 4));
      this.cohortYear = Number(value.slice(5, 9));
      this.season = Season.fromInt(Number(season));
    } else if (typeof value === 'string') {
      const clean = value.replace(/-/g, '');
      if (clean.length !== 9 || !/^\d{9}$/.test(clean)) {
        throw new Error(`Invalid TIS code: ${JSON.stringify(value)}`);
      }
      this.endYear = Number(clean.slice(0, 4));
      this.cohortYear = Number(clean.slice(4, 8));
      this.season = Season.fromInt(Number(clean[8]));
    } else {
      if (season === null || season === undefined) {
        throw new TypeError(
          `Semester(${value}) requires an explicit season. ` +
          "Use new Semester(year, Season.FALL) or new Semester('2025-20262')"
        );
      }
      this.cohortYear = Number(value);
      this.season = SEASONS_BY_VALUE[season.value] ?? season;
      this.endYear = this.season === Season.FALL ? this.cohortYear + 1 : this.cohortYear;
    }
  }

  static current(todayIso = null) {
    const iso = todayIso ?? todayISO();
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const season = Season.fromMonths(month);
    let end, cohort;
    if (season === Season.FALL) {
      end = year;
      cohort = year + 1;
    } else {
      end = year - 1;
      cohort = year;
    }
    return new Semester(code(end, cohort, season));
  }

  get xn() { return `${this.endYear}-${this.cohortYear}`; }
  get xq() { return String(this.season.termNum); }
  get tis() { return code(this.endYear, this.cohortYear, this.season); }
  get tisHuman() { return `${this.endYear}-${this.cohortYear}-${this.season.termNum}`; }
  get human() { return `${this.cohortYear} ${capitalize(this.season.value)}`; }
  get xnxq() { return this.tisHuman; }
  get xnxqmc() { return `${this.endYear}${this.season.chinese}`; }

  toString() { return this.human; }
  repr() { return `Semester(${this.human}, tis='${this.tis}')`; }
  equals(other) { return other instanceof Semester && this.tis === other.tis; }
}

function todayISO() {
  const d = new Date();
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
