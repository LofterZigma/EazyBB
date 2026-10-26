// Blackboard Learn REST endpoints already used by the Python BB module.
const BB_ORIGIN = 'https://bb.sustech.edu.cn';
const API = `${BB_ORIGIN}/learn/api/public/v1`;

export class BlackboardAuthError extends Error {}

async function getJson(url, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Blackboard 请求超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401 || response.url?.startsWith('https://cas.sustech.edu.cn/')) {
    throw new BlackboardAuthError('Blackboard 登录已失效');
  }
  if (!response.ok) throw new Error(`Blackboard 接口返回 HTTP ${response.status}`);
  const contentType = response.headers?.get?.('content-type') ?? 'application/json';
  if (!contentType.includes('json')) throw new BlackboardAuthError('Blackboard 需要重新登录');
  return response.json();
}

async function getPages(path, fetcher) {
  const results = [];
  let url = new URL(path, BB_ORIGIN).href;
  const visited = new Set();
  while (url && !visited.has(url) && visited.size < 30) {
    if (new URL(url).origin !== BB_ORIGIN) throw new Error('Blackboard 返回了无效的分页地址');
    visited.add(url);
    const page = await getJson(url, fetcher);
    results.push(...(page.results ?? []));
    url = page.paging?.nextPage ? new URL(page.paging.nextPage, url).href : '';
  }
  if (url) throw new Error('Blackboard 分页异常，作业数据未完整读取');
  return results;
}

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await task(items[index]);
    }
  }));
  return output;
}

function activeDateRange(duration, now) {
  const start = Date.parse(duration?.start ?? '');
  const end = Date.parse(duration?.end ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
}

function matchesSemesterName(name, now) {
  if (!name) return false;
  const date = new Date(now);
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const fall = month >= 8 || month === 1;
  const startYear = fall ? (month === 1 ? year - 1 : year) : year - 1;
  const academicYear = `${startYear}-${startYear + 1}`;
  const text = String(name).toLowerCase().replace(/\s+/g, '');
  const season = fall ? /(秋|fall|第?一学期|上学期|semester.?1|[-_]1$)/i : /(春|spring|第?二学期|下学期|semester.?2|[-_]2$)/i;
  return (text.includes(academicYear) || text.includes(String(fall ? startYear : year))) && season.test(text);
}

function isCurrentCourse(course, term, now) {
  if (term) {
    const duration = term.availability?.duration ?? term.duration;
    if (activeDateRange(duration, now)) return true;
    if (duration?.start && duration?.end) return false;
    return matchesSemesterName(`${term.name ?? ''} ${term.externalId ?? ''}`, now);
  }
  return activeDateRange(course.availability?.duration, now);
}

export async function fetchBlackboardAssignments(fetcher = fetch, now = Date.now()) {
  const me = await getJson(`${API}/users/me`, fetcher);
  if (!me.id) throw new Error('Blackboard 未返回用户 ID');
  const enrollments = await getPages(`${API}/users/${encodeURIComponent(me.id)}/courses?limit=100`, fetcher);
  const courseIds = [...new Set(enrollments.map((entry) => entry.courseId).filter(Boolean))];

  const courses = await mapLimit(courseIds, 5, async (courseId) => {
    const base = `${API}/courses/${encodeURIComponent(courseId)}`;
    try {
      const [details, columns] = await Promise.all([
        getJson(base, fetcher).catch((error) => {
          if (error instanceof BlackboardAuthError) throw error;
          return { name: courseId };
        }),
        getPages(`${base}/gradebook/columns?_fields=id,name,contentId,grading&limit=100`, fetcher),
      ]);
      const assignments = columns
        .filter((column) => column.grading?.type === 'Attempts' && column.name && column.grading.due)
        .map((column) => ({
          id: `${courseId}/${column.id}`,
          courseId,
          contentId: column.contentId || '',
          course: details.name || courseId,
          title: column.name,
          due: column.grading.due,
        }))
        .filter((item) => Number.isFinite(Date.parse(item.due)));
      await mapLimit(assignments, 5, async (item) => {
        try {
          const attempts = await getPages(`${base}/gradebook/columns/${encodeURIComponent(item.id.split('/')[1])}/attempts`, fetcher);
          item.completed = attempts.some((attempt) => !['InProgress', 'NotStarted', 'Draft'].includes(attempt.status));
        } catch (error) {
          if (error instanceof BlackboardAuthError) throw error;
          item.completed = null;
        }
      });
      return { ok: true, assignments, info: { id: courseId, name: details.name || courseId, termId: details.termId, availability: details.availability } };
    } catch (error) {
      return { ok: false, assignments: [], error };
    }
  });

  const authError = courses.find((course) => course.error instanceof BlackboardAuthError);
  if (authError) throw authError.error;
  const failedCourses = courses.filter((course) => !course.ok).length;
  if (courseIds.length && failedCourses === courseIds.length) {
    throw new Error('无法读取课程作业，请稍后重试');
  }
  const termIds = [...new Set(courses.map((course) => course.info?.termId).filter(Boolean))];
  const terms = await mapLimit(termIds, 5, async (termId) => {
    try { return await getJson(`${API}/terms/${encodeURIComponent(termId)}`, fetcher); }
    catch (error) {
      if (error instanceof BlackboardAuthError) throw error;
      return null;
    }
  });
  const termById = new Map(termIds.map((termId, index) => [termId, terms[index]]));
  const currentCourses = courses
    .filter((course) => course.info && isCurrentCourse(course.info, termById.get(course.info.termId), now))
    .map((course) => ({ id: course.info.id, name: course.info.name }));
  const currentCourseIds = new Set(currentCourses.map((course) => course.id));
  return {
    account: me.userName || me.id,
    assignments: courses
      .filter((course) => currentCourseIds.has(course.info?.id))
      .flatMap((course) => course.assignments)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due)),
    courses: currentCourses.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    failedCourses,
  };
}

export async function fetchBlackboardAssignmentDetail(courseId, contentId, fetcher = fetch) {
  if (!/^_\d+_\d+$/.test(courseId) || !/^_\d+_\d+$/.test(contentId)) {
    throw new Error('作业内容 ID 无效');
  }
  const contentUrl = `${API}/courses/${encodeURIComponent(courseId)}/contents/${encodeURIComponent(contentId)}`;
  const item = await getJson(contentUrl, fetcher);
  let attachments = [];
  let attachmentError = '';
  try {
    const files = await getPages(`${contentUrl}/attachments?limit=100`, fetcher);
    attachments = files
      .filter((file) => /^_\d+_\d+$/.test(file.id))
      .map((file) => ({
        name: file.fileName || file.name || '未命名附件',
        url: `${contentUrl}/attachments/${encodeURIComponent(file.id)}/download`,
      }));
  } catch (error) {
    if (error instanceof BlackboardAuthError) throw error;
    attachmentError = error.message;
  }
  return {
    title: item.title || '',
    body: item.body || '',
    fileName: item.contentHandler?.file?.fileName || '',
    attachments,
    attachmentError,
  };
}

export async function fetchBlackboardCourseAnnouncements(courseId, fetcher = fetch) {
  if (!/^_\d+_\d+$/.test(courseId)) throw new Error('课程 ID 无效');
  const items = await getPages(`${API}/courses/${encodeURIComponent(courseId)}/announcements?limit=100`, fetcher);
  return items
    .filter((item) => item.availability?.available !== 'No')
    .map((item) => ({
      id: item.id,
      title: item.title || '无标题公告',
      body: item.body || '',
      date: item.created || item.modified || '',
    }))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export async function fetchBlackboardCourseMaterials(courseId, fetcher = fetch, savedMenu = []) {
  if (!/^_\d+_\d+$/.test(courseId)) throw new Error('课程 ID 无效');
  const base = `${API}/courses/${encodeURIComponent(courseId)}/contents`;
  const visited = new Set();
  const known = new Map();
  const leafNodes = [];
  async function loadBranch(parentId = '', reuseExisting = false) {
    const path = parentId ? `${base}/${encodeURIComponent(parentId)}/children?limit=100` : `${base}?limit=100`;
    const items = await getPages(path, fetcher);
    const nodes = [];
    for (const item of items) {
      if (!/^_\d+_\d+$/.test(item.id) || item.availability?.available === 'No') continue;
      if (visited.has(item.id)) {
        if (reuseExisting && known.has(item.id)) nodes.push(known.get(item.id));
        continue;
      }
      visited.add(item.id);
      if (visited.size > 500) throw new Error('课程内容过多，已停止读取');
      const handler = item.contentHandler?.id || '';
      const node = {
        id: item.id,
        parentId: item.parentId || parentId || '',
        title: item.title || '未命名内容',
        handler,
        body: item.body || '',
        fileName: item.contentHandler?.file?.fileName || '',
        attachments: [],
        children: [],
      };
      known.set(item.id, node);
      nodes.push(node);
      if (item.hasChildren) node.children = await loadBranch(item.id, reuseExisting);
      if (handler !== 'resource/x-bb-folder') leafNodes.push(node);
    }
    return nodes;
  }
  const listedRoots = await loadBranch();
  // The course menu names content areas such as Materials. /contents may only
  // list their children, and those rows need not include parentId.
  let tocItems = [];
  try { tocItems = await getPages(`${API}/courses/${encodeURIComponent(courseId)}/tocItems`, fetcher); }
  catch { /* Ultra courses and some student accounts cannot read the TOC. */ }
  if ((!tocItems.length || !tocItems.some((entry) => String(entry.targetType).toLowerCase() === 'subheader'))
    && savedMenu.some((entry) => String(entry.targetType).toLowerCase() === 'subheader')) {
    tocItems = savedMenu;
  }
  const tocRoots = [];
  let currentGroup = null;
  // A bold course-menu heading is a Subheader, not a content folder. It has
  // no contentId; the following menu entries belong to it until the next
  // subheader or divider.
  for (const entry of [...tocItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    if (entry.isEnabled === false) continue;
    const type = String(entry.targetType || '').toLowerCase();
    if (type === 'divider') {
      currentGroup = null;
      continue;
    }
    if (type === 'subheader') {
      currentGroup = {
        id: `toc:${entry.id}`, parentId: '', title: entry.label || '未命名目录',
        handler: 'menu/subheader', body: '', fileName: '', attachments: [], children: [],
      };
      tocRoots.push(currentGroup);
      continue;
    }
    if (type !== 'content') continue;
    let id = entry.contentId;
    if (!/^_\d+_\d+$/.test(id)) {
      const name = String(entry.label || '').replace(/^[-–—\s]+/, '').trim().toLowerCase();
      const matching = listedRoots.filter((node) => node.title.replace(/^[-–—\s]+/, '').trim().toLowerCase() === name);
      if (matching.length !== 1) continue;
      id = matching[0].id;
    }
    let node = known.get(id);
    if (!node) {
      node = {
        id, parentId: '', title: entry.label || '未命名目录',
        handler: 'resource/x-bb-folder', body: '', fileName: '', attachments: [], children: [],
      };
      known.set(id, node);
    } else if (entry.label && !/^\s*[-–—]+/.test(entry.label)) node.title = entry.label;
    if (!node.children.length) {
      try { node.children = await loadBranch(id, true); }
      catch { /* Keep the menu unit even if its children cannot be requested. */ }
    }
    for (const child of listedRoots) {
      if (child.parentId === id && !node.children.some((item) => item.id === child.id)) node.children.push(child);
    }
    const siblings = currentGroup?.children || tocRoots;
    if (!siblings.some((item) => item.id === id)) siblings.push(node);
  }
  const covered = new Set();
  function markCovered(nodes) {
    for (const node of nodes) {
      if (covered.has(node.id)) continue;
      covered.add(node.id);
      markCovered(node.children);
    }
  }
  markCovered(tocRoots);
  const remainingRoots = listedRoots.filter((node) => !covered.has(node.id));
  // Restore parents that are missing from both the contents list and the TOC.
  const attemptedParents = new Set();
  const extraParents = [];
  let frontier = remainingRoots;
  for (let depth = 0; depth < 10; depth += 1) {
    const missing = [...new Set(frontier.map((node) => node.parentId))]
      .filter((id) => /^_\d+_\d+$/.test(id) && !known.has(id) && !attemptedParents.has(id));
    if (!missing.length) break;
    const fetched = [];
    for (const id of missing) {
      attemptedParents.add(id);
      let parent;
      try { parent = await getJson(`${base}/${encodeURIComponent(id)}`, fetcher); }
      catch { continue; } // An inaccessible parent must not hide readable children.
      if (parent?.id !== id || !parent.title) continue;
      const node = {
        id,
        parentId: parent.parentId || '',
        title: parent.title,
        handler: parent.contentHandler?.id || '',
        body: parent.body || '',
        fileName: parent.contentHandler?.file?.fileName || '',
        attachments: [],
        children: [],
      };
      known.set(id, node);
      extraParents.push(node);
      fetched.push(node);
      if (node.handler !== 'resource/x-bb-folder') leafNodes.push(node);
    }
    frontier = fetched;
  }
  const candidates = [...remainingRoots, ...extraParents];
  const candidateById = new Map(candidates.map((node) => [node.id, node]));
  const attached = new Set();
  for (const node of candidates) {
    const parent = candidateById.get(node.parentId);
    if (!parent || parent === node) continue;
    if (!parent.children.some((child) => child.id === node.id)) parent.children.push(node);
    attached.add(node.id);
  }
  const roots = [...tocRoots, ...candidates.filter((node) => !attached.has(node.id))];
  await mapLimit(leafNodes, 5, async (node) => {
    const itemUrl = `${base}/${encodeURIComponent(node.id)}`;
    try {
      const detail = await getJson(itemUrl, fetcher);
      node.body = detail.body || node.body;
      node.fileName = detail.contentHandler?.file?.fileName || node.fileName;
    } catch (error) {
      if (error instanceof BlackboardAuthError) throw error;
    }
    try {
      const files = await getPages(`${itemUrl}/attachments?limit=100`, fetcher);
      node.attachments = files
        .filter((file) => /^_\d+_\d+$/.test(file.id))
        .map((file) => ({
          name: file.fileName || file.name || '未命名附件',
          url: `${itemUrl}/attachments/${encodeURIComponent(file.id)}/download`,
        }));
    } catch (error) {
      if (error instanceof BlackboardAuthError) throw error;
    }
  });
  return roots;
}
