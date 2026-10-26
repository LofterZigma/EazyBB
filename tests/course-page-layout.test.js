import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCoursePageLayout, syncSplitItems, selectCustomRoots, makeRangeSource,
  visibleCoursePageOrder, visibleSplitOrder, reorderVisibleSplitItems,
  recommendedForTimetable, lessonRecommendationKey, recommendedForLesson } from '../src/core/course-page-layout.js';
import { sectionDisplaySettings, applySectionDisplay, filterSectionTree } from '../src/core/course-page-layout.js';
import { lessonPreviewSettings, lessonPreviewItems } from '../src/core/course-page-layout.js';
import { treeNodeDisplaySettings, displayTreeChildren } from '../src/core/course-page-layout.js';
import { lessonTreeNodeDisplaySettings } from '../src/core/course-page-layout.js';

const roots = [{ id: 'a', title: 'Lecture Notes' }, { id: 'b', title: 'Lab Notes' }, { id: 'c', title: 'Projects' }];

test('keeps course section order, visibility and manually added content', () => {
  const saved = {
    order: ['assignments', 'custom:mine', 'announcements', 'tree'], hidden: ['announcements'],
    customs: [{ id: 'custom:mine', title: 'My notes', source: { mode: 'single', rootId: 'b' } }],
  };
  const layout = reconcileCoursePageLayout(saved, roots);
  assert.deepEqual(layout.order, saved.order);
  assert.deepEqual(layout.hidden, saved.hidden);
  assert.deepEqual(selectCustomRoots(layout.customs[0].source, roots).map((root) => root.id), ['b']);
});

test('splitting creates one custom content per root and keeps its saved order and title', () => {
  const layout = syncSplitItems(reconcileCoursePageLayout({ splitTree: true, order: ['tree', 'announcements', 'assignments'] }), roots);
  assert.equal(layout.customs.length, 3);
  assert.deepEqual(layout.customs.map((item) => selectCustomRoots(item.source, roots)[0]?.id), ['a', 'b', 'c']);
  assert.equal(layout.hidden.includes('tree'), true);
  layout.splitOrder = ['custom:tree:b', 'custom:tree:a', 'custom:tree:c'];
  layout.customs[1].title = 'My Lab';
  layout.customs[1].titleAuto = false;
  layout.customs[1].source = { mode: 'range', start: 1, end: 3 };
  const restored = reconcileCoursePageLayout(layout, roots);
  assert.deepEqual(restored.order, layout.order);
  assert.deepEqual(restored.splitOrder, layout.splitOrder);
  assert.equal(restored.customs.find((item) => item.splitRootId === 'b').title, 'My Lab');
  assert.deepEqual(selectCustomRoots(restored.customs.find((item) => item.splitRootId === 'b').source, roots).map((root) => root.id), ['b', 'c']);
  const changed = syncSplitItems(restored, roots.slice(1));
  assert.equal(changed.customs.some((item) => item.splitRootId === 'a'), false);
});

test('migrates old empty and single choices to one-module ranges', () => {
  const layout = reconcileCoursePageLayout({ customs: [
    { id: 'custom:empty', title: 'Empty', source: { mode: 'empty' } },
    { id: 'custom:old', title: 'Old', source: { mode: 'single', rootId: 'a' } },
  ] }, roots);
  assert.deepEqual(layout.customs.map((item) => selectCustomRoots(item.source, roots).map((root) => root.id)), [['a'], ['a']]);
  const split = reconcileCoursePageLayout({ splitTree: true, customs: [{
    id: 'custom:tree:a', title: 'Lecture Notes', origin: 'split',
    source: { mode: 'single', rootId: 'a' },
  }] }, roots);
  assert.deepEqual(selectCustomRoots(split.customs.find((item) => item.splitRootId === 'a').source, roots).map((root) => root.id), ['a']);
});

test('migrates a saved single module after roots finish loading', () => {
  const pending = reconcileCoursePageLayout({ customs: [{
    id: 'custom:lab', title: 'Lab', source: { mode: 'single', rootId: 'b' },
  }] });
  const loaded = reconcileCoursePageLayout(pending, roots);
  assert.deepEqual(selectCustomRoots(loaded.customs[0].source, roots), [roots[1]]);
  assert.equal(loaded.customs[0].source.mode, 'range');
});

test('a range selects roots from its start up to but excluding its end boundary', () => {
  assert.deepEqual(selectCustomRoots(makeRangeSource(roots, 1, 2), roots), [roots[1]]);
  assert.deepEqual(selectCustomRoots({ mode: 'range', start: 1, end: 3 }, roots).map((root) => root.id), ['b', 'c']);
  const saved = makeRangeSource(roots, 1, 3);
  assert.deepEqual(selectCustomRoots(saved, [roots[2], roots[0], roots[1]]).map((root) => root.id), ['b']);
  assert.deepEqual(selectCustomRoots({ mode: 'range', start: 2, end: 2 }, roots), []);
});

test('a split module covered by an earlier range disappears and returns when the range shrinks', () => {
  let layout = syncSplitItems(reconcileCoursePageLayout({ splitTree: true }), roots);
  const first = layout.customs.find((item) => item.splitRootId === 'a');
  first.source = makeRangeSource(roots, 0, 3);
  assert.deepEqual(visibleSplitOrder(layout, roots), ['custom:tree:a']);
  first.source = makeRangeSource(roots, 0, 2);
  layout.customs.find((item) => item.splitRootId === 'b').source = makeRangeSource(roots, 1, 3);
  assert.deepEqual(visibleSplitOrder(layout, roots), ['custom:tree:a', 'custom:tree:c']);
  const visible = visibleSplitOrder(layout, roots);
  layout = reorderVisibleSplitItems(layout, [...visible].reverse(), roots);
  assert.equal(layout.splitOrder.includes('custom:tree:b'), true);
  first.source = makeRangeSource(roots, 0, 1);
  layout.customs.find((item) => item.splitRootId === 'b').source = makeRangeSource(roots, 1, 2);
  assert.deepEqual(new Set(visibleSplitOrder(layout, roots)),
    new Set(['custom:tree:a', 'custom:tree:b', 'custom:tree:c']));
});

test('migrates split cards from the old course layout into content-tree settings', () => {
  const old = syncSplitItems(reconcileCoursePageLayout({ splitTree: true }), roots);
  delete old.splitOrder;
  old.order = ['assignments', 'custom:tree:c', 'tree', 'custom:tree:a', 'announcements', 'custom:tree:b'];
  old.titles = { announcements: '课程通知', tree: '资料目录', assignments: '待交作业' };
  const layout = reconcileCoursePageLayout(old, roots);
  assert.deepEqual(visibleCoursePageOrder(layout, roots), ['assignments', 'tree', 'announcements']);
  assert.deepEqual(visibleSplitOrder(layout, roots), ['custom:tree:c', 'custom:tree:a', 'custom:tree:b']);
  assert.equal(layout.titles.tree, '资料目录');
});

test('each split module range is anchored to its own root', () => {
  const layout = syncSplitItems(reconcileCoursePageLayout({ splitTree: true }), roots);
  layout.customs.find((item) => item.splitRootId === 'b').source = makeRangeSource(roots, 0, 3);
  const normalized = syncSplitItems(layout, roots);
  const source = normalized.customs.find((item) => item.splitRootId === 'b').source;
  assert.deepEqual(selectCustomRoots(source, roots).map((root) => root.id), ['b', 'c']);
});

test('recommended cards survive saved layout normalization and removed cards are dropped', () => {
  const saved = {
    customs: [{ id: 'custom:mine', title: 'My notes', source: makeRangeSource(roots, 0, 1) }],
    recommended: ['announcements', 'custom:mine', 'missing', 'announcements'],
  };
  const layout = reconcileCoursePageLayout(saved, roots);
  assert.deepEqual(layout.recommended, ['announcements', 'custom:mine']);
});

test('each linked timetable course keeps its own recommended cards', () => {
  const layout = reconcileCoursePageLayout({
    recommended: ['announcements'],
    recommendedByTimetable: {
      lecture: ['tree', 'tree', 'missing'],
      lab: ['assignments'],
      empty: [],
    },
  }, roots);
  assert.deepEqual(recommendedForTimetable(layout, 'lecture'), ['tree']);
  assert.deepEqual(recommendedForTimetable(layout, 'lab'), ['assignments']);
  assert.deepEqual(recommendedForTimetable(layout, 'empty'), []);
  assert.deepEqual(recommendedForTimetable(layout, 'legacy'), ['announcements']);
});

test('weekly lesson slots keep separate recommendations with at most two cards', () => {
  const monday = { name: '编译原理', day: 1, periodStart: 1, periodEnd: 2, location: '一教 101' };
  const wednesday = { ...monday, day: 3, periodStart: 5, periodEnd: 6 };
  const mondayKey = lessonRecommendationKey('fall.ics', monday);
  const wednesdayKey = lessonRecommendationKey('fall.ics', wednesday);
  assert.notEqual(mondayKey, wednesdayKey);
  assert.equal(mondayKey, lessonRecommendationKey('fall.ics', { ...monday, date: '2026-11-02' }));
  const layout = reconcileCoursePageLayout({
    recommendedByTimetable: { course: ['announcements'] },
    recommendedByLesson: {
      [mondayKey]: ['tree', 'assignments', 'announcements'],
      [wednesdayKey]: ['assignments'],
    },
  });
  assert.deepEqual(recommendedForLesson(layout, mondayKey, 'course'), ['tree', 'assignments']);
  assert.deepEqual(recommendedForLesson(layout, wednesdayKey, 'course'), ['assignments']);
  assert.deepEqual(recommendedForLesson(layout, 'unconfigured', 'course'), ['announcements']);
});

test('the same course slot shares one recommendation across weeks and room changes', () => {
  const lesson = { name: '编译原理', day: 1, periodStart: 1, periodEnd: 2,
    location: '一教 101', teacher: '张老师', date: '2026-10-19' };
  const key = lessonRecommendationKey('fall.ics', lesson);
  assert.equal(key, lessonRecommendationKey('fall.ics', {
    ...lesson, location: '二教 202', teacher: '李老师', date: '2026-10-26',
  }));
  const legacyKey = JSON.stringify(['fall.ics', lesson.name, lesson.day,
    lesson.periodStart, lesson.periodEnd, lesson.location, lesson.teacher]);
  const layout = reconcileCoursePageLayout({
    recommendedByLesson: { [legacyKey]: [] },
    recommendedDisplayByLesson: { [legacyKey]: { tree: { reverse: true, count: 2 } } },
    recommendedTreeNodeDisplayByLesson: { [legacyKey]: { tree: { a: { reverse: true, limit: 1 } } } },
  });
  assert.deepEqual(recommendedForLesson(layout, key, 'course'), []);
  assert.deepEqual(lessonPreviewSettings(layout, key, 'tree'), { reverse: true, count: 2 });
  assert.deepEqual(lessonTreeNodeDisplaySettings(layout, key, 'tree', 'a'), { reverse: true, limit: 1 });
  assert.deepEqual(Object.keys(layout.recommendedByLesson), [key]);
});

test('each course section keeps its own display options after layout reload', () => {
  const saved = { display: {
    announcements: { reverse: true, limit: 2, hiddenItems: ['a', 'a', 3] },
    'custom:mine': { limit: 1, hiddenItems: ['child'] },
    removed: { reverse: true },
  }, customs: [{ id: 'custom:mine', title: 'Mine', source: makeRangeSource(roots, 0, 1) }] };
  const layout = reconcileCoursePageLayout(saved, roots);
  assert.deepEqual(sectionDisplaySettings(layout, 'announcements'),
    { reverse: true, limit: 2, hiddenItems: ['a', '3'] });
  assert.deepEqual(sectionDisplaySettings(layout, 'custom:mine'),
    { reverse: false, limit: 1, hiddenItems: ['child'] });
  assert.equal(Object.hasOwn(layout.display, 'removed'), false);
  assert.deepEqual(reconcileCoursePageLayout(layout, roots).display, layout.display);
});

test('display controls hide entries before reversing and limiting without changing source data', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const result = applySectionDisplay(items, { hiddenItems: ['b'], reverse: true, limit: 2 });
  assert.deepEqual(result.map((item) => item.id), ['d', 'c']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(applySectionDisplay(items, {}), items);
});

test('a hidden content-tree child stays hidden while its parent and siblings remain', () => {
  const tree = [{ id: 'root', children: [{ id: 'a', children: [{ id: 'deep' }] }, { id: 'b' }] }];
  const visible = filterSectionTree(tree, ['deep']);
  assert.deepEqual(visible[0].children.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(visible[0].children[0].children, []);
  assert.equal(tree[0].children[0].children[0].id, 'deep');
});

test('each lesson retains preview direction and count independently from course page display', () => {
  const layout = reconcileCoursePageLayout({ recommendedDisplayByLesson: {
    monday: { tree: { reverse: true, count: 2 }, removed: { count: 2 } },
    tuesday: { tree: { reverse: false, count: 1 } },
  } });
  assert.deepEqual(lessonPreviewSettings(layout, 'monday', 'tree'), { reverse: true, count: 2 });
  assert.deepEqual(lessonPreviewSettings(layout, 'tuesday', 'tree'), { reverse: false, count: 1 });
  assert.equal(Object.hasOwn(layout.recommendedDisplayByLesson.monday, 'removed'), false);
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(lessonPreviewItems(items,
    lessonPreviewSettings(layout, 'monday', 'tree')).map((item) => item.id), ['d', 'c']);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'c', 'd']);
});

test('each parent content-tree node persists its own child order and count', () => {
  const saved = { treeNodeDisplay: {
    materials: { reverse: true, limit: 2 },
    labs: { reverse: false, limit: 1 },
  } };
  const layout = reconcileCoursePageLayout(saved, roots);
  const children = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(displayTreeChildren(children, layout, 'materials').map((item) => item.id), ['c', 'b']);
  assert.deepEqual(displayTreeChildren(children, layout, 'labs').map((item) => item.id), ['a']);
  assert.deepEqual(displayTreeChildren(children, layout, 'unset').map((item) => item.id), ['a', 'b', 'c']);
  assert.deepEqual(treeNodeDisplaySettings(reconcileCoursePageLayout(layout, roots), 'materials'),
    { reverse: true, limit: 2 });
  assert.deepEqual(children.map((item) => item.id), ['a', 'b', 'c']);
});

test('recommended child display is scoped to its lesson and card, separately from course detail', () => {
  const layout = reconcileCoursePageLayout({
    treeNodeDisplay: { materials: { reverse: false, limit: 1 } },
    recommendedTreeNodeDisplayByLesson: {
      monday: { tree: { materials: { reverse: true, limit: 2 } }, assignments: { ignored: { limit: 1 } } },
      tuesday: { tree: { materials: { reverse: false, limit: 3 } } },
    },
  }, roots);
  assert.deepEqual(lessonTreeNodeDisplaySettings(layout, 'monday', 'tree', 'materials'),
    { reverse: true, limit: 2 });
  assert.deepEqual(lessonTreeNodeDisplaySettings(layout, 'tuesday', 'tree', 'materials'),
    { reverse: false, limit: 3 });
  assert.deepEqual(lessonTreeNodeDisplaySettings(layout, 'monday', 'assignments', 'materials'),
    { reverse: false, limit: null });
  assert.deepEqual(treeNodeDisplaySettings(layout, 'materials'), { reverse: false, limit: 1 });
  assert.deepEqual(reconcileCoursePageLayout(layout, roots).recommendedTreeNodeDisplayByLesson,
    layout.recommendedTreeNodeDisplayByLesson);
});
