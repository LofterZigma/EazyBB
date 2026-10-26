import test from 'node:test';
import assert from 'node:assert/strict';
import { courseAssociationKey, findBlackboardCourse, resolveBlackboardCourse } from '../src/core/course-match.js';

test('a timetable title opens the matching Blackboard course', () => {
  const courses = [
    { id: '_10_1', name: '数据结构' },
    { id: '_20_1', name: '大学物理（2026 秋）' },
  ];
  assert.equal(findBlackboardCourse('数据 结构', courses), courses[0]);
  assert.equal(findBlackboardCourse('大学物理', courses), courses[1]);
});

test('ambiguous or absent course names do not open an unrelated course', () => {
  const courses = [
    { id: '_10_1', name: '高等数学 A' },
    { id: '_20_1', name: '高等数学 B' },
    { id: '_30_1', name: 'CS101 · 大学物理' },
  ];
  assert.equal(findBlackboardCourse('高等数学', courses), null);
  assert.equal(findBlackboardCourse('线性代数', courses), null);
  assert.equal(findBlackboardCourse('高数', courses), null);
  assert.equal(findBlackboardCourse('大学物理', courses), null, 'a middle-of-name match is not a prefix');
});

test('an exact name wins over a longer prefix match', () => {
  const courses = [
    { id: '_10_1', name: '大学物理' },
    { id: '_20_1', name: '大学物理实验' },
  ];
  assert.equal(findBlackboardCourse('大学物理', courses), courses[0]);
});

test('saved course associations override automatic matching for their semester', () => {
  const courses = [
    { id: '_10_1', name: '编译原理' },
    { id: '_20_1', name: '编译原理实验' },
  ];
  const associations = { [courseAssociationKey('fall.ics', '编译原理')]: '_20_1' };
  assert.equal(resolveBlackboardCourse('编译原理', courses, associations, 'fall.ics'), courses[1]);
  assert.equal(resolveBlackboardCourse('编译原理', courses, associations, 'spring.ics'), courses[0]);
  assert.equal(resolveBlackboardCourse('编译原理', courses, { [courseAssociationKey('fall.ics', '编译原理')]: '_99_1' }, 'fall.ics'), courses[0]);
});

test('one Blackboard course can be linked to multiple timetable course names', () => {
  const course = { id: '_10_1', name: '计算机系统' };
  const associations = {
    [courseAssociationKey('fall.ics', '计算机系统理论')]: course.id,
    [courseAssociationKey('fall.ics', '计算机系统实验')]: course.id,
  };
  assert.equal(resolveBlackboardCourse('计算机系统理论', [course], associations, 'fall.ics'), course);
  assert.equal(resolveBlackboardCourse('计算机系统实验', [course], associations, 'fall.ics'), course);
});
