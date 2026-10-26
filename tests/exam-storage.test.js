import test from 'node:test';
import assert from 'node:assert/strict';
import { combineExamSources, removeStoredManualExam } from '../src/core/exam.js';

test('a refreshed TIS list keeps locally added exams visible', () => {
  const manual = { manualId: 'manual-1', isManuallyAdded: true, KCMC: '手动考试', KSRQ: '2026-11-01' };
  const oldTis = { KCMC: '旧考试', KSRQ: '2026-10-25' };
  const newTis = { KCMC: '新考试', KSRQ: '2026-10-28' };
  assert.deepEqual(combineExamSources([oldTis], [manual]), [oldTis, manual]);
  assert.deepEqual(combineExamSources([newTis], [manual]), [newTis, manual]);
  assert.deepEqual(combineExamSources([manual, newTis], [manual]), [newTis, manual]);
});

test('deleting a manual exam removes only the selected record', () => {
  const first = { manualId: '1', isManuallyAdded: true, KCMC: '同名课程', KSRQ: '2026-11-01' };
  const second = { ...first, manualId: '2' };
  assert.deepEqual(removeStoredManualExam([first, second], second), [first]);
  const legacy = { isManuallyAdded: true, KCMC: '旧记录', KSRQ: '2026-11-02' };
  assert.deepEqual(removeStoredManualExam([legacy, legacy], legacy), [legacy]);
});
