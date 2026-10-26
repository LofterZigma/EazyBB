import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXAM_PREFERENCES,
  normalizeExamPreferences,
  filterExamsByRange,
  sortExams,
  groupExamsByDate,
  formatExamDate,
  getPeriodName,
} from '../src/core/exam.js';

describe('exam', () => {
  describe('normalizeExamPreferences', () => {
    it('should return default preferences when given null', () => {
      const result = normalizeExamPreferences(null);
      assert.deepEqual(result, DEFAULT_EXAM_PREFERENCES);
    });

    it('should return default preferences when given undefined', () => {
      const result = normalizeExamPreferences(undefined);
      assert.deepEqual(result, DEFAULT_EXAM_PREFERENCES);
    });

    it('should clamp daysAhead to valid range', () => {
      const result = normalizeExamPreferences({ daysAhead: 500 });
      assert.equal(result.daysAhead, 365);

      const result2 = normalizeExamPreferences({ daysAhead: 0 });
      assert.equal(result2.daysAhead, 1);
    });

    it('should preserve valid sortBy values', () => {
      const result = normalizeExamPreferences({ sortBy: 'dateAsc' });
      assert.equal(result.sortBy, 'dateAsc');
    });

    it('should reset invalid sortBy to default', () => {
      const result = normalizeExamPreferences({ sortBy: 'invalid' });
      assert.equal(result.sortBy, DEFAULT_EXAM_PREFERENCES.sortBy);
    });

    it('should preserve boolean enabled field', () => {
      const result = normalizeExamPreferences({ enabled: false });
      assert.equal(result.enabled, false);
    });
  });

  describe('filterExamsByRange', () => {
    const exams = [
      { KSRQ: '2026-01-15', KCMC: '数学' },
      { KSRQ: '2026-02-01', KCMC: '英语' },
      { KSRQ: '2026-03-15', KCMC: '物理' },
      { KSRQ: '2026-05-20', KCMC: '化学' },
    ];

    it('should filter exams within specified days', () => {
      const result = filterExamsByRange(exams, 30, '2026-01-10');
      assert.equal(result.length, 2);
      assert.equal(result[0].KCMC, '数学');
      assert.equal(result[1].KCMC, '英语');
    });

    it('should return empty array when no exams are in range', () => {
      const result = filterExamsByRange(exams, 5, '2026-06-01');
      assert.deepEqual(result, []);
    });

    it('should handle missing KSRQ field', () => {
      const examsWithMissing = [...exams, { KCMC: '生物' }];
      const result = filterExamsByRange(examsWithMissing, 365, '2026-01-01');
      assert.equal(result.length, 4);
    });

    it('should return empty array for non-array input', () => {
      const result = filterExamsByRange(null, 30, '2026-01-01');
      assert.deepEqual(result, []);
    });
  });

  describe('sortExams', () => {
    const exams = [
      { KSRQ: '2026-02-01', KCMC: '英语' },
      { KSRQ: '2026-01-15', KCMC: '数学' },
      { KSRQ: '2026-03-15', KCMC: '物理' },
    ];

    it('should sort exams by date ascending', () => {
      const result = sortExams(exams, 'dateAsc');
      assert.equal(result[0].KCMC, '数学');
      assert.equal(result[1].KCMC, '英语');
      assert.equal(result[2].KCMC, '物理');
    });

    it('should not mutate original array', () => {
      const original = [...exams];
      sortExams(exams, 'dateAsc');
      assert.deepEqual(exams, original);
    });
  });

  describe('groupExamsByDate', () => {
    const exams = [
      { KSRQ: '2026-01-15', KCMC: '数学' },
      { KSRQ: '2026-01-15', KCMC: '英语' },
      { KSRQ: '2026-02-01', KCMC: '物理' },
    ];

    it('should group exams by date', () => {
      const result = groupExamsByDate(exams);
      assert.deepEqual(Object.keys(result), ['2026-01-15', '2026-02-01']);
      assert.equal(result['2026-01-15'].length, 2);
      assert.equal(result['2026-02-01'].length, 1);
    });

    it('should handle missing KSRQ', () => {
      const examsWithMissing = [...exams, { KCMC: '化学' }];
      const result = groupExamsByDate(examsWithMissing);
      assert.equal(result['未知'].length, 1);
    });
  });

  describe('formatExamDate', () => {
    it('should format date correctly', () => {
      assert.equal(formatExamDate('2026-10-19'), '10月19日 周一');
    });

    it('should handle invalid dates', () => {
      assert.equal(formatExamDate('invalid'), 'invalid');
      assert.equal(formatExamDate('2026-02-30'), '2026-02-30');
    });

    it('should handle null or undefined', () => {
      assert.equal(formatExamDate(null), '未知');
      assert.equal(formatExamDate(undefined), '未知');
      assert.equal(formatExamDate('未知'), '未知');
    });
  });

  describe('getPeriodName', () => {
    it('should return period name for valid numbers', () => {
      assert.equal(getPeriodName(1), '第1节');
      assert.equal(getPeriodName(5), '第5节');
      assert.equal(getPeriodName(13), '第13节');
    });

    it('should handle invalid period numbers', () => {
      assert.equal(getPeriodName(14), '第14节');
      assert.equal(getPeriodName(0), '第0节');
    });
  });
});
