import test from 'node:test';
import assert from 'node:assert/strict';
import { BlackboardAuthError, fetchBlackboardAssignmentDetail, fetchBlackboardAssignments, fetchBlackboardCourseAnnouncements, fetchBlackboardCourseMaterials } from '../src/core/blackboard.js';

const api = 'https://bb.sustech.edu.cn/learn/api/public/v1';

function json(url, data, status = 200) {
  return {
    url, status, ok: status >= 200 && status < 300,
    headers: { get: () => 'application/json' },
    json: async () => data,
  };
}

test('loads paginated enrollments and assignment due dates', async () => {
  const fetcher = async (url) => {
    if (url === `${api}/users/me`) return json(url, { id: '_1_1' });
    if (url.endsWith('/users/_1_1/courses?offset=1')) return json(url, { results: [{ courseId: '_20_1' }] });
    if (url.includes('/users/_1_1/courses?')) {
      return json(url, { results: [{ courseId: '_10_1' }], paging: { nextPage: `${api}/users/_1_1/courses?offset=1` } });
    }
    if (url.endsWith('/courses/_10_1')) return json(url, { name: '数据结构', termId: '_60_1' });
    if (url.endsWith('/courses/_20_1')) return json(url, { name: '大学物理', termId: '_60_1' });
    if (url.endsWith('/terms/_60_1')) return json(url, { availability: { duration: { start: '2026-09-01T00:00:00Z', end: '2027-01-31T23:59:59Z' } } });
    if (url.includes('/courses/_10_1/gradebook/columns/_3_1/attempts')) {
      return json(url, { results: [{ status: 'NeedsGrading' }] });
    }
    if (url.includes('/courses/_20_1/gradebook/columns/_5_1/attempts')) {
      return json(url, { results: [{ status: 'InProgress' }] });
    }
    if (url.includes('/courses/_10_1/gradebook/columns')) {
      return json(url, { results: [
        { id: '_3_1', name: '实验 3', grading: { type: 'Attempts', due: '2026-10-20T15:59:00.000Z' } },
        { id: '_4_1', name: '总评', grading: { type: 'Calculated', due: '2026-10-21T15:59:00.000Z' } },
      ] });
    }
    if (url.includes('/courses/_20_1/gradebook/columns')) {
      return json(url, { results: [
        { id: '_5_1', name: '习题', grading: { type: 'Attempts', due: '2026-10-19T15:59:00.000Z' } },
      ] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await fetchBlackboardAssignments(fetcher, Date.parse('2026-10-18T00:00:00Z'));
  assert.equal(result.failedCourses, 0);
  assert.deepEqual(result.assignments.map((item) => item.title), ['习题', '实验 3']);
  assert.equal(result.assignments[1].course, '数据结构');
  assert.deepEqual(result.assignments.map((item) => item.completed), [false, true]);
});

test('recognizes an expired Blackboard session', async () => {
  const fetcher = async (url) => json(url, {}, 401);
  await assert.rejects(fetchBlackboardAssignments(fetcher), BlackboardAuthError);
});

test('keeps successful courses when one course fails', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/users/me')) return json(url, { id: '_1_1' });
    if (url.includes('/users/_1_1/courses')) return json(url, { results: [{ courseId: '_10_1' }, { courseId: '_20_1' }] });
    if (url.endsWith('/courses/_10_1')) return json(url, { name: '数据结构', termId: '_60_1' });
    if (url.endsWith('/terms/_60_1')) return json(url, { availability: { duration: { start: '2026-09-01T00:00:00Z', end: '2027-01-31T23:59:59Z' } } });
    if (url.includes('/courses/_10_1/gradebook/columns')) {
      return json(url, { results: [{ id: '_3_1', name: '实验', grading: { type: 'Attempts', due: '2026-10-20T15:59:00.000Z' } }] });
    }
    if (url.includes('/courses/_20_1/gradebook/columns')) return json(url, {}, 500);
    return json(url, { name: '物理' });
  };
  const result = await fetchBlackboardAssignments(fetcher, Date.parse('2026-10-18T00:00:00Z'));
  assert.equal(result.failedCourses, 1);
  assert.equal(result.assignments.length, 1);
});

test('treats an expired session during one course as an expired overview', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/users/me')) return json(url, { id: '_1_1' });
    if (url.includes('/users/_1_1/courses')) return json(url, { results: [{ courseId: '_10_1' }, { courseId: '_20_1' }] });
    if (url.endsWith('/courses/_10_1')) return json(url, { name: '数据结构' });
    if (url.endsWith('/courses/_20_1')) return json(url, { name: '大学物理' });
    if (url.includes('/courses/_10_1/gradebook/columns')) return json(url, { results: [] });
    if (url.includes('/courses/_20_1/gradebook/columns')) return json(url, {}, 401);
    throw new Error(`Unexpected URL: ${url}`);
  };
  await assert.rejects(fetchBlackboardAssignments(fetcher), BlackboardAuthError);
});

test('lists only courses whose Blackboard term is current', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/users/me')) return json(url, { id: '_1_1' });
    if (url.includes('/users/_1_1/courses')) return json(url, { results: [{ courseId: '_10_1' }, { courseId: '_20_1' }] });
    if (url.endsWith('/courses/_10_1')) return json(url, { name: '数据结构', termId: '_60_1' });
    if (url.endsWith('/courses/_20_1')) return json(url, { name: '往年课程', termId: '_40_1' });
    if (url.includes('/gradebook/columns/') && url.endsWith('/attempts')) return json(url, { results: [] });
    if (url.includes('/courses/_10_1/gradebook/columns')) return json(url, { results: [
      { id: '_3_1', name: '本学期作业', grading: { type: 'Attempts', due: '2026-10-20T15:59:00.000Z' } },
    ] });
    if (url.includes('/courses/_20_1/gradebook/columns')) return json(url, { results: [
      { id: '_5_1', name: '往年作业', grading: { type: 'Attempts', due: '2026-10-20T15:59:00.000Z' } },
    ] });
    if (url.endsWith('/terms/_60_1')) return json(url, { name: '2026-2027 第一学期', availability: { duration: { start: '2026-09-01T00:00:00Z', end: '2027-01-31T23:59:59Z' } } });
    if (url.endsWith('/terms/_40_1')) return json(url, { name: '2025-2026 第一学期', availability: { duration: { start: '2025-09-01T00:00:00Z', end: '2026-01-31T23:59:59Z' } } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await fetchBlackboardAssignments(fetcher, Date.parse('2026-10-18T00:00:00Z'));
  assert.deepEqual(result.courses, [{ id: '_10_1', name: '数据结构' }]);
  assert.deepEqual(result.assignments.map((item) => item.title), ['本学期作业']);
});

test('loads assignment content and paginated file attachments', async () => {
  const fetcher = async (url) => {
    if (url === `${api}/courses/_10_1/contents/_30_1`) {
      return json(url, { title: '实验三', body: '<p>作业说明</p>' });
    }
    if (url.endsWith('/attachments?limit=100')) {
      return json(url, { results: [{ id: '_40_1', fileName: 'guide.pdf' }], paging: { nextPage: '?offset=1' } });
    }
    if (url.endsWith('/attachments?offset=1')) {
      return json(url, { results: [{ id: '_41_1', fileName: 'data.csv' }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  assert.deepEqual(await fetchBlackboardAssignmentDetail('_10_1', '_30_1', fetcher), {
    title: '实验三', body: '<p>作业说明</p>', fileName: '',
    attachments: [
      { name: 'guide.pdf', url: `${api}/courses/_10_1/contents/_30_1/attachments/_40_1/download` },
      { name: 'data.csv', url: `${api}/courses/_10_1/contents/_30_1/attachments/_41_1/download` },
    ],
    attachmentError: '',
  });
  await assert.rejects(fetchBlackboardAssignmentDetail('https://bad.example', '_30_1', fetcher), /ID 无效/);
});

test('keeps the assignment description when its attachment list fails', async () => {
  const fetcher = async (url) => url.endsWith('/attachments?limit=100')
    ? json(url, {}, 500)
    : json(url, { title: '实验三', body: '<p>作业说明</p>' });
  const result = await fetchBlackboardAssignmentDetail('_10_1', '_30_1', fetcher);
  assert.equal(result.body, '<p>作业说明</p>');
  assert.deepEqual(result.attachments, []);
  assert.match(result.attachmentError, /HTTP 500/);
});

test('loads visible course announcements across pages, newest first', async () => {
  const fetcher = async (url) => {
    if (url.endsWith('/announcements?limit=100')) {
      return json(url, { results: [
        { id: '_1_1', title: '较早公告', body: '<p>第一周安排</p>', created: '2026-09-01T00:00:00Z' },
        { id: '_2_1', title: '隐藏公告', availability: { available: 'No' } },
      ], paging: { nextPage: '?offset=2' } });
    }
    if (url.endsWith('/announcements?offset=2')) {
      return json(url, { results: [{ id: '_3_1', title: '最新公告', body: '<p>第二周安排</p>', created: '2026-09-08T00:00:00Z' }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  assert.deepEqual(await fetchBlackboardCourseAnnouncements('_10_1', fetcher), [
    { id: '_3_1', title: '最新公告', body: '<p>第二周安排</p>', date: '2026-09-08T00:00:00Z' },
    { id: '_1_1', title: '较早公告', body: '<p>第一周安排</p>', date: '2026-09-01T00:00:00Z' },
  ]);
  await assert.rejects(fetchBlackboardCourseAnnouncements('bad', fetcher), /课程 ID 无效/);
});

test('loads the complete visible course content tree and file attachments', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_1_1', title: 'Week 1', hasChildren: true, contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_2_1', title: 'Course guide', contentHandler: { id: 'resource/x-bb-document' } },
      { id: '_9_1', title: 'Hidden', availability: { available: 'No' } },
    ] });
    if (url === `${base}/_1_1/children?limit=100`) return json(url, { results: [
      { id: '_3_1', title: 'Lecture slides', contentHandler: { id: 'resource/x-bb-file' } },
    ] });
    if (url === `${base}/_2_1`) return json(url, { title: 'Course guide', body: '<p>Read first</p>' });
    if (url === `${base}/_3_1`) return json(url, { contentHandler: { file: { fileName: 'slides.pdf' } } });
    if (url === `${base}/_2_1/attachments?limit=100`) return json(url, { results: [] });
    if (url === `${base}/_3_1/attachments?limit=100`) return json(url, { results: [{ id: '_4_1', fileName: 'slides.pdf' }] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher);
  assert.deepEqual(roots.map(({ id, title }) => [id, title]), [['_1_1', 'Week 1'], ['_2_1', 'Course guide']]);
  assert.deepEqual(roots[0].children.map(({ id }) => id), ['_3_1']);
  assert.equal(roots[0].children[0].fileName, 'slides.pdf');
  assert.deepEqual(roots[0].children[0].attachments, [{
    name: 'slides.pdf', url: `${base}/_3_1/attachments/_4_1/download`,
  }]);
  assert.equal(roots[1].body, '<p>Read first</p>');
});

test('restores a missing parent unit above listed second-level content', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_11_1', parentId: '_10_1', title: 'Week 1', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_12_1', parentId: '_10_1', title: 'Guide', contentHandler: { id: 'resource/x-bb-document' } },
    ] });
    if (url === `${base}/_10_1`) return json(url, {
      id: '_10_1', title: '课程内容', contentHandler: { id: 'resource/x-bb-folder' },
    });
    if (url === `${base}/_12_1`) return json(url, { title: 'Guide' });
    if (url === `${base}/_12_1/attachments?limit=100`) return json(url, { results: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].title, '课程内容');
  assert.deepEqual(roots[0].children.map(({ title }) => title), ['Week 1', 'Guide']);
});

test('keeps readable content when its parent unit cannot be opened', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_12_1', parentId: '_10_1', title: 'Guide', contentHandler: { id: 'resource/x-bb-document' } },
    ] });
    if (url === `${base}/_10_1`) return json(url, {}, 403);
    if (url === `${base}/_12_1`) return json(url, { title: 'Guide' });
    if (url === `${base}/_12_1/attachments?limit=100`) return json(url, { results: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher);
  assert.deepEqual(roots.map(({ title }) => title), ['Guide']);
});

test('uses the course menu to restore Materials when content rows have no parentId', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_11_1', title: 'lecture_notes', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_12_1', title: 'lab_notes', contentHandler: { id: 'resource/x-bb-folder' } },
    ] });
    if (url === `${api}/courses/_10_1/tocItems`) return json(url, { results: [
      { id: '_99_1', label: 'materials', targetType: 'Content', contentId: '_10_1', isEnabled: true },
    ] });
    if (url === `${base}/_10_1/children?limit=100`) return json(url, { results: [
      { id: '_11_1', title: 'lecture_notes', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_12_1', title: 'lab_notes', contentHandler: { id: 'resource/x-bb-folder' } },
    ] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher);
  assert.deepEqual(roots.map(({ title }) => title), ['materials']);
  assert.deepEqual(roots[0].children.map(({ title }) => title), ['lecture_notes', 'lab_notes']);
});

test('groups course menu content under bold subheaders without content IDs', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_11_1', title: 'Lecture Notes', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_12_1', title: 'Lab Notes', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_13_1', title: 'Assignments', contentHandler: { id: 'resource/x-bb-folder' } },
    ] });
    if (url === `${api}/courses/_10_1/tocItems`) return json(url, { results: [
      { id: '_22_1', position: 2, targetType: 'Content', contentId: '_12_1', label: 'Lab Notes' },
      { id: '_20_1', position: 0, targetType: 'Subheader', contentId: null, label: 'Course Materials' },
      { id: '_21_1', position: 1, targetType: 'Content', contentId: '_11_1', label: 'Lecture Notes' },
      { id: '_23_1', position: 3, targetType: 'Divider', contentId: null },
      { id: '_24_1', position: 4, targetType: 'Subheader', contentId: null, label: 'Assignments & Projects' },
      { id: '_25_1', position: 5, targetType: 'Content', contentId: '_13_1', label: 'Assignments' },
    ] });
    if (url.endsWith('/children?limit=100')) return json(url, { results: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher);
  assert.deepEqual(roots.map(({ title }) => title), ['Course Materials', 'Assignments & Projects']);
  assert.deepEqual(roots[0].children.map(({ title }) => title), ['Lecture Notes', 'Lab Notes']);
  assert.deepEqual(roots[1].children.map(({ title }) => title), ['Assignments']);
});

test('uses a saved page menu when the student cannot read the TOC API', async () => {
  const base = `${api}/courses/_10_1/contents`;
  const savedMenu = [
    { id: 'palette:1', position: 0, targetType: 'Subheader', label: 'Course Materials' },
    { id: 'palette:2', position: 1, targetType: 'Content', contentId: '_11_1', label: 'Lecture Notes' },
    { id: 'palette:3', position: 2, targetType: 'Content', contentId: null, label: '--Lab Notes' },
  ];
  const fetcher = async (url) => {
    if (url === `${base}?limit=100`) return json(url, { results: [
      { id: '_11_1', title: 'Lecture Notes', contentHandler: { id: 'resource/x-bb-folder' } },
      { id: '_12_1', title: 'Lab Notes', contentHandler: { id: 'resource/x-bb-folder' } },
    ] });
    if (url === `${api}/courses/_10_1/tocItems`) return json(url, {}, 403);
    if (url.endsWith('/children?limit=100')) return json(url, { results: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const roots = await fetchBlackboardCourseMaterials('_10_1', fetcher, savedMenu);
  assert.deepEqual(roots.map(({ title }) => title), ['Course Materials']);
  assert.deepEqual(roots[0].children.map(({ title }) => title), ['Lecture Notes', 'Lab Notes']);
});
