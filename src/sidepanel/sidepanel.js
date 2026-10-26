import { reconcileCoursePageLayout, syncSplitItems, selectCustomRoots } from '../core/course-page-layout.js';

import { rangeBounds, makeRangeSource, visibleCoursePageOrder, visibleSplitOrder,
  reorderVisibleCoursePageItems, reorderVisibleSplitItems,
  lessonRecommendationKey, recommendedForLesson, lessonPreviewSettings, lessonPreviewItems,
  sectionDisplaySettings, treeNodeDisplaySettings, displayTreeChildren,
  lessonTreeNodeDisplaySettings,
  applySectionDisplay, filterSectionTree } from '../core/course-page-layout.js';
import { DEFAULT_ASSIGNMENT_PREFERENCES, normalizeAssignmentPreferences,
  homeAssignments, allAssignments } from '../core/assignment-preferences.js';
import { normalizeCompletionOverrides, resolveAssignmentCompletion } from '../core/assignment-completion.js';
import { DEFAULT_EXAM_PREFERENCES, normalizeExamPreferences, filterExamsByRange, sortExams,
  combineExamSources, removeStoredManualExam, groupExamsByDate, formatExamDate, formatExamTime,
  getPeriodName, formDataToExam, validateExamForm, isManualExam } from '../core/exam.js';
import { addDays, diffDays, weekdayOf } from '../core/calendar.js';
import { retimeIcal } from '../core/ical.js';
import { chooseNavigationItem } from '../core/navigation.js';
import { DEFAULT_CLASS_TIMES, MAX_CLASS_PERIODS, normalizeClassTimes, prepareClassTimeChange,
  lessonTimeRange, lessonGroups, courseGroups,
  makeEditableTimetable, importIcsLessons, lessonsToIcal, remapSourceLessons } from '../core/timetable-editor.js';
import { courseAssociationKey, resolveBlackboardCourse } from '../core/course-match.js';
import { openBlackboardFile } from '../core/blackboard-file.js';

const chinaFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function chinaParts(date) {
  return Object.fromEntries(chinaFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function chinaDayKey(date) {
  const parts = chinaParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const todayParts = chinaParts(new Date());
const today = new Date(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day));

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

let assignments = [];
let assignmentPreferences = { ...DEFAULT_ASSIGNMENT_PREFERENCES };
let favoriteAssignments = new Set();
let favoriteWrite = Promise.resolve();
let completionOverrides = {};
let completionWrite = Promise.resolve();
let courses = [];
let exams = [];
let tisExams = [];
let manualExams = [];
let examPreferences = { ...DEFAULT_EXAM_PREFERENCES };
let examsLoading = false;
let examsReady = Promise.resolve();
let timetable = null;
let timetableLoading = false;
let classTimes = normalizeClassTimes();
let tisPeriodMap = Object.fromEntries(Object.keys(DEFAULT_CLASS_TIMES).map((period) => [period, Number(period)]));
let timetableChangeVersion = 0;
let timetableWrite = Promise.resolve();
let overviewLoaded = false;
let overviewRequestId = 0;
let cacheWrite = Promise.resolve();

let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today);

const monthLabel = document.getElementById('month-label');
const todayLabel = document.getElementById('today-label');
const calendarGrid = document.getElementById('calendar-grid');
const assignmentList = document.getElementById('assignment-list');
const allAssignmentList = document.getElementById('all-assignments-list');
const courseList = document.getElementById('course-list');
const examsList = document.getElementById('exams-list');
const examsStatus = document.getElementById('exams-status');
const examsCountBadge = document.getElementById('exams-count');
const refreshExamsButton = document.getElementById('refresh-exams');
const addExamButton = document.getElementById('add-exam');
const addExamView = document.getElementById('add-exam-view');
const addExamForm = document.getElementById('add-exam-form');
const closeAddExamButton = document.getElementById('close-add-exam');
const cancelAddExamButton = document.getElementById('cancel-add-exam');
const addExamFeedback = document.getElementById('add-exam-feedback');
const timetableDays = document.getElementById('timetable-days');
const timetableList = document.getElementById('timetable-list');
const timetableStatus = document.getElementById('timetable-status');
const refreshTimetableButton = document.getElementById('refresh-timetable');
const exportTimetableButton = document.getElementById('export-timetable');
let selectedTimetableDay = (today.getDay() + 6) % 7 + 1;
const currentTimetableWeekStart = addDays(dateKey(today), -weekdayOf(dateKey(today)));
let selectedTimetableWeekStart = currentTimetableWeekStart;
const overviewStatus = document.getElementById('overview-status');
const overviewStatusDot = document.getElementById('overview-status-dot');
const refreshResultToggle = document.getElementById('refresh-result-toggle');
const refreshButton = document.getElementById('refresh-overview');
let showRefreshStatusCard = true;
let overviewStatusState = 'loading';

function syncOverviewStatusPresentation() {
  overviewStatus.hidden = !showRefreshStatusCard;
  overviewStatusDot.hidden = showRefreshStatusCard;
  overviewStatusDot.dataset.state = overviewStatusState;
  overviewStatusDot.title = overviewStatus.textContent;
  overviewStatusDot.setAttribute('aria-label', `数据刷新状态：${overviewStatus.textContent}`);
}

function setOverviewStatus(message, state = 'loading') {
  overviewStatus.textContent = message;
  overviewStatusState = state;
  overviewStatus.classList.toggle('error', state === 'error');
  syncOverviewStatusPresentation();
}

const homeView = document.getElementById('home-view');
const assignmentView = document.getElementById('assignment-view');
const allAssignmentsView = document.getElementById('all-assignments-view');
const courseView = document.getElementById('course-view');
const courseSettingsView = document.getElementById('course-settings-view');
const courseRecommendationsView = document.getElementById('course-recommendations-view');
const courseTimetableLinkView = document.getElementById('course-timetable-link-view');
const courseAssociationView = document.getElementById('course-association-view');
const courseLayoutView = document.getElementById('course-layout-view');
const courseItemView = document.getElementById('course-item-view');
const settingsView = document.getElementById('settings-view');
const openSettingsButton = document.getElementById('open-settings');
const backHomeButton = document.getElementById('back-home');
const views = [homeView, allAssignmentsView, assignmentView, courseView, courseAssociationView,
  courseSettingsView, courseRecommendationsView, courseTimetableLinkView, courseLayoutView, courseItemView,
  settingsView, document.getElementById('refresh-view'), document.getElementById('appearance-view'),
  document.getElementById('animation-view'),
  document.getElementById('layout-view'), document.getElementById('homework-settings-view'),
  document.getElementById('timetable-settings-view'),
  document.getElementById('exams-settings-view')];
let lastSettingsItem = null;
let lastAssignmentCard = null;
let assignmentReturnView = homeView;
let lastCourseCard = null;
let lastAssociationLink = null;
let lastAssociationCard = null;
let courseAssociations = {};
const courseAssociationsReady = chrome.storage.local.get('eazybb_course_associations').then((saved) => {
  if (saved.eazybb_course_associations && typeof saved.eazybb_course_associations === 'object'
    && !Array.isArray(saved.eazybb_course_associations)) {
    courseAssociations = saved.eazybb_course_associations;
  }
}).catch(() => {});
let selectedCourse = null;
let courseRequestId = 0;
let courseTreeRoots = [];
let courseAnnouncements = [];
let coursePageLayout = null;
let coursePageWrite = Promise.resolve();
let editingCourseItem = null;
let courseItemReturnId = null;
let draggedCourseLayout = null;
let draggedRangeBoundary = null;
let detailRequestId = 0;
let navigationRenderId = 0;

async function readDataCache(key, isValid) {
  try {
    const cache = (await chrome.storage.local.get(key))[key];
    return isValid(cache?.data) ? cache.data : null;
  } catch {
    return null;
  }
}

function saveDataCache(key, data) {
  return chrome.storage.local.set({ [key]: { savedAt: Date.now(), data } });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const PAGE_EXIT_STEP_MS = 120;
const PAGE_ENTER_STAGGER_MS = 55;
const PAGE_ENTER_DURATION_MS = 230;
let animationEnabled = true;
let animationSpeed = 1;
let activeViewExit = null;
let activeViewEntrance = null;
let activeContentSwap = null;
const animationsAllowed = () => animationEnabled && !reducedMotion.matches;
const animationMs = (milliseconds) => milliseconds / animationSpeed;

function finishViewExit() {
  if (!activeViewExit) return;
  clearTimeout(activeViewExit.timer);
  activeViewExit.source.inert = false;
  for (const item of activeViewExit.items) {
    item.classList.remove('page-transition-out');
    item.style.removeProperty('--page-transition-delay');
    item.style.removeProperty('--page-transition-duration');
  }
  activeViewExit = null;
}

function finishViewEntrance() {
  if (!activeViewEntrance) return;
  clearTimeout(activeViewEntrance.timer);
  for (const item of activeViewEntrance.items) {
    item.classList.remove('page-transition-in');
    item.style.removeProperty('--page-transition-delay');
    item.style.removeProperty('--page-transition-duration');
  }
  activeViewEntrance = null;
}

function finishContentSwap() {
  if (!activeContentSwap) return;
  clearTimeout(activeContentSwap.timer);
  activeContentSwap.owner.inert = false;
  for (const item of activeContentSwap.items) {
    item.classList.remove('page-transition-out', 'page-transition-in');
    item.style.removeProperty('--page-transition-delay');
    item.style.removeProperty('--page-transition-duration');
  }
  activeContentSwap = null;
}

function visibleViewItems(view) {
  return [...view.children].flatMap((item) => item.id === 'home-layout' ? [...item.children] : [item])
    .filter((item) => {
      if (item.hidden) return false;
      const bounds = item.getBoundingClientRect();
      return bounds.height > 0 && bounds.bottom > 0 && bounds.top < window.innerHeight;
    })
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
}

function swapViewContent(container, update, focusTarget) {
  finishContentSwap();
  finishViewEntrance();
  if (!animationsAllowed()) {
    update();
    window.scrollTo(0, 0);
    focusTarget?.focus();
    return;
  }
  const owner = container.closest('.view');
  const outgoing = visibleViewItems(container);
  const showIncoming = () => {
    finishContentSwap();
    update();
    window.scrollTo(0, 0);
    focusTarget?.focus();
    const incoming = visibleViewItems(container);
    if (!incoming.length) return;
    incoming.forEach((item, index) => {
      item.style.setProperty('--page-transition-delay', `${animationMs(index * PAGE_ENTER_STAGGER_MS)}ms`);
      item.style.setProperty('--page-transition-duration', `${animationMs(PAGE_ENTER_DURATION_MS)}ms`);
      item.classList.add('page-transition-in');
    });
    const timer = setTimeout(finishContentSwap,
      animationMs((incoming.length - 1) * PAGE_ENTER_STAGGER_MS + PAGE_ENTER_DURATION_MS) + 24);
    activeContentSwap = { owner, items: incoming, timer };
  };
  if (!outgoing.length) {
    showIncoming();
    return;
  }
  owner.inert = true;
  const lastIndex = outgoing.length - 1;
  outgoing.forEach((item, index) => {
    item.style.setProperty('--page-transition-delay', `${animationMs((lastIndex - index) * PAGE_EXIT_STEP_MS)}ms`);
    item.style.setProperty('--page-transition-duration', `${animationMs(PAGE_EXIT_STEP_MS)}ms`);
    item.classList.add('page-transition-out');
  });
  const timer = setTimeout(showIncoming, animationMs(outgoing.length * PAGE_EXIT_STEP_MS) + 24);
  activeContentSwap = { owner, items: outgoing, timer };
}

function startViewEntrance(view) {
  const items = visibleViewItems(view);
  if (!items.length) return;
  items.forEach((item, index) => {
    item.style.setProperty('--page-transition-delay', `${animationMs(index * PAGE_ENTER_STAGGER_MS)}ms`);
    item.style.setProperty('--page-transition-duration', `${animationMs(PAGE_ENTER_DURATION_MS)}ms`);
    item.classList.add('page-transition-in');
  });
  const timer = setTimeout(finishViewEntrance,
    animationMs((items.length - 1) * PAGE_ENTER_STAGGER_MS + PAGE_ENTER_DURATION_MS) + 24);
  activeViewEntrance = { items, timer };
}

function revealView(view, focusTarget, animateEntrance = false) {
  for (const item of views) item.hidden = item !== view;
  window.scrollTo(0, 0);
  focusTarget?.focus();
  if (animateEntrance && animationsAllowed()) startViewEntrance(view);
}

function showView(view, focusTarget) {
  finishContentSwap();
  finishViewExit();
  finishViewEntrance();
  const source = views.find((item) => !item.hidden);
  if (!source || source === view || !animationsAllowed()) {
    revealView(view, focusTarget);
    return;
  }
  const items = visibleViewItems(source);
  if (!items.length) {
    revealView(view, focusTarget, true);
    return;
  }
  const lastIndex = items.length - 1;
  items.forEach((item, index) => {
    item.style.setProperty('--page-transition-delay', `${animationMs((lastIndex - index) * PAGE_EXIT_STEP_MS)}ms`);
    item.style.setProperty('--page-transition-duration', `${animationMs(PAGE_EXIT_STEP_MS)}ms`);
    item.classList.add('page-transition-out');
  });
  source.inert = true;
  const timer = setTimeout(() => {
    finishViewExit();
    revealView(view, focusTarget, true);
  }, animationMs(items.length * PAGE_EXIT_STEP_MS) + 24);
  activeViewExit = { source, items, timer };
}

openSettingsButton.addEventListener('click', () => showView(settingsView, backHomeButton));
backHomeButton.addEventListener('click', () => showView(homeView, openSettingsButton));
document.getElementById('back-assignment').addEventListener('click', () => showView(assignmentReturnView, lastAssignmentCard));
document.getElementById('back-all-assignments').addEventListener('click', () => showView(homeView, document.getElementById('view-all-assignments')));
document.getElementById('view-all-assignments').addEventListener('click', () => {
  renderAllAssignments();
  showView(allAssignmentsView, document.getElementById('back-all-assignments'));
});
document.getElementById('back-course').addEventListener('click', () => showView(homeView,
  lastCourseCard?.isConnected ? lastCourseCard : document.querySelector('#navigation-content button')));
document.getElementById('back-course-association').addEventListener('click', () => {
  showView(homeView, lastAssociationLink?.isConnected ? lastAssociationLink : lastAssociationCard);
});
document.querySelectorAll('[data-open-view]').forEach((button) => {
  button.addEventListener('click', () => {
    lastSettingsItem = button;
    if (button.dataset.openView === 'homework-settings-view') renderHomeworkSettings();
    if (button.dataset.openView === 'timetable-settings-view') renderTimetableSettings();
    showView(document.getElementById(button.dataset.openView), document.querySelector(`#${button.dataset.openView} .back-settings`));
  });
});
document.querySelectorAll('.back-settings').forEach((button) => {
  button.addEventListener('click', () => showView(settingsView, lastSettingsItem));
});

document.getElementById('extension-version').textContent = `v${chrome.runtime.getManifest().version}`;

const REFRESH_OPTIONS = [
  { minutes: 1, label: '1 分钟' }, { minutes: 2, label: '2 分钟' },
  { minutes: 5, label: '5 分钟' }, { minutes: 10, label: '10 分钟' },
  { minutes: 30, label: '30 分钟' }, { minutes: 60, label: '1 小时' },
  { minutes: 120, label: '2 小时' }, { minutes: 720, label: '12 小时' },
  { minutes: 1440, label: '24 小时' },
];
const refreshSlider = document.getElementById('refresh-slider');
const refreshScale = document.getElementById('refresh-scale');
const refreshTicks = [...refreshScale.children];
const ANIMATION_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const animationToggle = document.getElementById('animation-toggle');
const animationSpeedSlider = document.getElementById('animation-speed-slider');
const animationSpeedScale = document.getElementById('animation-speed-scale');
const animationSpeedTicks = [...animationSpeedScale.children];
const animationFeedback = document.getElementById('animation-feedback');
const themeChoices = [...document.querySelectorAll('[data-theme-option]')];
const layoutList = document.getElementById('layout-list');
const homeLayout = document.getElementById('home-layout');
let refreshTimer = null;

function updateRefreshSummary() {
  const interval = REFRESH_OPTIONS[Number(refreshSlider.value)]?.label ?? REFRESH_OPTIONS[2].label;
  document.getElementById('refresh-summary').textContent = `${interval} · ${showRefreshStatusCard ? '卡片' : '状态点'}`;
}

function setShowRefreshStatusCard(value) {
  showRefreshStatusCard = value !== false;
  refreshResultToggle.setAttribute('aria-checked', String(showRefreshStatusCard));
  updateRefreshSummary();
  syncOverviewStatusPresentation();
}

function setRefreshMinutes(minutes) {
  const index = REFRESH_OPTIONS.findIndex((option) => option.minutes === minutes);
  const selected = REFRESH_OPTIONS[index < 0 ? 2 : index];
  refreshSlider.value = String(index < 0 ? 2 : index);
  refreshSlider.setAttribute('aria-valuetext', selected.label);
  document.getElementById('refresh-value').textContent = selected.label;
  updateRefreshSummary();
  refreshScale.style.setProperty('--refresh-progress', `${Number(refreshSlider.value) / (REFRESH_OPTIONS.length - 1) * 100}%`);
  refreshTicks.forEach((tick, tickIndex) => tick.classList.toggle('active', tickIndex <= Number(refreshSlider.value)));
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!refreshButton.disabled) refreshHomeData();
  }, selected.minutes * 60_000);
}

refreshSlider.addEventListener('input', () => {
  setRefreshMinutes(REFRESH_OPTIONS[Number(refreshSlider.value)].minutes);
  document.getElementById('refresh-feedback').textContent = '';
});
refreshSlider.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ eazybb_refresh_minutes: REFRESH_OPTIONS[Number(refreshSlider.value)].minutes });
  } catch {
    document.getElementById('refresh-feedback').textContent = '保存刷新频率失败';
  }
});

refreshResultToggle.addEventListener('click', async () => {
  const nextValue = !showRefreshStatusCard;
  setShowRefreshStatusCard(nextValue);
  document.getElementById('refresh-feedback').textContent = '';
  try {
    await chrome.storage.local.set({ eazybb_show_refresh_status_card: nextValue });
  } catch {
    document.getElementById('refresh-feedback').textContent = '保存刷新结果显示设置失败';
  }
});

function updateAnimationSummary() {
  document.getElementById('animation-summary').textContent = animationEnabled
    ? `开启 · ${animationSpeed}×` : '关闭';
}

function setAnimationSpeed(speed) {
  const index = ANIMATION_SPEEDS.indexOf(Number(speed));
  const selectedIndex = index < 0 ? 2 : index;
  animationSpeed = ANIMATION_SPEEDS[selectedIndex];
  animationSpeedSlider.value = String(selectedIndex);
  animationSpeedSlider.setAttribute('aria-valuetext', `${animationSpeed} 倍速`);
  document.getElementById('animation-speed-value').textContent = `${animationSpeed}×`;
  animationSpeedScale.style.setProperty('--refresh-progress', `${selectedIndex / (ANIMATION_SPEEDS.length - 1) * 100}%`);
  animationSpeedTicks.forEach((tick, tickIndex) => tick.classList.toggle('active', tickIndex <= selectedIndex));
  updateAnimationSummary();
}

function setAnimationEnabled(enabled) {
  animationEnabled = enabled !== false;
  animationToggle.setAttribute('aria-checked', String(animationEnabled));
  animationSpeedSlider.disabled = !animationEnabled;
  document.getElementById('animation-speed-settings').classList.toggle('is-disabled', !animationEnabled);
  if (!animationEnabled) {
    finishViewEntrance();
    finishContentSwap();
    activeThemeTransition?.skipTransition();
  }
  updateAnimationSummary();
}

animationToggle.addEventListener('click', async () => {
  const nextValue = !animationEnabled;
  setAnimationEnabled(nextValue);
  animationFeedback.textContent = '';
  try {
    await chrome.storage.local.set({ eazybb_animation_enabled: nextValue });
  } catch {
    animationFeedback.textContent = '保存动画开关失败';
  }
});

animationSpeedSlider.addEventListener('input', () => {
  setAnimationSpeed(ANIMATION_SPEEDS[Number(animationSpeedSlider.value)]);
  animationFeedback.textContent = '';
});
animationSpeedSlider.addEventListener('change', async () => {
  try {
    await chrome.storage.local.set({ eazybb_animation_speed: animationSpeed });
  } catch {
    animationFeedback.textContent = '保存动画速度失败';
  }
});

function setTheme(theme) {
  const selected = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = selected;
  document.getElementById('appearance-summary').textContent = selected === 'dark' ? '夜晚' : '白天';
  themeChoices.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeOption === selected)));
}

let activeThemeTransition = null;

function transitionTheme(theme, clickEvent) {
  if (document.documentElement.dataset.theme === theme) return;
  if (!animationsAllowed() || !document.startViewTransition) {
    setTheme(theme);
    return;
  }
  activeThemeTransition?.skipTransition();
  const bounds = clickEvent.currentTarget.getBoundingClientRect();
  const x = clickEvent.detail ? clickEvent.clientX : bounds.left + bounds.width / 2;
  const y = clickEvent.detail ? clickEvent.clientY : bounds.top + bounds.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  let transition;
  try {
    transition = document.startViewTransition(() => setTheme(theme));
  } catch {
    setTheme(theme);
    return;
  }
  activeThemeTransition = transition;
  transition.ready.then(() => {
    const animation = document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: animationMs(520), easing: 'cubic-bezier(.2, .7, .2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
    return animation.finished;
  }).catch(() => {}).finally(() => {
    if (activeThemeTransition === transition) activeThemeTransition = null;
  });
}

themeChoices.forEach((button) => button.addEventListener('click', async (event) => {
  transitionTheme(button.dataset.themeOption, event);
  document.getElementById('appearance-feedback').textContent = '';
  try {
    await chrome.storage.local.set({ eazybb_theme: button.dataset.themeOption });
  } catch {
    document.getElementById('appearance-feedback').textContent = '保存外观设置失败';
  }
}));

function normalizeLayout(order) {
  const units = ['navigation', 'calendar', 'timetable', 'homework', 'courses', 'exams'];
  if (!Array.isArray(order) || new Set(order).size !== order.length || order.some((unit) => !units.includes(unit))) return units;
  return order.includes('navigation') ? [...order, ...units.filter((unit) => !order.includes(unit))]
    : ['navigation', ...order, ...units.filter((unit) => unit !== 'navigation' && !order.includes(unit))];
}

function applyLayout(order) {
  const normalized = normalizeLayout(order);
  const labels = { navigation: '导航', calendar: '日历', timetable: '课程表', homework: '作业', courses: '课程', exams: '考试' };
  for (const unit of normalized) {
    layoutList.append(layoutList.querySelector(`[data-unit="${unit}"]`));
    homeLayout.append(homeLayout.querySelector(`[data-unit="${unit}"]`));
  }
  document.getElementById('layout-summary').textContent = normalized.map((unit) => labels[unit]).join(' · ');
}

async function saveLayout() {
  const order = [...layoutList.children].map((card) => card.dataset.unit);
  applyLayout(order);
  const feedback = document.getElementById('layout-feedback');
  feedback.textContent = '';
  try {
    await chrome.storage.local.set({ eazybb_layout: order });
  } catch {
    feedback.textContent = '保存布局失败';
  }
}

let draggedCard = null;
layoutList.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.layout-card');
  if (!card) return;
  draggedCard = card;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.unit);
  requestAnimationFrame(() => card.classList.add('dragging'));
});
layoutList.addEventListener('dragover', (event) => {
  const target = event.target.closest('.layout-card');
  if (!draggedCard || !target || target === draggedCard) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  layoutList.querySelectorAll('.layout-card').forEach((card) => card.classList.toggle('drag-over', card === target));
});
layoutList.addEventListener('drop', (event) => {
  const target = event.target.closest('.layout-card');
  if (!draggedCard || !target || target === draggedCard) return;
  event.preventDefault();
  const cards = [...layoutList.children];
  if (cards.indexOf(draggedCard) < cards.indexOf(target)) target.after(draggedCard);
  else target.before(draggedCard);
  saveLayout();
});
layoutList.addEventListener('dragend', () => {
  layoutList.querySelectorAll('.layout-card').forEach((card) => card.classList.remove('dragging', 'drag-over'));
  draggedCard = null;
});
layoutList.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const card = event.target.closest('.layout-card');
  if (!card) return;
  const sibling = event.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
  if (!sibling) return;
  event.preventDefault();
  if (event.key === 'ArrowUp') sibling.before(card);
  else sibling.after(card);
  card.focus();
  saveLayout();
});

setRefreshMinutes(5);
setShowRefreshStatusCard(true);
setAnimationSpeed(1);
setAnimationEnabled(true);
chrome.storage.local.get(['eazybb_refresh_minutes', 'eazybb_show_refresh_status_card',
  'eazybb_animation_enabled', 'eazybb_animation_speed', 'eazybb_theme', 'eazybb_layout']).then((saved) => {
  setRefreshMinutes(saved.eazybb_refresh_minutes);
  setShowRefreshStatusCard(saved.eazybb_show_refresh_status_card);
  setAnimationSpeed(saved.eazybb_animation_speed);
  setAnimationEnabled(saved.eazybb_animation_enabled);
  setTheme(saved.eazybb_theme);
  applyLayout(saved.eazybb_layout);
}).catch(() => {
  document.getElementById('refresh-feedback').textContent = '读取设置失败，已使用默认设置';
});

const assignmentSettingsReady = chrome.storage.local.get([
  'eazybb_assignment_preferences', 'eazybb_assignment_favorites', 'eazybb_assignment_completion_overrides',
]).then((saved) => {
  assignmentPreferences = normalizeAssignmentPreferences(saved.eazybb_assignment_preferences);
  favoriteAssignments = new Set(Array.isArray(saved.eazybb_assignment_favorites)
    ? saved.eazybb_assignment_favorites.filter((id) => typeof id === 'string') : []);
  completionOverrides = normalizeCompletionOverrides(saved.eazybb_assignment_completion_overrides);
  renderAssignments();
  renderAllAssignments();
  renderNavigation();
  if (selectedCourse) renderCourseAssignments(selectedCourse);
}).catch(() => {});

function dayKeyAtOffset(offset) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return dateKey(day);
}

function buildHomeworkSettings() {
  const card = document.createElement('section');
  card.className = 'homework-settings-card bento-card';
  const heading = document.createElement('h2');
  heading.textContent = '作业显示';
  card.append(heading);
  const fields = [
    ['limit', '显示个数', '最多显示的作业数', 1, 100],
    ['daysBefore', '往前天数', '显示过去 n 天截止的作业', 0, 365],
    ['daysAfter', '往后天数', '显示未来 n 天截止的作业', 0, 365],
  ];
  for (const [key, label, hint, min, max] of fields) {
    const row = document.createElement('label');
    row.className = 'homework-setting-field';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = label;
    const description = document.createElement('small');
    description.textContent = hint;
    copy.append(name, description);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.value = String(assignmentPreferences[key]);
    input.addEventListener('change', () => updateAssignmentPreference(key, input.value, status));
    row.append(copy, input);
    card.append(row);
  }
  const sortRow = document.createElement('label');
  sortRow.className = 'homework-setting-field';
  const sortName = document.createElement('strong');
  sortName.textContent = '显示顺序';
  const sort = document.createElement('select');
  for (const [value, label] of [['dueAsc', '截止时间从近到远'], ['dueDesc', '截止时间从远到近'], ['course', '按课程名称']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    sort.append(option);
  }
  sort.value = assignmentPreferences.sort;
  sort.addEventListener('change', () => updateAssignmentPreference('sort', sort.value, status));
  sortRow.append(sortName, sort);
  card.append(sortRow);
  const hideRow = document.createElement('label');
  hideRow.className = 'homework-setting-field homework-setting-check';
  const hideCopy = document.createElement('span');
  const hideName = document.createElement('strong');
  hideName.textContent = '隐藏已完成';
  const hideHint = document.createElement('small');
  hideHint.textContent = '隐藏收藏中已完成的作业';
  hideCopy.append(hideName, hideHint);
  const hide = document.createElement('input');
  hide.type = 'checkbox';
  hide.checked = assignmentPreferences.hideCompletedFavorites;
  hide.addEventListener('change', () => updateAssignmentPreference('hideCompletedFavorites', hide.checked, status));
  hideRow.append(hideCopy, hide);
  card.append(hideRow);
  const status = document.createElement('p');
  status.className = 'preference-feedback';
  status.setAttribute('role', 'status');
  card.append(status);
  return card;
}

function renderHomeworkSettings() {
  document.getElementById('homework-settings-content').replaceChildren(buildHomeworkSettings());
}

async function updateAssignmentPreference(key, value, status) {
  assignmentPreferences = normalizeAssignmentPreferences({ ...assignmentPreferences, [key]: value });
  renderAssignments();
  renderAllAssignments();
  renderNavigation();
  if (selectedCourse) renderCourseAssignments(selectedCourse);
  try {
    await chrome.storage.local.set({ eazybb_assignment_preferences: assignmentPreferences });
    status.textContent = '已保存';
  } catch {
    status.textContent = '保存作业设置失败';
  }
}

const credentialsForm = document.getElementById('credentials-form');
const studentIdInput = document.getElementById('student-id');
const passwordInput = document.getElementById('student-password');
const testButton = document.getElementById('test-credentials');
const saveButton = document.getElementById('save-credentials');
const credentialsStatus = document.getElementById('credentials-status');

function showCredentialsStatus(message, kind = '') {
  credentialsStatus.textContent = message;
  credentialsStatus.className = `credentials-status${kind ? ` ${kind}` : ''}`;
}

chrome.storage.local.get('eazybb_credentials').then(({ eazybb_credentials: saved }) => {
  if (!saved) return;
  studentIdInput.value = saved.studentId ?? '';
  passwordInput.value = saved.password ?? '';
});

credentialsForm.addEventListener('input', () => showCredentialsStatus(''));

credentialsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const studentId = studentIdInput.value.trim();
  const password = passwordInput.value;
  testButton.disabled = true;
  testButton.textContent = '测试中…';
  showCredentialsStatus('正在连接校园认证服务…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'auth.test', studentId, password });
    if (!response?.ok) throw new Error(response?.error ?? '测试失败');
    if (studentIdInput.value.trim() === studentId && passwordInput.value === password) {
      showCredentialsStatus(response.data.message, response.data.valid ? 'success' : 'error');
    }
    if (response.data.valid) refreshHomeData();
  } catch (error) {
    if (studentIdInput.value.trim() === studentId && passwordInput.value === password) {
      showCredentialsStatus(`测试失败：${error.message}`, 'error');
    }
  } finally {
    testButton.disabled = false;
    testButton.textContent = '测试';
  }
});

saveButton.addEventListener('click', async () => {
  if (!credentialsForm.reportValidity()) return;
  saveButton.disabled = true;
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({
      eazybb_credentials: {
        studentId: studentIdInput.value.trim(),
        password: passwordInput.value,
      },
    });
    showCredentialsStatus('已保存到当前浏览器', 'success');
    refreshHomeData();
  } catch (error) {
    showCredentialsStatus(`保存失败：${error.message}`, 'error');
  } finally {
    saveButton.disabled = false;
  }
});

function renderCalendar() {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  monthLabel.textContent = `${year} 年 ${String(month + 1).padStart(2, '0')} 月`;
  todayLabel.textContent = `今天是 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  calendarGrid.replaceChildren();
  const currentDayKey = chinaDayKey(new Date());

  for (let index = 0; index < cellCount; index += 1) {
    const date = new Date(year, month, index - firstWeekday + 1);
    const key = dateKey(date);
    const dueAssignments = assignments.filter((item) => item.dayKey === key);
    const dayExams = exams.filter((exam) => exam.KSRQ === key);
    const dueCount = dueAssignments.length;
    const examCount = dayExams.length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.textContent = String(date.getDate());
    const labels = [];
    if (dueCount) labels.push(`${dueCount} 项作业截止`);
    if (examCount) labels.push(`${examCount} 门考试`);
    button.setAttribute('aria-label', `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日${labels.length ? `，${labels.join('，')}` : ''}`);
    button.setAttribute('aria-pressed', key === dateKey(selectedDate) ? 'true' : 'false');
    if (date.getMonth() !== month) button.classList.add('outside');
    if (key === dateKey(today)) button.classList.add('today');
    if (key === dateKey(selectedDate)) {
      button.classList.add('selected');
    }
    if (dueCount || examCount) {
      const dot = document.createElement('span');
      dot.className = 'day-dot';
      if (dueCount) {
        const daysUntilDue = diffDays(currentDayKey, key);
        if (dueAssignments.some((item) => item.completed !== true) && daysUntilDue >= 0 && daysUntilDue <= 3) {
          dot.classList.add('is-urgent');
        } else if (dueAssignments.every((item) => item.completed === true)) {
          dot.classList.add('is-complete');
        }
      } else {
        dot.classList.add('is-exam');
      }
      dot.setAttribute('aria-hidden', 'true');
      button.append(dot);
    }
    button.addEventListener('click', () => {
      selectedDate = date;
      visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
      renderSelectedDay();
    });
    calendarGrid.append(button);
  }
}

function renderSelectedDay() {
  const due = assignments.filter((item) => item.dayKey === dateKey(selectedDate));
  const dayExams = exams.filter((exam) => exam.KSRQ === dateKey(selectedDate));
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(selectedDate);

  const itemCount = due.length + dayExams.length;
  document.getElementById('selected-day-number').textContent = String(selectedDate.getDate()).padStart(2, '0');
  document.getElementById('selected-day-weekday').textContent = weekday;
  const summaries = [];
  if (due.length) summaries.push(`${due.length} 项作业截止`);
  if (dayExams.length) summaries.push(`${dayExams.length} 场考试`);
  document.getElementById('selected-day-title').textContent = summaries.join(' · ') || '暂无安排';

  const detail = document.getElementById('selected-day-detail');
  detail.replaceChildren();

  if (!itemCount) {
    const empty = document.createElement('span');
    empty.className = 'selected-day-empty';
    empty.textContent = '这一天暂无作业和考试安排';
    detail.append(empty);
    return;
  }

  // 显示作业
  for (const item of due) {
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'selected-day-assignment';
    title.textContent = item.title;
    title.setAttribute('aria-label', `查看作业：${item.title}`);
    title.addEventListener('click', () => openAssignment(item, title));
    detail.append(title);
  }

  // 显示考试
  for (const exam of dayExams) {
    const examRow = document.createElement('div');
    examRow.className = 'selected-day-exam';
    const courseRow = document.createElement('span');
    courseRow.className = 'selected-day-exam-course';
    courseRow.textContent = `考试 · ${exam.KCMC || '课程名称未知'}`;
    examRow.append(courseRow);

    const examTime = typeof exam.KSJTSJ === 'string' ? exam.KSJTSJ.trim() : '';
    if (examTime && examTime !== '时间未知') {
      const timeRow = document.createElement('small');
      timeRow.className = 'selected-day-exam-time';
      timeRow.textContent = formatExamTime(examTime);
      examRow.append(timeRow);
    }
    detail.append(examRow);
  }
}

function createAssignmentCard(item, returnView = homeView) {
    const card = document.createElement('article');
    card.className = `assignment-card${item.completed === true ? ' is-complete' : ''}`;
    card.dataset.assignmentId = item.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `查看作业：${item.title}`);
    card.addEventListener('click', () => openAssignment(item, card, returnView));
    card.addEventListener('keydown', (event) => {
      if (event.target.closest('button')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAssignment(item, card, returnView);
      }
    });
    const top = document.createElement('div');
    top.className = 'assignment-top';
    const course = document.createElement('span');
    course.className = 'course';
    const mark = document.createElement('span');
    mark.className = 'course-mark';
    mark.style.setProperty('--course-color', courseColor(item.course));
    course.append(mark, document.createTextNode(item.course));
    const actions = document.createElement('div');
    actions.className = 'assignment-actions';
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'assignment-favorite';
    favorite.setAttribute('aria-pressed', String(favoriteAssignments.has(item.id)));
    favorite.setAttribute('aria-label', favoriteAssignments.has(item.id) ? '取消收藏作业' : '收藏作业');
    favorite.title = favoriteAssignments.has(item.id) ? '取消收藏' : '收藏';
    favorite.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
    favorite.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFavoriteAssignment(item.id);
    });
    const completion = document.createElement('button');
    completion.type = 'button';
    completion.className = 'assignment-completion';
    completion.setAttribute('aria-pressed', String(item.completed === true));
    completion.setAttribute('aria-label', item.completed === true ? '标记作业未完成' : '标记作业已完成');
    completion.title = item.completed === true ? '标记未完成' : '标记已完成';
    completion.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/></svg>';
    completion.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleAssignmentCompletion(item.id);
    });
    actions.append(favorite, completion);
    top.append(course, actions);

    const title = document.createElement('h3');
    title.textContent = item.title;
    const bottom = document.createElement('div');
    bottom.className = 'assignment-bottom';
    const due = document.createElement('span');
    due.className = 'due-date';
    if (item.dayKey === dateKey(today)) due.classList.add('soon');
    const parts = chinaParts(item.due);
    due.textContent = `截止 ${Number(parts.month)} 月 ${Number(parts.day)} 日 ${parts.hour}:${parts.minute}`;
    bottom.append(due);
    const state = document.createElement('span');
    state.className = 'assignment-state';
    state.textContent = item.completed === true ? '已完成' : item.completed === false ? '未完成' : '状态待确认';
    bottom.append(state);
    card.append(top, title, bottom);
    return card;
}

function renderAssignments() {
  const visible = homeAssignments(assignments, favoriteAssignments, assignmentPreferences, dayKeyAtOffset);
  document.getElementById('remaining-count').textContent = String(visible.length);
  assignmentList.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'assignment-empty';
    empty.textContent = overviewLoaded ? '当前范围内暂无作业' : '尚未加载作业';
    assignmentList.append(empty);
    return;
  }

  for (const item of visible) assignmentList.append(createAssignmentCard(item));
}

function renderAllAssignments() {
  const ordered = allAssignments(assignments);
  document.getElementById('all-assignments-summary').textContent = `${ordered.length} 项作业 · 未完成优先，按截止时间排序`;
  allAssignmentList.replaceChildren();
  if (!ordered.length) {
    const empty = document.createElement('p');
    empty.className = 'assignment-empty';
    empty.textContent = overviewLoaded ? '暂无作业' : '尚未加载作业';
    allAssignmentList.append(empty);
    return;
  }
  for (const item of ordered) allAssignmentList.append(createAssignmentCard(item, allAssignmentsView));
}

function toggleFavoriteAssignment(id) {
  if (favoriteAssignments.has(id)) favoriteAssignments.delete(id);
  else favoriteAssignments.add(id);
  renderAssignments();
  renderAllAssignments();
  renderNavigation();
  if (selectedCourse) renderCourseAssignments(selectedCourse);
  const ids = [...favoriteAssignments];
  favoriteWrite = favoriteWrite.catch(() => {}).then(() =>
    chrome.storage.local.set({ eazybb_assignment_favorites: ids }));
  favoriteWrite.catch(() => { setOverviewStatus('收藏状态保存失败', 'error'); });
}

function toggleAssignmentCompletion(id) {
  const item = assignments.find((assignment) => assignment.id === id);
  if (!item) return;
  const next = item.completed !== true;
  if (next === item.bbCompleted) delete completionOverrides[id];
  else completionOverrides[id] = next;
  item.completed = next;
  renderCalendar();
  renderSelectedDay();
  renderAssignments();
  renderAllAssignments();
  renderNavigation();
  if (selectedCourse) {
    renderCourseAssignments(selectedCourse);
    renderCoursePage();
  }
  const saved = { ...completionOverrides };
  completionWrite = completionWrite.catch(() => {}).then(() =>
    chrome.storage.local.set({ eazybb_assignment_completion_overrides: saved }));
  completionWrite.catch(() => { setOverviewStatus('作业完成状态保存失败', 'error'); });
}

function parseAssignmentBody(html, fileName, apiAttachments = []) {
  const documentBody = new DOMParser().parseFromString(html || '', 'text/html').body;
  documentBody.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
  const attachments = [...apiAttachments];
  const seen = new Set();
  for (const attachment of apiAttachments) seen.add(attachment.url);
  for (const anchor of documentBody.querySelectorAll('a[href]')) {
    try {
      const url = new URL(anchor.getAttribute('href'), 'https://bb.sustech.edu.cn/');
      const isAttachment = url.pathname.includes('/bbcswebdav/') || anchor.getAttribute('data-bbtype') === 'attachment';
      if (url.origin !== 'https://bb.sustech.edu.cn' || !isAttachment) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      let bbFileName = '';
      try { bbFileName = JSON.parse(anchor.getAttribute('data-bbfile') || '{}').linkName || ''; }
      catch { /* Ignore malformed Blackboard file metadata. */ }
      attachments.push({ name: bbFileName || anchor.textContent.trim() || decodeURIComponent(url.pathname.split('/').pop()), url: url.href });
    } catch { /* Ignore malformed attachment links. */ }
  }
  if (fileName && !attachments.some((attachment) => attachment.name === fileName)) {
    attachments.push({ name: fileName, url: '' });
  }
  return { description: documentBody.textContent.replace(/\s+/g, ' ').trim() || '无描述', attachments };
}

function showHomeAttachmentError(row, error) {
  const section = row.closest('.navigation-course-section');
  if (!section) return;
  let status = section.querySelector('.navigation-attachment-error');
  if (!status) {
    status = document.createElement('p');
    status.className = 'navigation-attachment-error';
    status.setAttribute('role', 'status');
    section.append(status);
  }
  status.textContent = `无法打开课件：${error.message}`;
}

function renderAttachments(attachments) {
  const list = document.getElementById('detail-attachments');
  list.replaceChildren();
  if (!attachments.length) {
    const empty = document.createElement('p');
    empty.textContent = '无附件';
    list.append(empty);
    return;
  }
  for (const attachment of attachments) {
    const row = document.createElement(attachment.url ? 'a' : 'span');
    row.className = 'attachment-row';
    row.textContent = `${attachment.name}${attachment.url ? ' ↗' : ' · 暂无下载链接'}`;
    if (attachment.url) {
      row.href = attachment.url;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      row.addEventListener('click', async (event) => {
        event.preventDefault();
        row.setAttribute('aria-busy', 'true');
        try {
          await openBlackboardFile(attachment);
        } catch (error) {
          document.getElementById('detail-status').textContent = `无法打开附件：${error.message}`;
        } finally {
          row.removeAttribute('aria-busy');
        }
      });
    }
    list.append(row);
  }
}

async function openAssignment(item, card, returnView = homeView) {
  lastAssignmentCard = card;
  assignmentReturnView = returnView;
  const requestId = ++detailRequestId;
  document.getElementById('detail-course').textContent = item.course;
  document.getElementById('detail-title').textContent = item.title;
  const parts = chinaParts(item.due);
  document.getElementById('detail-due').textContent = `截止 ${Number(parts.month)} 月 ${Number(parts.day)} 日 ${parts.hour}:${parts.minute}`;
  document.getElementById('detail-completion').textContent = item.completed === true
    ? '已完成' : item.completed === false ? '未完成' : '完成状态待确认';
  document.getElementById('detail-description').textContent = '正在读取…';
  document.getElementById('detail-attachments').replaceChildren();
  document.getElementById('detail-status').textContent = '';
  document.getElementById('submission-text').value = '';
  document.getElementById('submission-comments').value = '';
  document.getElementById('submission-files').value = '';
  showSelectedFiles([]);
  showView(assignmentView, document.getElementById('back-assignment'));
  if (!item.courseId || !item.contentId) {
    document.getElementById('detail-description').textContent = '无描述';
    renderAttachments([]);
    document.getElementById('detail-status').textContent = 'Blackboard 未提供此作业的内容链接';
    return;
  }
  const cacheKey = `bb:assignmentDetail:${item.courseId}:${item.contentId}`;
  const cached = await readDataCache(cacheKey, (data) => data && typeof data.body === 'string'
    && Array.isArray(data.attachments));
  if (requestId !== detailRequestId) return;
  if (cached) {
    const content = parseAssignmentBody(cached.body, cached.fileName, cached.attachments);
    document.getElementById('detail-description').textContent = content.description;
    renderAttachments(content.attachments);
    document.getElementById('detail-status').textContent = '正在刷新，先显示上次的内容';
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'bb.assignmentDetail', courseId: item.courseId, contentId: item.contentId });
    if (requestId !== detailRequestId) return;
    if (!response?.ok) throw new Error(response?.error ?? '读取失败');
    const content = parseAssignmentBody(response.data.body, response.data.fileName, response.data.attachments);
    document.getElementById('detail-description').textContent = content.description;
    renderAttachments(content.attachments);
    document.getElementById('detail-status').textContent = '';
    if (response.data.attachmentError) {
      document.getElementById('detail-status').textContent = `附件列表读取失败：${response.data.attachmentError}`;
    }
    try { await saveDataCache(cacheKey, response.data); }
    catch {
      if (requestId === detailRequestId) document.getElementById('detail-status').textContent += '（本地保存失败）';
    }
  } catch (error) {
    if (requestId !== detailRequestId) return;
    if (!cached) {
      document.getElementById('detail-description').textContent = '暂时无法读取描述';
      renderAttachments([]);
    }
    document.getElementById('detail-status').textContent = cached ? `刷新失败（${error.message}），显示的是上次的内容` : `作业内容读取失败：${error.message}`;
  }
}

function showSelectedFiles(files) {
  const list = document.getElementById('selected-files');
  list.replaceChildren();
  for (const file of files) {
    const row = document.createElement('li');
    row.textContent = file.name;
    list.append(row);
  }
}

const uploadZone = document.getElementById('upload-zone');
document.getElementById('submission-files').addEventListener('change', (event) => showSelectedFiles(event.target.files));
uploadZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    document.getElementById('submission-files').click();
  }
});
for (const eventName of ['dragenter', 'dragover']) {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
  });
}
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (event) => {
  event.preventDefault();
  uploadZone.classList.remove('drag-over');
  showSelectedFiles(event.dataTransfer.files);
});

function courseColor(course) {
  const palette = ['#f18e70', '#8f9ce3', '#88b8a0', '#e1b367'];
  let hash = 0;
  for (const character of course) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function renderCourseAssignments(course) {
  const list = document.getElementById('course-assignments-list');
  const items = applySectionDisplay(courseAssignmentItems(course), sectionDisplaySettings(coursePageLayout, 'assignments'));
  document.getElementById('course-assignments-count').textContent = String(items.length);
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'assignment-empty';
    empty.textContent = '当前设置下暂无可显示的作业';
    list.append(empty);
    return;
  }
  for (const item of items) list.append(createAssignmentCard(item, courseView));
}

function courseAssignmentItems(course) {
  return homeAssignments(assignments.filter((item) => item.courseId === course.id),
    favoriteAssignments, assignmentPreferences, dayKeyAtOffset, Infinity);
}

function renderCourseAnnouncements(items) {
  courseAnnouncements = items;
  const visible = applySectionDisplay(items, sectionDisplaySettings(coursePageLayout, 'announcements'));
  const list = document.getElementById('course-announcements-list');
  document.getElementById('course-announcements-count').textContent = String(visible.length);
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'course-detail-empty';
    empty.textContent = '当前设置下暂无可显示的公告';
    list.append(empty);
    if (editingCourseItem === 'announcements') renderCourseItemSettings();
    return;
  }
  for (const item of visible) list.append(createAnnouncementCard(item));
  if (editingCourseItem === 'announcements') renderCourseItemSettings();
}

function createAnnouncementCard(item) {
  const card = document.createElement('article');
  card.className = 'announcement-card';
  const title = document.createElement('h3');
  title.textContent = item.title;
  card.append(title);
  const date = new Date(item.date);
  if (Number.isFinite(date.getTime())) {
    const stamp = document.createElement('time');
    stamp.className = 'announcement-date';
    stamp.dateTime = item.date;
    stamp.textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    card.append(stamp);
  }
  const body = new DOMParser().parseFromString(item.body, 'text/html').body;
  body.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
  const description = document.createElement('p');
  description.className = 'announcement-body';
  description.textContent = body.textContent.replace(/\s+/g, ' ').trim() || '无内容';
  card.append(description);
  return card;
}

function applyCourseMaterials(roots, saveLayout = false) {
  courseTreeRoots = roots;
  coursePageLayout = reconcileCoursePageLayout(coursePageLayout, courseTreeRoots);
  for (const item of coursePageLayout.customs) {
    if (item.source.mode === 'range' && !item.source.startId && !item.source.end && courseTreeRoots[0]) {
      item.source = makeRangeSource(courseTreeRoots, 0, 1);
    }
    if (item.titleAuto) item.title = selectCustomRoots(item.source, courseTreeRoots)[0]?.title || item.title;
  }
  if (saveLayout) saveCoursePageLayout();
  renderContentTree();
  renderCoursePage();
  renderCourseLayoutSettings();
  if (editingCourseItem) renderCourseItemSettings();
}

const COURSE_LABELS = { announcements: '公告', tree: '内容树', assignments: '作业' };
const COURSE_SETTINGS_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1.2 1.6V21h-3.6v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 13.8H3v-3.6h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88L4.2 7.06 7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10.2 3H13.8A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1.2H21v3.6h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>';

function coursePageStorageKey(courseId) { return `eazybb_course_page_layout_${courseId}`; }

function saveCoursePageLayout() {
  if (!selectedCourse || !coursePageLayout) return;
  const key = coursePageStorageKey(selectedCourse.id);
  const value = structuredClone(coursePageLayout);
  const feedback = document.getElementById(!courseRecommendationsView.hidden
    ? 'course-recommendations-feedback' : courseSettingsView.hidden
      ? 'course-layout-feedback' : 'course-settings-feedback');
  feedback.textContent = '';
  coursePageWrite = coursePageWrite.catch(() => {}).then(() => chrome.storage.local.set({ [key]: value }));
  coursePageWrite.catch(() => { feedback.textContent = '课程页面设置保存失败'; });
  renderNavigation();
}

function createContentTreeNode(node, isRoot = false, headingInSection = false, includeChildren = true,
  layout = coursePageLayout) {
  const card = document.createElement('article');
  card.className = isRoot ? 'content-tree-root bento-card' : 'content-tree-node';
  if (headingInSection) card.classList.add('heading-in-section');
  else {
    const heading = document.createElement('div');
    heading.className = 'content-tree-heading';
    const title = document.createElement('strong');
    title.textContent = node.title;
    heading.append(title);
    card.append(heading);
  }
  const parsed = parseAssignmentBody(node.body, node.fileName, node.attachments);
  if (parsed.description !== '无描述') {
    const description = document.createElement('p');
    description.className = 'content-tree-description';
    description.textContent = parsed.description;
    card.append(description);
  }
  if (parsed.attachments.length) {
    const files = document.createElement('div');
    files.className = 'content-tree-files';
    for (const attachment of parsed.attachments) {
      const row = document.createElement(attachment.url ? 'a' : 'span');
      row.className = 'attachment-row';
      row.textContent = `${attachment.name}${attachment.url ? ' ↗' : ' · 暂无下载链接'}`;
      if (attachment.url) {
        row.href = attachment.url;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
        row.addEventListener('click', async (event) => {
          event.preventDefault();
          try { await openBlackboardFile(attachment); }
          catch (error) {
            if (row.closest('#navigation-files')) {
              showHomeAttachmentError(row, error);
              return;
            }
            const status = card.closest('.course-detail-section')?.querySelector('.course-detail-status') || document.getElementById('course-materials-status');
            status.classList.add('error');
            status.textContent = `无法打开课件：${error.message}`;
          }
        });
      }
      files.append(row);
    }
    card.append(files);
  }
  if (includeChildren && node.children?.length) {
    const children = document.createElement('div');
    children.className = 'content-tree-children';
    for (const child of displayTreeChildren(node.children, layout, node.id)) {
      children.append(createContentTreeNode(child, false, false, true, layout));
    }
    card.append(children);
  }
  return card;
}

function renderContentTree() {
  const list = document.getElementById('course-materials-list');
  list.replaceChildren();
  const settings = sectionDisplaySettings(coursePageLayout, 'tree');
  const roots = applySectionDisplay(filterSectionTree(courseTreeRoots, settings.hiddenItems), settings);
  document.getElementById('course-materials-count').textContent = String(roots.length);
  for (const root of roots) list.append(createContentTreeNode(root, true));
  if (!roots.length) {
    const empty = document.createElement('p');
    empty.className = 'course-detail-empty';
    empty.textContent = '当前设置下暂无可显示的内容';
    list.append(empty);
  }
}

function customItem(id) { return coursePageLayout?.customs.find((item) => item.id === id); }

function customSectionEntries(item, allRoots = courseTreeRoots, layout = null, hiddenItems = []) {
  const roots = selectCustomRoots(item.source, allRoots);
  if (roots.length !== 1) return roots.map((node) => ({ id: node.id, title: node.title, node }));
  const root = roots[0];
  const parsed = parseAssignmentBody(root.body, root.fileName, root.attachments);
  const entries = [];
  if (parsed.description !== '无描述' || parsed.attachments.length) {
    entries.push({ id: `own:${root.id}`, title: `${root.title} · 内容`, node: root, own: true });
  }
  const children = layout ? displayTreeChildren(filterSectionTree(root.children || [], hiddenItems), layout, root.id)
    : root.children || [];
  entries.push(...children.map((node) => ({ id: node.id, title: node.title, node })));
  return entries;
}

function createCustomSection(item) {
  const section = document.createElement('section');
  section.className = 'course-detail-section';
  section.dataset.courseSection = item.id;
  const heading = document.createElement('div');
  heading.className = 'section-heading';
  const label = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = item.title;
  label.append(title);
  heading.append(label);
  const status = document.createElement('p');
  status.className = 'course-detail-status';
  status.setAttribute('role', 'status');
  const list = document.createElement('div');
  list.className = 'course-detail-list';
  const settings = sectionDisplaySettings(coursePageLayout, item.id);
  const entries = applySectionDisplay(customSectionEntries(item, courseTreeRoots,
    coursePageLayout, settings.hiddenItems), settings);
  for (const entry of entries) {
    if (entry.own) list.append(createContentTreeNode(entry.node, true, true, false));
    else {
      const node = filterSectionTree([entry.node], settings.hiddenItems)[0];
      if (node) list.append(createContentTreeNode(node, true));
    }
  }
  if (!entries.length || !list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'course-detail-empty';
    empty.textContent = '所选课程模块暂无可显示内容';
    list.append(empty);
  }
  section.append(heading, status, list);
  return section;
}

function renderCoursePage() {
  if (!coursePageLayout) return;
  const container = document.getElementById('course-sections');
  const standard = new Map([...container.querySelectorAll(':scope > section')]
    .filter((section) => COURSE_LABELS[section.dataset.courseSection])
    .map((section) => [section.dataset.courseSection, section]));
  const sections = [];
  for (const id of visibleCoursePageOrder(coursePageLayout, courseTreeRoots)) {
    const item = customItem(id);
    const section = standard.get(id) || (item && createCustomSection(item));
    if (!section) continue;
    section.querySelector('.course-section-name')?.replaceChildren(document.createTextNode(courseItemTitle(id)));
    section.hidden = coursePageLayout.hidden.includes(id) || (id === 'tree' && coursePageLayout.splitTree);
    sections.push(section);
    if (id === 'tree' && coursePageLayout.splitTree) {
      for (const splitId of visibleSplitOrder(coursePageLayout, courseTreeRoots)) {
        const splitItem = customItem(splitId);
        if (!splitItem) continue;
        const splitSection = createCustomSection(splitItem);
        splitSection.hidden = coursePageLayout.hidden.includes(splitId);
        sections.push(splitSection);
      }
    }
  }
  container.replaceChildren(...sections);
  renderCourseSettings();
}

function courseItemTitle(id) { return customItem(id)?.title || coursePageLayout?.titles?.[id] || COURSE_LABELS[id] || '自定义内容'; }

function timetableCourseNames() {
  return [...new Set((timetable?.allLessons ?? timetable?.lessons ?? [])
    .map((lesson) => lesson.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function linkedTimetableLessons(course) {
  const semester = timetable?.filename ?? timetable?.semester ?? '';
  const slots = new Map();
  for (const lesson of timetable?.allLessons ?? timetable?.lessons ?? []) {
    if (!classTimes[lesson.periodStart] || !classTimes[lesson.periodEnd]
      || lesson.periodEnd < lesson.periodStart) continue;
    if (resolveBlackboardCourse(lesson.name, courses, courseAssociations, semester)?.id !== course.id) continue;
    slots.set(lessonRecommendationKey(semester, lesson), lesson);
  }
  return [...slots.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')
    || a.day - b.day || a.periodStart - b.periodStart || a.periodEnd - b.periodEnd);
}

function renderCourseSettings() {
  if (!selectedCourse || !coursePageLayout) return;
  document.getElementById('course-settings-name').textContent = selectedCourse.name;
  const semester = timetable?.filename ?? timetable?.semester ?? '';
  const matched = linkedTimetableLessons(selectedCourse);
  const names = [...new Set(matched.map((lesson) => lesson.name))];
  document.getElementById('course-timetable-link-summary').textContent = names.length
    ? names.join('、') : '尚未关联课程表课程';
  const list = document.getElementById('course-recommendation-options');
  list.replaceChildren();
  const sections = [...document.querySelectorAll('#course-sections > section')]
    .filter((section) => section.dataset.courseSection !== 'tree' || !coursePageLayout.splitTree);
  if (!matched.length) {
    const empty = document.createElement('p');
    empty.textContent = '请先在上方关联课程表课程';
    list.append(empty);
    return;
  }
  if (!sections.length) {
    const empty = document.createElement('p');
    empty.textContent = '当前没有可选的课程卡片';
    list.append(empty);
    return;
  }
  const visibleIds = new Set(sections.map((section) => section.dataset.courseSection));
  const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
  for (const lesson of matched) {
    const key = lessonRecommendationKey(semester, lesson);
    const timetableKey = courseAssociationKey(semester, lesson.name);
    const group = document.createElement('section');
    group.className = 'course-recommendation-group';
    const heading = document.createElement('h3');
    heading.textContent = lesson.name;
    const period = lesson.periodStart === lesson.periodEnd
      ? `第 ${lesson.periodStart} 节` : `第 ${lesson.periodStart}–${lesson.periodEnd} 节`;
    const schedule = document.createElement('small');
    schedule.className = 'course-recommendation-time';
    schedule.textContent = `周${weekdayLabels[lesson.day - 1] ?? lesson.day} · ${period} · ${lessonTimeRange(lesson, classTimes)}`;
    const hint = document.createElement('small');
    hint.className = 'course-recommendation-hint';
    hint.textContent = '每节课从课程卡片中选择内容，总共最多显示 2 个条目';
    group.append(heading, schedule, hint);
    const currentSelection = recommendedForLesson(coursePageLayout, key, timetableKey)
      .filter((id) => visibleIds.has(id));
    const totalCount = currentSelection.reduce((sum, id) =>
      sum + lessonPreviewSettings(coursePageLayout, key, id).count, 0);
    for (const section of sections) {
      const id = section.dataset.courseSection;
      const option = document.createElement('label');
      option.className = 'course-recommendation-option';
      const name = document.createElement('span');
      name.textContent = courseItemTitle(id);
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = currentSelection.includes(id);
      checkbox.disabled = !checkbox.checked && totalCount >= 2;
      checkbox.addEventListener('change', () => {
        const current = recommendedForLesson(coursePageLayout, key, timetableKey)
          .filter((entry) => visibleIds.has(entry));
        const used = current.reduce((sum, entry) =>
          sum + lessonPreviewSettings(coursePageLayout, key, entry).count, 0);
        if (checkbox.checked && used >= 2) {
          checkbox.checked = false;
          hint.textContent = '最多显示 2 个条目，请先减少已选卡片的数量';
          return;
        }
        const next = checkbox.checked ? [...current, id] : current.filter((entry) => entry !== id);
        coursePageLayout.recommendedByLesson[key] = next;
        saveCoursePageLayout();
        renderCourseSettings();
      });
      option.append(name, checkbox);
      group.append(option);
      if (!checkbox.checked) continue;
      const controls = document.createElement('div');
      controls.className = 'course-recommendation-controls';
      const order = document.createElement('label');
      order.textContent = '显示顺序';
      const orderSelect = document.createElement('select');
      for (const [value, label] of [['forward', '正序'], ['reverse', '反序']]) {
        const choice = document.createElement('option');
        choice.value = value;
        choice.textContent = label;
        orderSelect.append(choice);
      }
      orderSelect.value = lessonPreviewSettings(coursePageLayout, key, id).reverse ? 'reverse' : 'forward';
      orderSelect.addEventListener('change', () => {
        coursePageLayout.recommendedDisplayByLesson[key] ??= {};
        coursePageLayout.recommendedDisplayByLesson[key][id] = {
          ...lessonPreviewSettings(coursePageLayout, key, id), reverse: orderSelect.value === 'reverse',
        };
        saveCoursePageLayout();
      });
      order.append(orderSelect);
      const count = document.createElement('label');
      count.textContent = '从上往下显示';
      const countSelect = document.createElement('select');
      for (const value of [1, 2]) {
        const choice = document.createElement('option');
        choice.value = String(value);
        choice.textContent = `${value} 个`;
        choice.disabled = totalCount - lessonPreviewSettings(coursePageLayout, key, id).count + value > 2;
        countSelect.append(choice);
      }
      countSelect.value = String(lessonPreviewSettings(coursePageLayout, key, id).count);
      countSelect.addEventListener('change', () => {
        coursePageLayout.recommendedDisplayByLesson[key] ??= {};
        coursePageLayout.recommendedDisplayByLesson[key][id] = {
          ...lessonPreviewSettings(coursePageLayout, key, id), count: Number(countSelect.value),
        };
        saveCoursePageLayout();
        renderCourseSettings();
      });
      count.append(countSelect);
      controls.append(order, count);
      group.append(controls);
      renderRecommendationTreeNodeSettings(group, key, id);
    }
    list.append(group);
  }
}

function renderRecommendationTreeNodeSettings(container, lessonKey, sectionId) {
  const roots = sectionId === 'tree' ? courseTreeRoots
    : selectCustomRoots(customItem(sectionId)?.source, courseTreeRoots);
  const parents = [];
  function collect(nodes, depth = 0) {
    for (const node of nodes) {
      if (node.children?.length) parents.push({ node, depth });
      collect(node.children || [], depth + 1);
    }
  }
  collect(roots);
  if (!parents.length) return;
  const panel = document.createElement('div');
  panel.className = 'course-recommendation-node-settings';
  const heading = document.createElement('strong');
  heading.textContent = '子项显示';
  panel.append(heading);
  for (const { node, depth } of parents) {
    const settings = lessonTreeNodeDisplaySettings(coursePageLayout, lessonKey, sectionId, node.id);
    const row = document.createElement('div');
    row.className = 'course-tree-node-setting';
    row.style.setProperty('--depth', String(depth));
    const title = document.createElement('strong');
    title.textContent = node.title;
    const controls = document.createElement('div');
    controls.className = 'course-tree-node-controls';
    const order = document.createElement('label');
    order.textContent = '顺序';
    const orderSelect = document.createElement('select');
    for (const [value, label] of [['forward', '正序'], ['reverse', '反序']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      orderSelect.append(option);
    }
    orderSelect.value = settings.reverse ? 'reverse' : 'forward';
    orderSelect.addEventListener('change', () => {
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey] ??= {};
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey][sectionId] ??= {};
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey][sectionId][String(node.id)] = {
        ...lessonTreeNodeDisplaySettings(coursePageLayout, lessonKey, sectionId, node.id),
        reverse: orderSelect.value === 'reverse',
      };
      saveCoursePageLayout();
    });
    order.append(orderSelect);
    const count = document.createElement('label');
    count.textContent = '显示前 N 个';
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.step = '1';
    countInput.placeholder = '全部';
    countInput.value = settings.limit ?? '';
    countInput.addEventListener('change', () => {
      const limit = countInput.value === '' ? null : Math.max(1, Math.floor(Number(countInput.value) || 1));
      countInput.value = limit ?? '';
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey] ??= {};
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey][sectionId] ??= {};
      coursePageLayout.recommendedTreeNodeDisplayByLesson[lessonKey][sectionId][String(node.id)] = {
        ...lessonTreeNodeDisplaySettings(coursePageLayout, lessonKey, sectionId, node.id), limit,
      };
      saveCoursePageLayout();
    });
    count.append(countInput);
    controls.append(order, count);
    row.append(title, controls);
    panel.append(row);
  }
  container.append(panel);
}

function renderCourseTimetableLink() {
  const list = document.getElementById('course-timetable-link-list');
  const feedback = document.getElementById('course-timetable-link-feedback');
  list.replaceChildren();
  feedback.textContent = '';
  if (!selectedCourse) return;
  const names = timetableCourseNames();
  if (!names.length) {
    const empty = document.createElement('p');
    empty.className = 'courses-empty';
    empty.textContent = '暂无课程表课程，请先加载课程表';
    list.append(empty);
    return;
  }
  const semester = timetable?.filename ?? timetable?.semester ?? '';
  for (const name of names) {
    const key = courseAssociationKey(semester, name);
    const manuallyLinked = courseAssociations[key] === selectedCourse.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'course-card course-timetable-choice';
    button.setAttribute('aria-pressed', String(manuallyLinked));
    button.setAttribute('aria-label', `${manuallyLinked ? '取消手动关联' : '手动关联'}：${name}`);
    const mark = document.createElement('span');
    mark.className = 'course-mark';
    mark.style.setProperty('--course-color', courseColor(name));
    const label = document.createElement('span');
    label.textContent = name;
    const state = document.createElement('small');
    state.textContent = manuallyLinked ? '已手动关联'
      : resolveBlackboardCourse(name, courses, courseAssociations, semester)?.id === selectedCourse.id
        ? '自动匹配' : '';
    button.append(mark, label, state);
    button.addEventListener('click', async () => {
      const next = { ...courseAssociations };
      if (manuallyLinked) delete next[key];
      else next[key] = selectedCourse.id;
      try {
        await chrome.storage.local.set({ eazybb_course_associations: next });
        courseAssociations = next;
        renderCourseTimetableLink();
        renderCourseSettings();
        renderNavigation();
      } catch (error) {
        feedback.textContent = `保存课程关联失败：${error.message}`;
      }
    });
    list.append(button);
  }
}

function renameCourseItem(id, name) {
  const title = name.trim();
  if (!title || title === courseItemTitle(id)) return;
  const item = customItem(id);
  if (item) { item.title = title; item.titleAuto = false; }
  else coursePageLayout.titles[id] = title;
  saveCoursePageLayout();
  renderCoursePage();
  renderCourseLayoutSettings();
}

function renderCourseLayoutSettings() {
  if (!coursePageLayout) return;
  const list = document.getElementById('course-layout-list');
  list.replaceChildren();
  for (const id of visibleCoursePageOrder(coursePageLayout, courseTreeRoots)) {
    const card = document.createElement('div');
    card.className = 'layout-card course-layout-card bento-card';
    card.dataset.unit = id;
    card.draggable = true;
    card.tabIndex = 0;
    card.classList.toggle('is-hidden', coursePageLayout.hidden.includes(id) && !(id === 'tree' && coursePageLayout.splitTree));
    card.setAttribute('aria-label', `${courseItemTitle(id)}，可拖动调整顺序`);
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.textContent = '⠿';
    const copy = document.createElement('div');
    copy.className = 'layout-card-content';
    const title = document.createElement('strong');
    title.textContent = courseItemTitle(id);
    copy.append(title);
    const detail = document.createElement('small');
    detail.textContent = id === 'tree' && coursePageLayout.splitTree ? '拆分后的内容' : customItem(id) ? '模块范围' : '课程内容';
    copy.append(detail);
    if (id === 'tree' && coursePageLayout.splitTree) {
      const preview = document.createElement('div');
      preview.className = 'course-split-preview';
      const splitIds = visibleSplitOrder(coursePageLayout, courseTreeRoots);
      for (const splitId of splitIds) {
        const row = document.createElement('span');
        row.textContent = courseItemTitle(splitId);
        row.classList.toggle('is-hidden', coursePageLayout.hidden.includes(splitId));
        preview.append(row);
      }
      if (!splitIds.length) preview.textContent = '暂无可显示的模块';
      copy.append(preview);
    }
    title.title = '双击重命名';
    title.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.className = 'course-name-input';
        input.value = courseItemTitle(id);
        copy.replaceChild(input, title);
        input.focus();
        input.select();
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          if (save) renameCourseItem(id, input.value);
          renderCourseLayoutSettings();
        };
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
      });
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'content-tree-visibility';
    settings.innerHTML = COURSE_SETTINGS_ICON;
    settings.setAttribute('aria-label', `设置${courseItemTitle(id)}`);
    settings.title = `设置${courseItemTitle(id)}`;
    settings.addEventListener('click', () => openCourseItemSettings(id));
    card.append(handle, copy, settings);
    list.append(card);
  }
}

function addCustomContent() {
  if (!coursePageLayout) return;
  const id = `custom:${crypto.randomUUID()}`;
  coursePageLayout.customs.push({ id, title: '自定义内容', titleAuto: true, origin: 'manual',
    source: makeRangeSource(courseTreeRoots, 0, Math.min(1, courseTreeRoots.length)) });
  coursePageLayout.order.push(id);
  saveCoursePageLayout();
  renderCoursePage();
  renderCourseLayoutSettings();
  showView(courseLayoutView, document.getElementById('back-course-layout'));
  document.getElementById('course-layout-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function setCustomSource(item, source) {
  if (item.origin === 'split' && source.mode === 'range') {
    const index = courseTreeRoots.findIndex((root) => root.id === item.splitRootId);
    if (index >= 0) source = makeRangeSource(courseTreeRoots, index,
      Math.max(index + 1, rangeBounds(source, courseTreeRoots).end));
  }
  item.source = source;
  const first = selectCustomRoots(source, courseTreeRoots)[0];
  if (item.titleAuto && first) item.title = first.title;
  saveCoursePageLayout();
  renderCoursePage();
  renderCourseLayoutSettings();
  renderCourseItemSettings();
}

function renderRangeSelector(item, container) {
  const roots = courseTreeRoots;
  if (!roots.length) {
    const empty = document.createElement('p');
    empty.className = 'course-detail-empty';
    empty.textContent = '内容树尚未读取到课程模块';
    container.append(empty);
    return;
  }
  const bounds = rangeBounds(item.source, roots);
  const ownerIndex = item.origin === 'split' ? roots.findIndex((root) => root.id === item.splitRootId) : -1;
  const start = ownerIndex >= 0 ? ownerIndex : Math.min(roots.length - 1, bounds.start);
  const end = Math.max(start + 1, Math.min(roots.length, bounds.end));
  const list = document.createElement('div');
  list.className = 'course-range-list';
  for (let index = 0; index <= roots.length; index += 1) {
    const slot = document.createElement('div');
    slot.className = 'course-range-slot';
    slot.dataset.boundary = String(index);
    slot.addEventListener('dragover', (event) => {
      if (draggedRangeBoundary && (ownerIndex < 0 || index > start)) {
        event.preventDefault();
        slot.classList.add('drag-over');
      }
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (event) => {
      if (!draggedRangeBoundary || (ownerIndex >= 0 && index <= start)) return;
      event.preventDefault();
      const nextStart = draggedRangeBoundary === 'start' ? Math.min(index, roots.length - 1) : start;
      const nextEnd = draggedRangeBoundary === 'end' ? Math.max(index, 1) : end;
      setCustomSource(item, draggedRangeBoundary === 'start'
        ? makeRangeSource(roots, nextStart, Math.max(end, nextStart + 1))
        : makeRangeSource(roots, Math.min(start, nextEnd - 1), nextEnd));
    });
    for (const [boundary, position, label] of [['start', start, '起点'], ['end', end, '终点']]) {
      if (position !== index) continue;
      const bar = document.createElement('button');
      bar.type = 'button';
      const locked = ownerIndex >= 0 && boundary === 'start';
      bar.className = `course-range-bar ${boundary}${locked ? ' locked' : ''}`;
      bar.draggable = !locked;
      bar.textContent = locked ? '起点 · 本模块' : `${label} ━━━━━`;
      bar.setAttribute('aria-label', locked ? '起点固定为当前模块' : `${label}边界，拖动或使用上下方向键调整`);
      if (locked) bar.disabled = true;
      else {
        bar.addEventListener('dragstart', (event) => { draggedRangeBoundary = boundary; event.dataTransfer.setData('text/plain', boundary); });
        bar.addEventListener('dragend', () => { draggedRangeBoundary = null; });
        bar.addEventListener('keydown', (event) => {
          if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const next = position + (event.key === 'ArrowDown' ? 1 : -1);
          if (boundary === 'start' && next >= 0 && next < end) setCustomSource(item, makeRangeSource(roots, next, end));
          if (boundary === 'end' && next > start && next <= roots.length) setCustomSource(item, makeRangeSource(roots, start, next));
        });
      }
      slot.append(bar);
    }
    list.append(slot);
    if (index < roots.length) {
      const row = document.createElement('div');
      row.className = 'course-range-root';
      row.classList.toggle('selected', index >= start && index < end);
      row.textContent = roots[index].title;
      list.append(row);
    }
  }
  container.append(list);
}

function renderSplitLayoutSettings(container) {
  const group = document.createElement('section');
  group.className = 'course-item-source bento-card';
  const title = document.createElement('h2');
  title.textContent = '拆分后的内容';
  const hint = document.createElement('p');
  hint.className = 'layout-instructions';
  hint.textContent = '拖动卡片调整拆分模块的顺序；点击右侧图标设置名称、显示和范围。';
  const list = document.createElement('div');
  list.className = 'layout-list course-split-list';
  for (const id of visibleSplitOrder(coursePageLayout, courseTreeRoots)) {
    const item = customItem(id);
    if (!item) continue;
    const card = document.createElement('div');
    card.className = 'layout-card course-layout-card bento-card';
    card.dataset.unit = id;
    card.draggable = true;
    card.tabIndex = 0;
    card.classList.toggle('is-hidden', coursePageLayout.hidden.includes(id));
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'layout-card-content';
    const name = document.createElement('strong');
    name.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = '模块范围';
    copy.append(name, detail);
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'content-tree-visibility';
    settings.innerHTML = COURSE_SETTINGS_ICON;
    settings.setAttribute('aria-label', `设置${item.title}`);
    settings.addEventListener('click', () => openCourseItemSettings(id));
    card.append(handle, copy, settings);
    list.append(card);
  }
  let dragged = null;
  list.addEventListener('dragstart', (event) => {
    if (event.target.closest('button, input')) return;
    dragged = event.target.closest('.course-layout-card');
    if (!dragged) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged.dataset.unit);
  });
  list.addEventListener('dragover', (event) => {
    const target = event.target.closest('.course-layout-card');
    if (!dragged || !target || target === dragged) return;
    event.preventDefault();
    list.querySelectorAll('.course-layout-card').forEach((card) => card.classList.toggle('drag-over', card === target));
  });
  function commitOrder() {
    coursePageLayout = reorderVisibleSplitItems(coursePageLayout,
      [...list.children].map((card) => card.dataset.unit), courseTreeRoots);
    saveCoursePageLayout();
    renderCoursePage();
    renderCourseLayoutSettings();
  }
  list.addEventListener('drop', (event) => {
    const target = event.target.closest('.course-layout-card');
    if (!dragged || !target || target === dragged) return;
    event.preventDefault();
    if ([...list.children].indexOf(dragged) < [...list.children].indexOf(target)) target.after(dragged);
    else target.before(dragged);
    commitOrder();
  });
  list.addEventListener('dragend', () => {
    list.querySelectorAll('.course-layout-card').forEach((card) => card.classList.remove('drag-over'));
    dragged = null;
  });
  list.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.target.closest('button, input')) return;
    const card = event.target.closest('.course-layout-card');
    const sibling = event.key === 'ArrowUp' ? card?.previousElementSibling : card?.nextElementSibling;
    if (!card || !sibling) return;
    event.preventDefault();
    if (event.key === 'ArrowUp') sibling.before(card);
    else sibling.after(card);
    commitOrder();
    card.focus();
  });
  group.append(title, hint, list);
  container.append(group);
}

function renderCourseItemSettings() {
  const id = editingCourseItem;
  if (!id || !coursePageLayout) return;
  const container = document.getElementById('course-item-settings');
  container.replaceChildren();
  document.getElementById('course-item-title').textContent = courseItemTitle(id);
  const item = customItem(id);
  const nameCard = document.createElement('div');
  nameCard.className = 'course-item-source bento-card course-name-setting';
  const nameLabel = document.createElement('label');
  nameLabel.htmlFor = 'course-item-name-input';
  nameLabel.textContent = '名称';
  const nameInput = document.createElement('input');
  nameInput.id = 'course-item-name-input';
  nameInput.className = 'course-name-input';
  nameInput.value = courseItemTitle(id);
  nameInput.addEventListener('change', () => {
    renameCourseItem(id, nameInput.value);
    renderCourseItemSettings();
  });
  nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') nameInput.blur(); });
  nameCard.append(nameLabel, nameInput);
  container.append(nameCard);
  const visibility = document.createElement('button');
  visibility.type = 'button';
  visibility.className = 'course-setting-row bento-card';
  const hidden = coursePageLayout.hidden.includes(id);
  visibility.innerHTML = `<span><strong>显示此内容</strong><small>控制课程页面是否显示这个单元</small></span><span class="course-toggle" aria-hidden="true"></span>`;
  visibility.setAttribute('aria-pressed', String(!hidden));
  if (id === 'tree' && coursePageLayout.splitTree) {
    visibility.disabled = true;
    visibility.querySelector('small').textContent = '内容树已拆分，请分别设置生成的自定义内容';
  }
  visibility.addEventListener('click', () => {
    coursePageLayout.hidden = hidden ? coursePageLayout.hidden.filter((value) => value !== id) : [...coursePageLayout.hidden, id];
    saveCoursePageLayout();
    renderCoursePage();
    renderCourseLayoutSettings();
    renderCourseItemSettings();
  });
  container.append(visibility);
  if (id === 'tree') {
    const split = document.createElement('button');
    split.type = 'button';
    split.className = 'course-setting-row bento-card';
    split.innerHTML = `<span><strong>拆分内容树</strong><small>每个一级模块单独成一张卡片</small></span><span class="course-toggle" aria-hidden="true"></span>`;
    split.setAttribute('aria-pressed', String(coursePageLayout.splitTree));
    split.addEventListener('click', () => {
      if (!coursePageLayout.splitTree) coursePageLayout.treeHiddenBeforeSplit = coursePageLayout.hidden.includes('tree');
      coursePageLayout.splitTree = !coursePageLayout.splitTree;
      if (coursePageLayout.splitTree) coursePageLayout = syncSplitItems(coursePageLayout, courseTreeRoots);
      else {
        const removed = new Set(coursePageLayout.customs.filter((entry) => entry.origin === 'split').map((entry) => entry.id));
        coursePageLayout.customs = coursePageLayout.customs.filter((entry) => entry.origin !== 'split');
        coursePageLayout.splitOrder = [];
        coursePageLayout.hidden = coursePageLayout.hidden.filter((value) => !removed.has(value)
          && (value !== 'tree' || coursePageLayout.treeHiddenBeforeSplit));
      }
      saveCoursePageLayout();
      renderCoursePage();
      renderCourseLayoutSettings();
      renderCourseItemSettings();
    });
    container.append(split);
    if (coursePageLayout.splitTree) renderSplitLayoutSettings(container);
  }
  if (id !== 'tree' || !coursePageLayout.splitTree) renderSectionDisplaySettings(id, container);
  if (id !== 'tree' || !coursePageLayout.splitTree) renderTreeNodeDisplaySettings(id, container);
  if (!item) return;
  const source = document.createElement('section');
  source.className = 'course-item-source bento-card';
  const title = document.createElement('h2');
  title.textContent = '显示内容';
  source.append(title);
  const hint = document.createElement('p');
  hint.className = 'layout-instructions';
  hint.textContent = item.origin === 'split'
    ? '起点固定为当前模块。拖动终点横条，选取到终点上方的模块。'
    : '拖动“起点”和“终点”横条，选中两条之间的模块。';
  source.append(hint);
  renderRangeSelector(item, source);
  container.append(source);
}

function renderTreeNodeDisplaySettings(id, container) {
  const roots = id === 'tree' ? courseTreeRoots
    : selectCustomRoots(customItem(id)?.source, courseTreeRoots);
  const parents = [];
  function collect(nodes, depth = 0) {
    for (const node of nodes) {
      if (node.children?.length) parents.push({ node, depth });
      collect(node.children || [], depth + 1);
    }
  }
  collect(roots);
  if (!parents.length) return;
  const card = document.createElement('section');
  card.className = 'course-item-source bento-card';
  const heading = document.createElement('h2');
  heading.textContent = '子项显示';
  const hint = document.createElement('p');
  hint.className = 'layout-instructions';
  hint.textContent = '设置每一层的顺序和数量，留空显示全部。';
  card.append(heading, hint);
  for (const { node, depth } of parents) {
    const settings = treeNodeDisplaySettings(coursePageLayout, node.id);
    const row = document.createElement('div');
    row.className = 'course-tree-node-setting';
    row.style.setProperty('--depth', String(depth));
    const title = document.createElement('strong');
    title.textContent = node.title;
    const controls = document.createElement('div');
    controls.className = 'course-tree-node-controls';
    const order = document.createElement('label');
    order.textContent = '顺序';
    const orderSelect = document.createElement('select');
    for (const [value, label] of [['forward', '正序'], ['reverse', '反序']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      orderSelect.append(option);
    }
    orderSelect.value = settings.reverse ? 'reverse' : 'forward';
    orderSelect.addEventListener('change', () => {
      coursePageLayout.treeNodeDisplay[String(node.id)] = {
        ...treeNodeDisplaySettings(coursePageLayout, node.id), reverse: orderSelect.value === 'reverse',
      };
      saveCoursePageLayout();
      renderContentTree();
      renderCoursePage();
    });
    order.append(orderSelect);
    const count = document.createElement('label');
    count.textContent = '显示前 N 个';
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.step = '1';
    countInput.placeholder = '全部';
    countInput.value = settings.limit ?? '';
    countInput.addEventListener('change', () => {
      const limit = countInput.value === '' ? null : Math.max(1, Math.floor(Number(countInput.value) || 1));
      countInput.value = limit ?? '';
      coursePageLayout.treeNodeDisplay[String(node.id)] = {
        ...treeNodeDisplaySettings(coursePageLayout, node.id), limit,
      };
      saveCoursePageLayout();
      renderContentTree();
      renderCoursePage();
    });
    count.append(countInput);
    controls.append(order, count);
    row.append(title, controls);
    card.append(row);
  }
  container.append(card);
}

function sectionEntryChoices(id) {
  if (id === 'announcements') return courseAnnouncements;
  if (id === 'assignments') return selectedCourse ? courseAssignmentItems(selectedCourse) : [];
  const roots = id === 'tree' ? courseTreeRoots : customSectionEntries(customItem(id));
  const choices = [];
  function visit(node, depth = 0) {
    choices.push({ id: node.id, title: node.title, depth });
    for (const child of node.children || []) visit(child, depth + 1);
  }
  if (id === 'tree') roots.forEach((node) => visit(node));
  else for (const entry of roots) {
    choices.push({ id: entry.id, title: entry.title, depth: 0 });
    if (!entry.own) for (const child of entry.node.children || []) visit(child, 1);
  }
  return choices;
}

function refreshCourseSectionDisplay(id) {
  if (id === 'announcements') renderCourseAnnouncements(courseAnnouncements);
  else if (id === 'assignments' && selectedCourse) renderCourseAssignments(selectedCourse);
  else if (id === 'tree') renderContentTree();
  else renderCoursePage();
}

function renderSectionDisplaySettings(id, container) {
  const settings = sectionDisplaySettings(coursePageLayout, id);
  const card = document.createElement('section');
  card.className = 'course-item-source bento-card';
  const heading = document.createElement('h2');
  heading.textContent = '条目显示';
  card.append(heading);
  const order = document.createElement('label');
  order.className = 'homework-setting-field';
  order.innerHTML = '<span><strong>显示顺序</strong><small>按当前内容顺序显示或反向显示</small></span>';
  const select = document.createElement('select');
  for (const [value, label] of [['forward', '正序'], ['reverse', '反序']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = settings.reverse ? 'reverse' : 'forward';
  select.addEventListener('change', () => {
    coursePageLayout.display[id] = { ...settings, reverse: select.value === 'reverse' };
    saveCoursePageLayout();
    refreshCourseSectionDisplay(id);
  });
  order.append(select);
  card.append(order);
  const limitRow = document.createElement('label');
  limitRow.className = 'homework-setting-field';
  limitRow.innerHTML = '<span><strong>显示前 N 个</strong><small>留空显示全部，隐藏的项不计入</small></span>';
  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.min = '1';
  limitInput.step = '1';
  limitInput.placeholder = '全部';
  limitInput.value = settings.limit ?? '';
  limitInput.addEventListener('change', () => {
    const limit = limitInput.value === '' ? null : Math.max(1, Math.floor(Number(limitInput.value) || 1));
    limitInput.value = limit ?? '';
    coursePageLayout.display[id] = { ...sectionDisplaySettings(coursePageLayout, id), limit };
    saveCoursePageLayout();
    refreshCourseSectionDisplay(id);
  });
  limitRow.append(limitInput);
  card.append(limitRow);
  const subheading = document.createElement('h3');
  subheading.className = 'course-display-subheading';
  subheading.textContent = '指定内容不显示';
  card.append(subheading);
  const hideHint = document.createElement('p');
  hideHint.className = 'layout-instructions';
  hideHint.textContent = '取消勾选的内容不会显示';
  card.append(hideHint);
  const choices = sectionEntryChoices(id);
  if (!choices.length) {
    const empty = document.createElement('p');
    empty.className = 'layout-instructions';
    empty.textContent = '内容加载后可逐项设置';
    card.append(empty);
  }
  const seen = new Set();
  for (const choice of choices) {
    const key = String(choice.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = document.createElement('label');
    row.className = 'course-display-choice';
    row.style.setProperty('--depth', String(choice.depth || 0));
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !settings.hiddenItems.includes(key);
    const title = document.createElement('span');
    title.textContent = choice.title || '未命名内容';
    checkbox.addEventListener('change', () => {
      const current = sectionDisplaySettings(coursePageLayout, id);
      const hidden = new Set(current.hiddenItems);
      if (checkbox.checked) hidden.delete(key);
      else hidden.add(key);
      coursePageLayout.display[id] = { ...current, hiddenItems: [...hidden] };
      saveCoursePageLayout();
      refreshCourseSectionDisplay(id);
    });
    row.append(checkbox, title);
    card.append(row);
  }
  container.append(card);
}

function openCourseItemSettings(id) {
  const fromTreeToSplit = !courseItemView.hidden && editingCourseItem === 'tree'
    && customItem(id)?.origin === 'split';
  const backButton = document.getElementById('back-course-item');
  const update = () => {
    courseItemReturnId = customItem(id)?.origin === 'split' ? 'tree' : null;
    editingCourseItem = id;
    renderCourseItemSettings();
  };
  if (fromTreeToSplit) swapViewContent(document.getElementById('course-item-settings'), update, backButton);
  else {
    update();
    showView(courseItemView, backButton);
  }
}

document.getElementById('edit-course-tree').addEventListener('click', () => {
  renderCourseSettings();
  showView(courseSettingsView, document.getElementById('back-course-settings'));
});
document.getElementById('back-course-settings').addEventListener('click', () => {
  renderCoursePage();
  showView(courseView, document.getElementById('edit-course-tree'));
});
document.getElementById('open-course-layout').addEventListener('click', () => {
  renderCourseLayoutSettings();
  showView(courseLayoutView, document.getElementById('back-course-layout'));
});
document.getElementById('open-course-recommendations').addEventListener('click', () => {
  renderCourseSettings();
  showView(courseRecommendationsView, document.getElementById('back-course-recommendations'));
});
document.getElementById('back-course-recommendations').addEventListener('click', () => {
  showView(courseSettingsView, document.getElementById('open-course-recommendations'));
});
document.getElementById('open-course-timetable-link').addEventListener('click', () => {
  renderCourseTimetableLink();
  showView(courseTimetableLinkView, document.getElementById('back-course-timetable-link'));
});
document.getElementById('back-course-timetable-link').addEventListener('click', () => {
  renderCourseSettings();
  showView(courseSettingsView, document.getElementById('open-course-timetable-link'));
});
document.getElementById('add-course-layout-item').addEventListener('click', addCustomContent);
document.getElementById('back-course-layout').addEventListener('click', () => {
  renderCourseSettings();
  showView(courseSettingsView, document.getElementById('open-course-layout'));
});
document.getElementById('back-course-item').addEventListener('click', () => {
  if (courseItemReturnId === 'tree') {
    swapViewContent(document.getElementById('course-item-settings'), () => {
      courseItemReturnId = null;
      editingCourseItem = 'tree';
      renderCourseItemSettings();
    }, document.getElementById('back-course-item'));
  } else {
    renderCourseLayoutSettings();
    showView(courseLayoutView, document.getElementById('back-course-layout'));
  }
});

const courseLayoutList = document.getElementById('course-layout-list');
courseLayoutList.addEventListener('dragstart', (event) => {
  if (event.target.closest('button, input')) return;
  draggedCourseLayout = event.target.closest('.course-layout-card');
  if (!draggedCourseLayout) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedCourseLayout.dataset.unit);
  requestAnimationFrame(() => draggedCourseLayout?.classList.add('dragging'));
});
courseLayoutList.addEventListener('dragover', (event) => {
  const target = event.target.closest('.course-layout-card');
  if (!draggedCourseLayout || !target || target === draggedCourseLayout) return;
  event.preventDefault();
  courseLayoutList.querySelectorAll('.course-layout-card').forEach((card) => card.classList.toggle('drag-over', card === target));
});
courseLayoutList.addEventListener('drop', (event) => {
  const target = event.target.closest('.course-layout-card');
  if (!draggedCourseLayout || !target || target === draggedCourseLayout) return;
  event.preventDefault();
  if ([...courseLayoutList.children].indexOf(draggedCourseLayout) < [...courseLayoutList.children].indexOf(target)) target.after(draggedCourseLayout);
  else target.before(draggedCourseLayout);
  coursePageLayout = reorderVisibleCoursePageItems(coursePageLayout,
    [...courseLayoutList.children].map((card) => card.dataset.unit), courseTreeRoots);
  saveCoursePageLayout();
  renderCoursePage();
});
courseLayoutList.addEventListener('dragend', () => {
  courseLayoutList.querySelectorAll('.course-layout-card').forEach((card) => card.classList.remove('dragging', 'drag-over'));
  draggedCourseLayout = null;
});
courseLayoutList.addEventListener('keydown', (event) => {
  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.target.closest('button, input')) return;
  const card = event.target.closest('.course-layout-card');
  const sibling = event.key === 'ArrowUp' ? card?.previousElementSibling : card?.nextElementSibling;
  if (!card || !sibling) return;
  event.preventDefault();
  if (event.key === 'ArrowUp') sibling.before(card);
  else sibling.after(card);
  coursePageLayout = reorderVisibleCoursePageItems(coursePageLayout,
    [...courseLayoutList.children].map((item) => item.dataset.unit), courseTreeRoots);
  saveCoursePageLayout();
  renderCoursePage();
  card.focus();
});

async function openCourse(course, card) {
  selectedCourse = course;
  lastCourseCard = card;
  const requestId = ++courseRequestId;
  courseTreeRoots = [];
  courseAnnouncements = [];
  coursePageLayout = reconcileCoursePageLayout();
  editingCourseItem = null;
  courseItemReturnId = null;
  document.getElementById('course-detail-name').textContent = course.name;
  document.getElementById('course-announcements-count').textContent = '…';
  document.getElementById('course-announcements-list').replaceChildren();
  document.getElementById('course-materials-count').textContent = '…';
  document.getElementById('course-materials-list').replaceChildren();
  const announcementStatus = document.getElementById('course-announcements-status');
  announcementStatus.className = 'course-detail-status';
  announcementStatus.textContent = '正在读取 Blackboard 公告…';
  const treeStatus = document.getElementById('course-materials-status');
  treeStatus.className = 'course-detail-status';
  treeStatus.textContent = '正在读取 Blackboard 内容树…';
  renderCourseAssignments(course);
  const layoutKey = coursePageStorageKey(course.id);
  const storedLayout = await chrome.storage.local.get(layoutKey).catch(() => ({}));
  if (requestId !== courseRequestId) return;
  coursePageLayout = reconcileCoursePageLayout(storedLayout[layoutKey]);
  renderCourseAssignments(course);
  renderCoursePage();
  showView(courseView, document.getElementById('back-course'));
  await Promise.all([
    (async () => {
      const cacheKey = `bb:courseAnnouncements:${course.id}`;
      const cached = await readDataCache(cacheKey, Array.isArray);
      if (requestId !== courseRequestId) return;
      if (cached) {
        renderCourseAnnouncements(cached);
        announcementStatus.textContent = '正在刷新，先显示上次的公告';
      }
      try {
        const response = await chrome.runtime.sendMessage({ type: 'bb.courseAnnouncements', courseId: course.id });
        if (requestId !== courseRequestId) return;
        if (!response?.ok || !Array.isArray(response.data)) throw new Error(response?.error ?? '公告数据无效');
        renderCourseAnnouncements(response.data);
        announcementStatus.textContent = '';
        try { await saveDataCache(cacheKey, response.data); }
        catch {
          if (requestId === courseRequestId) announcementStatus.textContent = '公告已更新（本地保存失败）';
        }
      } catch (error) {
        if (requestId !== courseRequestId) return;
        if (!cached) document.getElementById('course-announcements-count').textContent = '—';
        announcementStatus.classList.add('error');
        announcementStatus.textContent = cached ? `刷新失败（${error.message}），显示的是上次的公告` : `公告读取失败：${error.message}`;
      }
    })(),
    (async () => {
      const cacheKey = `bb:courseMaterials:${course.id}`;
      const cached = await readDataCache(cacheKey, Array.isArray);
      if (requestId !== courseRequestId) return;
      if (cached) {
        applyCourseMaterials(cached);
        treeStatus.textContent = '正在刷新，先显示上次的内容树';
      }
      try {
        const response = await chrome.runtime.sendMessage({ type: 'bb.courseMaterials', courseId: course.id });
        if (requestId !== courseRequestId) return;
        if (!response?.ok || !Array.isArray(response.data)) throw new Error(response?.error ?? '内容树数据无效');
        applyCourseMaterials(response.data, true);
        treeStatus.textContent = '';
        try { await saveDataCache(cacheKey, response.data); }
        catch {
          if (requestId === courseRequestId) treeStatus.textContent = '内容树已更新（本地保存失败）';
        }
      } catch (error) {
        if (requestId !== courseRequestId) return;
        if (!cached) document.getElementById('course-materials-count').textContent = '—';
        treeStatus.classList.add('error');
        treeStatus.textContent = cached ? `刷新失败（${error.message}），显示的是上次的内容树` : `内容树读取失败：${error.message}`;
      }
    })(),
  ]);
}

function renderCourses() {
  document.getElementById('courses-count').textContent = String(courses.length);
  courseList.replaceChildren();
  if (!courses.length) {
    const empty = document.createElement('p');
    empty.className = 'courses-empty';
    empty.textContent = overviewLoaded ? '暂未识别出本学期课程' : '尚未加载课程';
    courseList.append(empty);
    return;
  }
  for (const course of courses) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'course-card';
    row.setAttribute('aria-label', `查看课程：${course.name}`);
    row.addEventListener('click', () => openCourse(course, row));
    const mark = document.createElement('span');
    mark.className = 'course-mark';
    mark.style.setProperty('--course-color', courseColor(course.name));
    const name = document.createElement('span');
    name.textContent = course.name;
    const chevron = document.createElement('span');
    chevron.className = 'course-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    row.append(mark, name, chevron);
    courseList.append(row);
  }
}

function openCourseAssociation(lesson, card, link) {
  lastAssociationCard = card;
  lastAssociationLink = link;
  const semester = timetable?.filename ?? timetable?.semester ?? '';
  document.getElementById('course-association-name').textContent = lesson.name;
  const list = document.getElementById('course-association-list');
  const status = document.getElementById('course-association-status');
  status.textContent = '';
  list.replaceChildren();
  if (!courses.length) {
    const empty = document.createElement('p');
    empty.className = 'courses-empty';
    empty.textContent = '当前没有可关联的 Blackboard 课程';
    list.append(empty);
  }
  let saving = false;
  for (const course of courses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'course-card';
    button.setAttribute('aria-label', `关联到：${course.name}`);
    const mark = document.createElement('span');
    mark.className = 'course-mark';
    mark.style.setProperty('--course-color', courseColor(course.name));
    const name = document.createElement('span');
    name.textContent = course.name;
    button.append(mark, name);
    button.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      status.textContent = '正在保存关联…';
      const next = { ...courseAssociations, [courseAssociationKey(semester, lesson.name)]: course.id };
      try {
        await chrome.storage.local.set({ eazybb_course_associations: next });
        courseAssociations = next;
        timetableStatus.className = 'timetable-status';
        timetableStatus.textContent = `已将“${lesson.name}”关联到“${course.name}”`;
        renderNavigation();
        openCourse(course, card);
      } catch (error) {
        status.textContent = `保存课程关联失败：${error.message}`;
      } finally {
        saving = false;
      }
    });
    list.append(button);
  }
  showView(courseAssociationView, document.getElementById('back-course-association'));
}

function showCourseAssociationPrompt(lesson, card) {
  timetableStatus.className = 'timetable-status has-association-link';
  const message = document.createElement('span');
  message.textContent = `Blackboard 中未找到“${lesson.name}”的对应课程`;
  const link = document.createElement('a');
  link.href = '#course-association-view';
  link.className = 'timetable-association-link';
  link.textContent = '关联课程';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openCourseAssociation(lesson, card, link);
  });
  timetableStatus.replaceChildren(message, link);
}

async function openLessonCourse(lesson, card) {
  await courseAssociationsReady;
  const course = resolveBlackboardCourse(lesson.name, courses, courseAssociations,
    timetable?.filename ?? timetable?.semester ?? '');
  if (course) return openCourse(course, card);
  if (overviewLoaded) showCourseAssociationPrompt(lesson, card);
  else {
    timetableStatus.className = 'timetable-status';
    timetableStatus.textContent = 'Blackboard 课程仍在加载，请稍后再试';
  }
  if (card.closest('.navigation-card')) timetableStatus.scrollIntoView({ block: 'center' });
}

function createNavigationCourseSection(course, id, layout, roots, announcements, lessonKey, maxCount) {
  const item = layout.customs.find((entry) => entry.id === id);
  const previewLayout = { ...layout,
    treeNodeDisplay: layout.recommendedTreeNodeDisplayByLesson?.[lessonKey]?.[id] ?? {} };
  let entries;
  if (id === 'announcements') entries = announcements;
  else if (id === 'assignments') entries = courseAssignmentItems(course);
  else if (id === 'tree') entries = roots;
  else if (item) entries = customSectionEntries(item, roots, previewLayout);
  else return null;
  const visible = lessonPreviewItems(entries, lessonPreviewSettings(layout, lessonKey, id))
    .slice(0, maxCount);
  const section = document.createElement('section');
  section.className = 'navigation-course-section';
  const heading = document.createElement('button');
  heading.type = 'button';
  heading.className = 'navigation-course-heading';
  heading.textContent = `${item?.title || layout.titles[id] || COURSE_LABELS[id]} ›`;
  heading.addEventListener('click', async () => {
    await openCourse(course, heading);
    if (selectedCourse?.id !== course.id) return;
    [...document.querySelectorAll('#course-sections > section')]
      .find((entry) => entry.dataset.courseSection === id)?.scrollIntoView({ block: 'start' });
  });
  section.append(heading);
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'navigation-course-empty';
    empty.textContent = '暂无可显示内容';
    section.append(empty);
  }
  for (const entry of visible) {
    if (id === 'announcements') section.append(createAnnouncementCard(entry));
    else if (id === 'assignments') section.append(createAssignmentCard(entry));
    else {
      section.append(createContentTreeNode(entry.node || entry, true, entry.own === true,
        entry.own !== true, previewLayout));
    }
  }
  return section;
}

async function navigationCourseData(courseId, type) {
  const cacheKey = `bb:${type}:${courseId}`;
  let saved;
  try { saved = (await chrome.storage.local.get(cacheKey))[cacheKey]; }
  catch { /* Fetch the current data below. */ }
  const cached = Array.isArray(saved?.data) ? saved.data : null;
  const refreshMinutes = REFRESH_OPTIONS[Number(refreshSlider.value)]?.minutes ?? 5;
  if (cached && Number.isFinite(saved.savedAt)
    && Date.now() - saved.savedAt < refreshMinutes * 60_000) return cached;
  try {
    const response = await chrome.runtime.sendMessage({ type: `bb.${type}`, courseId });
    if (!response?.ok || !Array.isArray(response.data)) return cached ?? [];
    await saveDataCache(cacheKey, response.data).catch(() => {});
    return response.data;
  } catch {
    return cached ?? [];
  }
}

function renderNavigation() {
  const requestId = ++navigationRenderId;
  const now = new Date();
  const parts = chinaParts(now);
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const hasTimetable = Array.isArray(timetable?.allLessons) || Array.isArray(timetable?.lessons);
  const visibleAssignments = homeAssignments(assignments, favoriteAssignments,
    assignmentPreferences, dayKeyAtOffset);
  const item = chooseNavigationItem(timetable?.allLessons ?? timetable?.lessons ?? [],
    visibleAssignments, day, minuteOfDay, now, classTimes);
  const showAssignmentFallback = item.type !== 'course';
  const nextAssignments = showAssignmentFallback
    ? visibleAssignments.filter((assignment) => assignment.completed !== true).slice(0, 2) : [];
  const content = document.getElementById('navigation-content');
  const files = document.getElementById('navigation-files');
  content.replaceChildren();
  files.replaceChildren();
  files.classList.toggle('is-assignments', showAssignmentFallback && nextAssignments.length > 0);
  const kicker = document.createElement('p');
  kicker.className = 'navigation-kicker';
  const main = document.createElement(showAssignmentFallback ? 'div' : 'button');
  if (!showAssignmentFallback) main.type = 'button';
  main.className = 'navigation-main';
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  if (showAssignmentFallback) {
    kicker.textContent = '今日课程';
    title.textContent = hasTimetable ? '今天已经没有课了' : '尚未接入课程表哦';
    for (const assignment of nextAssignments) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'navigation-file navigation-task';
      card.setAttribute('aria-label', `查看作业：${assignment.title}`);
      const icon = document.createElement('span');
      icon.className = 'navigation-file-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h12M9 12h12M9 18h12M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/></svg>';
      const label = document.createElement('strong');
      label.textContent = assignment.title;
      const courseName = document.createElement('small');
      courseName.textContent = assignment.course;
      const due = document.createElement('small');
      due.textContent = `${new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(assignment.due)} 截止`;
      card.append(icon, label, courseName, due);
      card.addEventListener('click', () => openAssignment(assignment, card));
      files.append(card);
    }
  } else if (item.type === 'course') {
    kicker.textContent = item.state === 'ongoing' ? '正在上课' : '即将开始';
    title.textContent = item.lesson.name;
    detail.textContent = `${lessonTimeRange(item.lesson, classTimes)}${item.lesson.location ? ` · ${item.lesson.location}` : ''}`;
    main.addEventListener('click', () => openLessonCourse(item.lesson, main));
    courseAssociationsReady.then(async () => {
      const course = resolveBlackboardCourse(item.lesson.name, courses, courseAssociations,
        timetable?.filename ?? timetable?.semester ?? '');
      if (!course) return;
      let saved;
      try { saved = (await chrome.storage.local.get(coursePageStorageKey(course.id)))[coursePageStorageKey(course.id)]; }
      catch { return; }
      if (requestId !== navigationRenderId) return;
      const roots = selectedCourse?.id === course.id && courseTreeRoots.length ? courseTreeRoots
        : await navigationCourseData(course.id, 'courseMaterials');
      if (requestId !== navigationRenderId) return;
      const announcements = selectedCourse?.id === course.id && courseAnnouncements.length ? courseAnnouncements
        : await navigationCourseData(course.id, 'courseAnnouncements');
      if (requestId !== navigationRenderId) return;
      const layout = selectedCourse?.id === course.id && coursePageLayout
        ? coursePageLayout : reconcileCoursePageLayout(saved, roots);
      const displayed = new Set([...visibleCoursePageOrder(layout, roots ?? []),
        ...visibleSplitOrder(layout, roots ?? [])]);
      const semester = timetable?.filename ?? timetable?.semester ?? '';
      const timetableKey = courseAssociationKey(semester, item.lesson.name);
      const lessonKey = lessonRecommendationKey(semester, item.lesson);
      let remaining = 2;
      for (const id of recommendedForLesson(layout, lessonKey, timetableKey)
        .filter((entry) => displayed.has(entry))) {
        if (id === 'tree' && layout.splitTree) continue;
        if (remaining <= 0) break;
        const preview = lessonPreviewSettings(layout, lessonKey, id);
        const section = createNavigationCourseSection(course, id, layout, roots ?? [],
          announcements ?? [], lessonKey, remaining);
        if (!section) continue;
        files.append(section);
        remaining -= Math.min(remaining, preview.count);
      }
    });
  }
  main.append(title, detail);
  content.append(kicker, main);
}

function renderTimetable() {
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const hasFullSchedule = Array.isArray(timetable?.allLessons)
    && /^\d{4}-\d{2}-\d{2}$/.test(timetable?.firstWeekStart ?? '')
    && /^\d{4}-\d{2}-\d{2}$/.test(timetable?.lastWeekStart ?? '');
  if (hasFullSchedule) {
    if (selectedTimetableWeekStart < timetable.firstWeekStart) selectedTimetableWeekStart = timetable.firstWeekStart;
    if (selectedTimetableWeekStart > timetable.lastWeekStart) selectedTimetableWeekStart = timetable.lastWeekStart;
  }
  const weekEnd = addDays(selectedTimetableWeekStart, 6);
  const weekLessons = (hasFullSchedule
    ? timetable.allLessons.filter((lesson) => selectedTimetableWeekStart <= lesson.date && lesson.date <= weekEnd)
    : timetable?.lessons ?? []).filter((lesson) => Number.isInteger(lesson.periodStart)
      && Number.isInteger(lesson.periodEnd) && Boolean(classTimes[lesson.periodStart])
      && lesson.periodEnd >= lesson.periodStart && Boolean(classTimes[lesson.periodEnd]));
  const weekNumber = hasFullSchedule
    ? 1 + Math.floor(diffDays(timetable.firstWeekStart, selectedTimetableWeekStart) / 7)
    : timetable?.week;
  document.getElementById('timetable-week').textContent = weekNumber > 0 ? `第 ${weekNumber} 周` : '本周';
  const startMonth = Number(selectedTimetableWeekStart.slice(5, 7));
  const startDay = Number(selectedTimetableWeekStart.slice(8, 10));
  const endMonth = Number(weekEnd.slice(5, 7));
  const endDay = Number(weekEnd.slice(8, 10));
  document.getElementById('timetable-range').textContent = `${startMonth}.${startDay} — ${endMonth}.${endDay}`;
  document.getElementById('previous-timetable-week').disabled = !hasFullSchedule
    || selectedTimetableWeekStart <= timetable.firstWeekStart;
  document.getElementById('next-timetable-week').disabled = !hasFullSchedule
    || selectedTimetableWeekStart >= timetable.lastWeekStart;
  document.getElementById('current-timetable-week').disabled = !hasFullSchedule
    || currentTimetableWeekStart < timetable.firstWeekStart
    || currentTimetableWeekStart > timetable.lastWeekStart
    || selectedTimetableWeekStart === currentTimetableWeekStart;
  timetableDays.replaceChildren();
  for (const [index, label] of days.entries()) {
    const date = addDays(selectedTimetableWeekStart, index);
    const count = weekLessons.filter((lesson) => hasFullSchedule ? lesson.date === date : lesson.day === index + 1).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timetable-day';
    const weekday = document.createElement('span');
    weekday.className = 'timetable-day-name';
    weekday.textContent = label;
    const number = document.createElement('strong');
    number.className = 'timetable-day-date';
    number.textContent = String(Number(date.slice(8, 10)));
    const dot = document.createElement('i');
    dot.className = 'timetable-day-dot';
    dot.classList.toggle('is-empty', count === 0);
    button.append(weekday, number, dot);
    button.setAttribute('aria-label', `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日，星期${label}${count ? `，${count} 节课` : ''}`);
    button.setAttribute('aria-pressed', String(selectedTimetableDay === index + 1));
    if (date === dateKey(today)) button.setAttribute('aria-current', 'date');
    button.addEventListener('click', () => {
      selectedTimetableDay = index + 1;
      renderTimetable();
    });
    timetableDays.append(button);
  }
  exportTimetableButton.disabled = !timetable?.ics;
  timetableList.replaceChildren();
  const lessons = weekLessons.filter((lesson) => lesson.day === selectedTimetableDay);
  if (!lessons.length) {
    const empty = document.createElement('p');
    empty.className = 'timetable-empty';
    empty.textContent = timetable ? '这一天没有课程' : '尚未加载课程表';
    timetableList.append(empty);
    return;
  }
  for (const lesson of lessons) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'timetable-lesson';
    row.setAttribute('aria-label', `查看课程：${lesson.name}，${lessonTimeRange(lesson, classTimes)}`);
    row.addEventListener('click', () => openLessonCourse(lesson, row));
    row.style.setProperty('--course-color', courseColor(lesson.name));
    const period = document.createElement('div');
    period.className = 'timetable-period';
    const periodNumber = document.createElement('strong');
    periodNumber.textContent = lesson.periodStart === lesson.periodEnd
      ? String(lesson.periodStart) : `${lesson.periodStart}–${lesson.periodEnd}`;
    const periodUnit = document.createElement('small');
    periodUnit.textContent = '节';
    period.append(periodNumber, periodUnit);
    const copy = document.createElement('div');
    copy.className = 'timetable-lesson-copy';
    const name = document.createElement('strong');
    name.textContent = lesson.name;
    copy.append(name);
    const clock = document.createElement('span');
    clock.className = 'timetable-clock';
    clock.textContent = lessonTimeRange(lesson, classTimes);
    copy.append(clock);
    const meta = [lesson.location, lesson.teacher].filter(Boolean).join(' · ');
    if (meta) {
      const details = document.createElement('small');
      details.textContent = meta;
      copy.append(details);
    }
    row.append(period, copy);
    timetableList.append(row);
  }
}

document.getElementById('previous-timetable-week').addEventListener('click', () => {
  selectedTimetableWeekStart = addDays(selectedTimetableWeekStart, -7);
  renderTimetable();
});
document.getElementById('next-timetable-week').addEventListener('click', () => {
  selectedTimetableWeekStart = addDays(selectedTimetableWeekStart, 7);
  renderTimetable();
});
document.getElementById('current-timetable-week').addEventListener('click', () => {
  selectedTimetableWeekStart = currentTimetableWeekStart;
  selectedTimetableDay = (today.getDay() + 6) % 7 + 1;
  renderTimetable();
});

exportTimetableButton.addEventListener('click', () => {
  if (!timetable?.ics) return;
  const ics = Array.isArray(timetable.allLessons)
    ? lessonsToIcal(timetable.allLessons, classTimes) : retimeIcal(timetable.ics);
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = timetable.filename || 'EazyBB-课程表.ics';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function loadTimetable() {
  await classTimesReady;
  if (timetableLoading) return;
  const startedAtVersion = timetableChangeVersion;
  timetableLoading = true;
  refreshTimetableButton.disabled = true;
  timetableStatus.className = 'timetable-status';
  timetableStatus.textContent = timetable
    ? '正在刷新…'
    : '正在读取 TIS 课程表…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'tis.timetable' });
    if (startedAtVersion !== timetableChangeVersion) return;
    if (!response?.ok) throw new Error(response?.error ?? '读取课程表失败');
    if (!Array.isArray(response.data?.lessons) || !Array.isArray(response.data?.allLessons)
      || !/^\d{4}-\d{2}-\d{2}$/.test(response.data?.firstWeekStart ?? '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(response.data?.lastWeekStart ?? '')) {
      throw new Error('课程表数据格式无效');
    }
    const allLessons = remapSourceLessons(response.data.allLessons, tisPeriodMap);
    const lessons = remapSourceLessons(response.data.lessons, tisPeriodMap);
    timetable = { ...response.data, source: 'tis', allLessons, lessons,
      ics: lessonsToIcal(allLessons, classTimes) };
    renderTimetable();
    renderNavigation();
    renderCourseSettings();
    timetableStatus.textContent = `${timetable.semester} · 已载入整学期课程`;
    try {
      await persistTimetable(timetable);
    } catch {
      timetableStatus.textContent += '（本地保存失败）';
    }
  } catch (error) {
    if (startedAtVersion !== timetableChangeVersion) return;
    timetableStatus.className = 'timetable-status error';
    timetableStatus.textContent = timetable
      ? `刷新失败（${error.message}），显示的是上次的课程表`
      : `课程表读取失败：${error.message}`;
  } finally {
    timetableLoading = false;
    refreshTimetableButton.disabled = false;
    renderTimetableSettings();
  }
}

const timetableSettingsFeedback = document.getElementById('timetable-settings-feedback');
const timetableLessonForm = document.getElementById('timetable-lesson-form');
const timetableWeekdays = ['一', '二', '三', '四', '五', '六', '日'];
const timetableActionIcons = {
  edit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 3h4l1 4H9l1-4ZM6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>',
};

function setTimetableActionIcon(button, icon, label) {
  button.className = `timetable-icon-button${icon === 'delete' ? ' is-delete' : ''}`;
  button.innerHTML = timetableActionIcons[icon];
  button.setAttribute('aria-label', label);
  button.title = label;
}

function persistTimetable(snapshot) {
  timetableWrite = timetableWrite.catch(() => {}).then(() => snapshot
    ? chrome.storage.local.set({ eazybb_timetable_cache: snapshot })
    : chrome.storage.local.remove('eazybb_timetable_cache'));
  return timetableWrite;
}

function timetableFormField(name) {
  return timetableLessonForm.elements.namedItem(name);
}

function appendClassTimeRow(startValue = '', endValue = '', originalPeriod = null) {
  const timesList = document.getElementById('timetable-class-times');
  const row = document.createElement('div');
  row.className = 'timetable-class-time-row';
  if (originalPeriod !== null) row.dataset.originalPeriod = String(originalPeriod);
  const title = document.createElement('strong');
  title.textContent = originalPeriod === null ? '新课节' : `第 ${originalPeriod} 节`;
  const start = document.createElement('input');
  start.type = 'time';
  start.value = startValue;
  start.dataset.bound = 'start';
  start.setAttribute('aria-label', `${title.textContent}开始时间`);
  const separator = document.createElement('span');
  separator.textContent = '—';
  const end = document.createElement('input');
  end.type = 'time';
  end.value = endValue;
  end.dataset.bound = 'end';
  end.setAttribute('aria-label', `${title.textContent}结束时间`);
  const remove = document.createElement('button');
  remove.type = 'button';
  setTimetableActionIcon(remove, 'delete', `删除${title.textContent}`);
  remove.addEventListener('click', () => {
    if (timesList.children.length <= 1) {
      timetableSettingsFeedback.textContent = '至少保留 1 节课';
      return;
    }
    row.remove();
    document.getElementById('settings-add-class-time').disabled = false;
    timetableSettingsFeedback.textContent = '点击“保存时间”后生效';
  });
  row.append(title, start, separator, end, remove);
  timesList.append(row);
  return row;
}

function renderTimetableSettings() {
  const groups = courseGroups(timetable?.allLessons ?? []);
  document.getElementById('timetable-settings-summary').textContent = timetable
    ? `${groups.length} 门课程 · ${timetable.source === 'ics' ? 'ICS 导入' : timetable.source === 'tis' ? 'TIS' : '本地编辑'}`
    : '尚未接入';
  document.getElementById('timetable-settings-source').textContent = timetable
    ? `${timetable.semester || '课程表'} · ${groups.length} 门课程` : '尚未加载课程表';
  document.getElementById('settings-fetch-timetable').textContent = timetable ? '从 TIS 刷新' : '从 TIS 获取';
  document.getElementById('settings-delete-timetable').disabled = !timetable;
  const list = document.getElementById('timetable-settings-lessons');
  list.replaceChildren();
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'timetable-settings-empty';
    empty.textContent = '暂无课程，可从 TIS 获取、导入 ICS 或手动添加。';
    list.append(empty);
  }
  for (const course of groups) {
    const row = document.createElement('div');
    row.className = 'timetable-settings-lesson';
    const header = document.createElement('div');
    header.className = 'timetable-settings-course-header';
    const name = document.createElement('strong');
    name.textContent = course.name;
    const removeCourse = document.createElement('button');
    removeCourse.type = 'button';
    setTimetableActionIcon(removeCourse, 'delete', `删除课程 ${course.name}`);
    removeCourse.addEventListener('click', async () => {
      if (!confirm(`删除“${course.name}”的全部课程时间？`)) return;
      try {
        const removed = new Set(course.slots.flatMap((slot) => slot.items));
        const remaining = (timetable?.allLessons ?? []).filter((lesson) => !removed.has(lesson));
        await saveEditedTimetable(remaining);
        timetableSettingsFeedback.textContent = '课程已删除';
      } catch (error) { timetableSettingsFeedback.textContent = `删除失败：${error.message}`; }
    });
    header.append(name, removeCourse);
    row.append(header);
    const slots = document.createElement('div');
    slots.className = 'timetable-settings-slots';
    for (const group of course.slots) {
      const slot = document.createElement('div');
      slot.className = 'timetable-settings-slot';
      const copy = document.createElement('div');
      const meta = document.createElement('small');
      meta.textContent = `周${timetableWeekdays[group.lesson.regularDay - 1]} · 第 ${group.lesson.periodStart}${group.lesson.periodEnd === group.lesson.periodStart ? '' : `–${group.lesson.periodEnd}`} 节 · ${lessonTimeRange(group.lesson, classTimes)}`;
      copy.append(meta);
      if (group.lesson.location) {
        const place = document.createElement('small');
        place.textContent = group.lesson.location;
        copy.append(place);
      }
      const actions = document.createElement('div');
      actions.className = 'timetable-settings-lesson-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      setTimetableActionIcon(edit, 'edit', `编辑 ${course.name} 的周${timetableWeekdays[group.lesson.regularDay - 1]}课程`);
      edit.addEventListener('click', () => openTimetableLessonForm(group));
      const remove = document.createElement('button');
      remove.type = 'button';
      setTimetableActionIcon(remove, 'delete', `删除 ${course.name} 的周${timetableWeekdays[group.lesson.regularDay - 1]}课程时段`);
      remove.addEventListener('click', async () => {
        if (!confirm(`删除“${course.name}”的这一上课时段？`)) return;
        try {
          const removed = new Set(group.items);
          const remaining = (timetable?.allLessons ?? []).filter((lesson) => !removed.has(lesson));
          await saveEditedTimetable(remaining);
          timetableSettingsFeedback.textContent = '课程时段已删除';
        } catch (error) { timetableSettingsFeedback.textContent = `删除失败：${error.message}`; }
      });
      actions.append(edit, remove);
      slot.append(copy, actions);
      slots.append(slot);
    }
    row.append(slots);
    list.append(row);
  }
  const timesList = document.getElementById('timetable-class-times');
  timesList.replaceChildren();
  for (const [period, time] of Object.entries(classTimes)) {
    appendClassTimeRow(time.start, time.end, Number(period));
  }
  document.getElementById('settings-add-class-time').disabled = timesList.children.length >= MAX_CLASS_PERIODS;
}

async function saveEditedTimetable(lessons, source = 'custom', previous = timetable) {
  const next = makeEditableTimetable(lessons, previous, source, classTimes);
  timetableChangeVersion += 1;
  await persistTimetable(next);
  timetable = next;
  timetableStatus.className = 'timetable-status';
  timetableStatus.textContent = `${source === 'ics' ? '已导入 ICS' : '本地课程表已保存'} · ${next.allLessons.length} 次课程`;
  renderTimetable();
  renderNavigation();
  renderCourseSettings();
  renderTimetableSettings();
}

function openTimetableLessonForm(group = null) {
  timetableLessonForm.reset();
  timetableLessonForm.hidden = false;
  timetableLessonForm.dataset.groupKey = group?.key || '';
  document.getElementById('timetable-lesson-form-title').textContent = group ? '编辑课程' : '添加课程';
  const currentMonday = addDays(dateKey(today), -weekdayOf(dateKey(today)));
  const firstDate = group?.dates[0] || timetable?.firstWeekStart || currentMonday;
  const lastDate = group?.dates.at(-1) || (timetable?.lastWeekStart && addDays(timetable.lastWeekStart, 6))
    || addDays(currentMonday, 15 * 7 + 6);
  timetableFormField('name').value = group?.lesson.name || '';
  timetableFormField('day').value = String(group?.lesson.regularDay || 1);
  timetableFormField('periodStart').value = String(group?.lesson.periodStart || 1);
  timetableFormField('periodEnd').value = String(group?.lesson.periodEnd || 1);
  timetableFormField('periodStart').max = String(Object.keys(classTimes).length);
  timetableFormField('periodEnd').max = String(Object.keys(classTimes).length);
  timetableFormField('firstDate').value = firstDate;
  timetableFormField('lastDate').value = lastDate;
  timetableFormField('startTime').value = group?.lesson.startTime || '';
  timetableFormField('endTime').value = group?.lesson.endTime || '';
  timetableFormField('location').value = group?.lesson.location || '';
  timetableFormField('teacher').value = group?.lesson.teacher || '';
  timetableFormField('name').focus();
}

document.getElementById('settings-add-lesson').addEventListener('click', () => openTimetableLessonForm());
document.getElementById('settings-cancel-lesson').addEventListener('click', () => { timetableLessonForm.hidden = true; });
timetableLessonForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const value = (name) => String(timetableFormField(name).value).trim();
    const day = Number(value('day'));
    const periodStart = Number(value('periodStart'));
    const periodEnd = Number(value('periodEnd'));
    const firstDate = value('firstDate');
    const lastDate = value('lastDate');
    const startTime = value('startTime');
    const endTime = value('endTime');
    if (!value('name') || firstDate > lastDate || !Number.isInteger(day) || day < 1 || day > 7
      || !Number.isInteger(periodStart) || !classTimes[periodStart]
      || !Number.isInteger(periodEnd) || periodEnd < periodStart || !classTimes[periodEnd]) {
      throw new Error('请检查课程名称、日期和节次');
    }
    if ((startTime && !endTime) || (!startTime && endTime) || (startTime && startTime >= endTime)) {
      throw new Error('请填写有效的开始和结束时间，或两项都留空');
    }
    const previousGroup = lessonGroups(timetable?.allLessons ?? [])
      .find((group) => group.key === timetableLessonForm.dataset.groupKey);
    const removed = new Set(previousGroup?.items || []);
    const remaining = (timetable?.allLessons ?? []).filter((lesson) => !removed.has(lesson));
    const dates = previousGroup && previousGroup.dates[0] === firstDate
      && previousGroup.dates.at(-1) === lastDate && previousGroup.lesson.regularDay === day
      ? previousGroup.dates : [];
    if (!dates.length) {
      let date = addDays(firstDate, (day - 1 - weekdayOf(firstDate) + 7) % 7);
      while (date <= lastDate && dates.length < 52) {
        dates.push(date);
        date = addDays(date, 7);
      }
    }
    if (!dates.length) throw new Error('所选日期范围内没有对应星期的课程');
    const additions = dates.map((date) => ({ date, day: weekdayOf(date) + 1, regularDay: day,
      name: value('name'), periodStart, periodEnd,
      location: value('location'), teacher: value('teacher'),
      ...(startTime ? { startTime, endTime } : {}) }));
    await saveEditedTimetable([...remaining, ...additions]);
    timetableLessonForm.hidden = true;
    timetableSettingsFeedback.textContent = previousGroup ? '课程已更新' : '课程已添加';
  } catch (error) { timetableSettingsFeedback.textContent = `保存失败：${error.message}`; }
});

document.getElementById('settings-add-class-time').addEventListener('click', () => {
  const row = appendClassTimeRow();
  row.querySelector('input').focus();
  document.getElementById('settings-add-class-time').disabled =
    document.getElementById('timetable-class-times').children.length >= MAX_CLASS_PERIODS;
});

document.getElementById('settings-save-class-times').addEventListener('click', async () => {
  try {
    await classTimesReady;
    const draft = [...document.querySelectorAll('#timetable-class-times .timetable-class-time-row')]
      .map((row) => ({ originalPeriod: row.dataset.originalPeriod,
        start: row.querySelector('[data-bound="start"]').value,
        end: row.querySelector('[data-bound="end"]').value }));
    const change = prepareClassTimeChange(draft, classTimes, timetable?.allLessons ?? []);
    const nextTisPeriodMap = Object.fromEntries(Object.entries(tisPeriodMap)
      .filter(([, period]) => change.periodMap[period])
      .map(([sourcePeriod, period]) => [sourcePeriod, change.periodMap[period]]));
    const nextTimetable = timetable && { ...timetable,
      allLessons: change.lessons,
      lessons: change.lessons.filter((lesson) => currentTimetableWeekStart <= lesson.date
        && lesson.date <= addDays(currentTimetableWeekStart, 6)),
      ics: lessonsToIcal(change.lessons, change.times) };
    timetableChangeVersion += 1;
    timetableWrite = timetableWrite.catch(() => {}).then(() => chrome.storage.local.set({
      eazybb_class_times: change.times,
      eazybb_tis_period_map: nextTisPeriodMap,
      ...(nextTimetable ? { eazybb_timetable_cache: nextTimetable } : {}),
    }));
    await timetableWrite;
    classTimes = change.times;
    tisPeriodMap = nextTisPeriodMap;
    if (nextTimetable) timetable = nextTimetable;
    renderTimetable();
    renderNavigation();
    renderCourseSettings();
    renderTimetableSettings();
    timetableSettingsFeedback.textContent = '已保存，课节已按时间重新编号';
  } catch (error) { timetableSettingsFeedback.textContent = `保存失败：${error.message}`; }
});

document.getElementById('settings-fetch-timetable').addEventListener('click', async () => {
  timetableSettingsFeedback.textContent = '正在从 TIS 获取课程表…';
  await loadTimetable();
  timetableSettingsFeedback.textContent = timetableStatus.textContent;
});
document.getElementById('settings-import-timetable').addEventListener('click', () => {
  document.getElementById('settings-import-timetable-file').click();
});
document.getElementById('settings-import-timetable-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('ICS 文件超过 5 MB');
    const imported = importIcsLessons(await file.text(), classTimes);
    if (timetable && !confirm(`导入 ${imported.length} 次课程并替换当前课程表？`)) return;
    await saveEditedTimetable(imported, 'ics', null);
    timetable.filename = file.name;
    await persistTimetable(timetable);
    timetableSettingsFeedback.textContent = `已导入 ${imported.length} 次课程`;
  } catch (error) { timetableSettingsFeedback.textContent = `导入失败：${error.message}`; }
});
document.getElementById('settings-delete-timetable').addEventListener('click', async () => {
  if (!timetable || !confirm('删除本地课程表？此操作不会删除 TIS 中的课程。')) return;
  try {
    timetableChangeVersion += 1;
    await persistTimetable(null);
    timetable = null;
    renderTimetable();
    renderNavigation();
    renderCourseSettings();
    renderTimetableSettings();
    timetableStatus.className = 'timetable-status';
    timetableStatus.textContent = '点击刷新按钮加载 TIS 课程表';
    timetableSettingsFeedback.textContent = '本地课程表已删除';
  } catch (error) { timetableSettingsFeedback.textContent = `删除失败：${error.message}`; }
});

const classTimesReady = chrome.storage.local.get(['eazybb_class_times', 'eazybb_tis_period_map']).then(({
  eazybb_class_times: saved, eazybb_tis_period_map: savedMap,
}) => {
  classTimes = normalizeClassTimes(saved);
  if (savedMap && typeof savedMap === 'object') {
    tisPeriodMap = Object.fromEntries(Object.entries(savedMap)
      .filter(([source, period]) => Number.isInteger(Number(source)) && Number(source) >= 1
        && Number(source) <= Object.keys(DEFAULT_CLASS_TIMES).length
        && Number.isInteger(Number(period)) && Boolean(classTimes[Number(period)]))
      .map(([source, period]) => [source, Number(period)]));
  }
  renderTimetable();
  renderNavigation();
  renderTimetableSettings();
}).catch(() => {});

function refreshHomeData() {
  loadOverview();
}

function applyOverview(data) {
  if (!Array.isArray(data?.assignments)) throw new Error('作业数据格式无效');
  if (data.courses !== undefined && !Array.isArray(data.courses)) throw new Error('课程数据格式无效');
  const currentCourseIds = new Set((data.courses ?? []).map((course) => course.id));
  const previous = new Map(assignments.map((item) => [item.id, item.bbCompleted]));
  const nextAssignments = data.assignments.filter((item) => currentCourseIds.has(item.courseId)).map((item) => {
    const due = new Date(item.due);
    if (!Number.isFinite(due.getTime())) throw new Error('作业截止时间无效');
    const completion = resolveAssignmentCompletion(item, completionOverrides, previous.get(item.id) ?? null);
    return { ...item, ...completion, due, dayKey: chinaDayKey(due) };
  });
  assignments = nextAssignments;
  courses = data.courses ?? [];
  overviewLoaded = true;
  renderCalendar();
  renderSelectedDay();
  renderAssignments();
  renderAllAssignments();
  renderCourses();
  renderNavigation();
  if (selectedCourse) renderCourseAssignments(selectedCourse);
  return { ...data, assignments: nextAssignments.map(({ due, dayKey, ...item }) => ({ ...item, due: due.toISOString() })) };
}

function saveOverviewCache(data) {
  const cache = { savedAt: Date.now(), data };
  cacheWrite = cacheWrite.catch(() => {}).then(() => chrome.storage.local.set({ eazybb_overview_cache: cache }));
  return cacheWrite;
}

async function loadOverview() {
  const requestId = ++overviewRequestId;
  refreshButton.disabled = true;
  refreshButton.setAttribute('aria-busy', 'true');
  setOverviewStatus(overviewLoaded
    ? '正在刷新…'
    : '正在读取 Blackboard 课程与作业…');
  try {
    await assignmentSettingsReady;
    const response = await chrome.runtime.sendMessage({ type: 'bb.overview' });
    if (requestId !== overviewRequestId) return;
    if (!response?.ok) throw new Error(response?.error ?? '读取失败');
    const cacheData = applyOverview(response.data);
    if (response.data.failedCourses) {
      setOverviewStatus(`已连接 ${response.data.account} · ${response.data.failedCourses} 门课程暂时无法读取`, 'warning');
    } else {
      setOverviewStatus(`已连接 Blackboard · ${response.data.account}`, 'success');
    }
    try {
      await saveOverviewCache(cacheData);
    } catch {
      if (requestId === overviewRequestId) setOverviewStatus(`${overviewStatus.textContent}（本地保存失败）`, 'warning');
    }
  } catch (error) {
    if (requestId !== overviewRequestId) return;
    setOverviewStatus(overviewLoaded
      ? `刷新失败（${error.message}），显示的是上次的数据`
      : error.message, 'error');
  } finally {
    if (requestId === overviewRequestId) {
      refreshButton.disabled = false;
      refreshButton.removeAttribute('aria-busy');
    }
  }
}

refreshButton.addEventListener('click', refreshHomeData);
refreshTimetableButton.addEventListener('click', loadTimetable);

document.getElementById('previous-month').addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('next-month').addEventListener('click', () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

renderCalendar();
renderSelectedDay();
renderAssignments();
renderCourses();
renderTimetable();
renderExams();
renderNavigation();
setInterval(renderNavigation, 60_000);
courseAssociationsReady.then(() => { renderNavigation(); renderCourseSettings(); });

async function initializeTimetable() {
  try {
    const { eazybb_timetable_cache: saved } = await chrome.storage.local.get('eazybb_timetable_cache');
    // Restore the saved schedule even if a manual refresh has already started.
    // A successful refresh wins because it sets timetable before this read completes.
    if (!timetable && Array.isArray(saved?.lessons)) {
      timetable = saved;
      renderTimetable();
      renderNavigation();
      renderCourseSettings();
      if (!timetableLoading) {
        timetableStatus.textContent = Array.isArray(saved.allLessons)
          ? '上次保存的课程表'
          : '只有本周数据，刷新后可查看其他周';
      }
    }
  } catch {
    if (!timetable && !timetableLoading) timetableStatus.textContent = '点击刷新按钮加载 TIS 课程表';
  }
}

async function initializeOverview() {
  refreshButton.disabled = true;
  try {
    await assignmentSettingsReady;
    const { eazybb_overview_cache: cache } = await chrome.storage.local.get('eazybb_overview_cache');
    if (cache?.data && overviewRequestId === 0) {
      applyOverview(cache.data);
      setOverviewStatus('正在刷新…');
    }
  } catch {
    // A missing or invalid cache should not prevent a live refresh.
  }
  if (overviewRequestId === 0) loadOverview();
}

initializeTimetable();
initializeOverview();

// ============================================================================
// 考试管理
// ============================================================================

function renderCombinedExams() {
  exams = combineExamSources(tisExams, manualExams, examPreferences.sortBy);
  renderExams();
  renderCalendar();
  renderSelectedDay();
}

function renderExams() {
  if (!examsList) return;
  examsList.replaceChildren();

  const filtered = filterExamsByRange(exams, examPreferences.daysAhead, dateKey(today));
  const sorted = sortExams(filtered, examPreferences.sortBy);
  const grouped = groupExamsByDate(sorted);

  examsCountBadge.textContent = sorted.length ? String(sorted.length) : '';

  if (!sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'exams-empty-message';
    empty.textContent = '未来 ' + examPreferences.daysAhead + ' 天内暂无考试';
    examsList.append(empty);
    return;
  }

  for (const [dateStr, dayExams] of Object.entries(grouped).sort()) {
    const dateSection = document.createElement('div');
    dateSection.className = 'exams-date-section';

    const dateHeader = document.createElement('h3');
    dateHeader.className = 'exams-date-header';
    dateHeader.textContent = formatExamDate(dateStr);
    const dateCount = document.createElement('small');
    dateCount.textContent = `${dayExams.length} 场`;
    dateHeader.append(dateCount);
    dateSection.append(dateHeader);

    const examItems = document.createElement('div');
    examItems.className = 'exams-items';

    for (const exam of dayExams) {
      const item = document.createElement('div');
      item.className = 'exams-item';

      const courseRow = document.createElement('div');
      courseRow.className = 'exams-course';
      const courseMark = document.createElement('span');
      courseMark.className = 'course-mark';
      courseMark.style.setProperty('--course-color', courseColor(exam.KCMC || ''));
      const courseName = document.createElement('strong');
      courseName.textContent = exam.KCMC || '课程名称未知';
      courseRow.append(courseMark, courseName);

      // 为手动添加的考试添加删除按钮
      if (isManualExam(exam)) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'exam-delete-button';
        deleteBtn.type = 'button';
        deleteBtn.title = '删除此考试';
        deleteBtn.innerHTML = '×';
        deleteBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm(`删除“${exam.KCMC}”的考试？`)) {
            await deleteManualExam(exam);
          }
        });
        courseRow.append(deleteBtn);
      }

      item.append(courseRow);

      const examTime = typeof exam.KSJTSJ === 'string' ? exam.KSJTSJ.trim() : '';
      if (examTime && examTime !== '时间未知') {
        const timeRow = document.createElement('div');
        timeRow.className = 'exams-time';
        timeRow.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
        timeRow.append(document.createTextNode(formatExamTime(examTime)));
        item.append(timeRow);
      }

      if (exam.JXLMC || exam.JXCDMC) {
        const locationRow = document.createElement('div');
        locationRow.className = 'exams-location';
        const location = [exam.JXLMC, exam.JXCDMC].filter(Boolean).join(' ');
        locationRow.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
        locationRow.append(document.createTextNode(location));
        item.append(locationRow);
      }

      if (exam.KSJC || exam.JSJC) {
        const periodsRow = document.createElement('div');
        periodsRow.className = 'exams-periods';
        periodsRow.textContent = `节次：第${exam.KSJC || '?'}-${exam.JSJC || '?'}节`;
        item.append(periodsRow);
      }

      examItems.append(item);
    }

    dateSection.append(examItems);
    examsList.append(dateSection);
  }
}

async function loadExams() {
  if (examsLoading) return;
  examsLoading = true;
  await examsReady;
  refreshExamsButton.disabled = true;
  refreshExamsButton.setAttribute('aria-busy', 'true');
  examsStatus.textContent = '正在读取考试时间表…';
  examsStatus.classList.remove('error', 'success', 'warning');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'tis.exams',
      daysAhead: examPreferences.daysAhead,
      today: dateKey(today),
    });
    if (!response?.ok) throw new Error(response?.error ?? '读取失败');
    if (!Array.isArray(response.data)) throw new Error('考试数据格式无效');
    tisExams = response.data;
    renderCombinedExams();
    examsStatus.textContent = `已更新 ${tisExams.length} 门 TIS 考试`;
    examsStatus.classList.add('success');
    try {
      await saveExamsCache(tisExams);
    } catch {
      examsStatus.textContent += '（本地保存失败）';
      examsStatus.classList.add('warning');
    }
  } catch (error) {
    examsStatus.textContent = `加载失败：${error.message}`;
    examsStatus.classList.add('error');
  } finally {
    examsLoading = false;
    refreshExamsButton.disabled = false;
    refreshExamsButton.removeAttribute('aria-busy');
  }
}

async function saveExamsCache(data) {
  const cache = { savedAt: Date.now(), data };
  await chrome.storage.local.set({ eazybb_exams_cache: cache });
}

async function initializeExams() {
  const saved = await chrome.storage.local.get(['eazybb_exams_cache', 'eazybb_manual_exams']);
  const cache = saved.eazybb_exams_cache;
  tisExams = Array.isArray(cache?.data) ? cache.data.filter((exam) => !isManualExam(exam)) : [];
  manualExams = Array.isArray(saved.eazybb_manual_exams)
    ? saved.eazybb_manual_exams.filter((exam) => exam && isManualExam(exam)) : [];
  renderCombinedExams();
  examsStatus.textContent = Array.isArray(cache?.data)
    ? '上次保存的考试'
    : manualExams.length ? '仅显示手动添加的考试，刷新可获取 TIS 考试'
      : '点击刷新按钮加载考试时间表';
  examsStatus.classList.remove('error', 'success', 'warning');
}

// 考试设置
async function setupExamsSettings() {
  const settingsFeedback = document.getElementById('exams-settings-feedback');
  const rangeSlider = document.getElementById('exams-range-slider');
  const rangeValue = document.getElementById('exams-range-value');
  const examsSettingsSummary = document.getElementById('exams-settings-summary');

  const daysOptions = [7, 14, 30, 60, 90, 180, 365];

  function updateRangeDisplay(sliderValue) {
    const value = daysOptions[sliderValue] || 30;
    rangeValue.textContent = value + ' 天';
    examsSettingsSummary.textContent = value + ' 天';
    examPreferences.daysAhead = value;
  }

  function getSliderValue(daysAhead) {
    const index = daysOptions.indexOf(daysAhead);
    return index >= 0 ? index : 3; // Default to 30 days
  }

  // Load saved preferences
  try {
    const { eazybb_exam_preferences: saved } = await chrome.storage.local.get('eazybb_exam_preferences');
    examPreferences = normalizeExamPreferences(saved);
    rangeSlider.value = getSliderValue(examPreferences.daysAhead);
    updateRangeDisplay(rangeSlider.value);
  } catch {
    rangeSlider.value = 3; // Default to 30 days
    updateRangeDisplay(3);
  }

  rangeSlider.addEventListener('input', (e) => {
    updateRangeDisplay(e.target.value);
    renderExams();
  });

  rangeSlider.addEventListener('change', async (e) => {
    const daysAhead = daysOptions[e.target.value] || 30;
    examPreferences.daysAhead = daysAhead;
    settingsFeedback.textContent = '';
    try {
      await chrome.storage.local.set({ eazybb_exam_preferences: examPreferences });
      settingsFeedback.textContent = '已保存';
      settingsFeedback.classList.remove('error');
      renderExams();
    } catch {
      settingsFeedback.textContent = '保存失败';
      settingsFeedback.classList.add('error');
    }
  });
}

refreshExamsButton.addEventListener('click', loadExams);

// ============================================================================
// 手动添加考试功能
// ============================================================================

function showAddExamView() {
  showView(addExamView, addExamForm.querySelector('input'));
}

function hideAddExamView() {
  addExamForm.reset();
  addExamFeedback.textContent = '';
  addExamFeedback.classList.remove('error', 'success');
  showView(homeView);
}

async function handleAddExamSubmit(e) {
  e.preventDefault();

  // 收集表单数据
  const formData = {
    courseName: document.getElementById('exam-course-name').value.trim(),
    date: document.getElementById('exam-date').value,
    timeStart: document.getElementById('exam-time-start').value,
    timeEnd: document.getElementById('exam-time-end').value,
    timeRange: '',
    location: document.getElementById('exam-location').value.trim(),
    startPeriod: document.getElementById('exam-start-period').value,
    endPeriod: document.getElementById('exam-end-period').value,
    notes: document.getElementById('exam-notes').value.trim(),
  };

  // 生成时间范围字符串
  if (formData.timeStart && formData.timeEnd) {
    formData.timeRange = `${formData.timeStart}-${formData.timeEnd}`;
  } else if (formData.timeStart) {
    formData.timeRange = `${formData.timeStart}`;
  }

  // 验证表单
  const validation = validateExamForm(formData);
  if (!validation.isValid) {
    addExamFeedback.textContent = validation.errors.join('; ');
    addExamFeedback.classList.add('error');
    addExamFeedback.classList.remove('success');
    return;
  }

  // 转换为考试对象
  const newExam = { ...formDataToExam(formData), manualId: crypto.randomUUID() };

  // 保存到本地存储
  try {
    await examsReady;
    const { eazybb_manual_exams: savedExams = [] } = await chrome.storage.local.get('eazybb_manual_exams');
    const updatedExams = [...(Array.isArray(savedExams) ? savedExams : []), newExam];
    await chrome.storage.local.set({ eazybb_manual_exams: updatedExams });

    manualExams = updatedExams.filter((exam) => exam && isManualExam(exam));
    renderCombinedExams();

    // 显示成功信息
    addExamFeedback.textContent = '考试已添加';
    addExamFeedback.classList.add('success');
    addExamFeedback.classList.remove('error');

    // 2秒后关闭对话框
    setTimeout(() => {
      hideAddExamView();
    }, 1500);
  } catch (error) {
    addExamFeedback.textContent = `保存失败：${error.message}`;
    addExamFeedback.classList.add('error');
    addExamFeedback.classList.remove('success');
  }
}

async function deleteManualExam(exam) {
  try {
    await examsReady;
    const { eazybb_manual_exams: savedExams = [] } = await chrome.storage.local.get('eazybb_manual_exams');
    const updatedExams = removeStoredManualExam(savedExams, exam);
    if (!updatedExams) throw new Error('本地记录不存在');
    await chrome.storage.local.set({ eazybb_manual_exams: updatedExams });

    manualExams = updatedExams.filter((item) => item && isManualExam(item));
    renderCombinedExams();
  } catch (error) {
    console.error('Failed to delete exam:', error);
    alert(`删除失败：${error.message}`);
  }
}

// 事件监听
addExamButton.addEventListener('click', showAddExamView);
closeAddExamButton.addEventListener('click', hideAddExamView);
cancelAddExamButton.addEventListener('click', hideAddExamView);
addExamForm.addEventListener('submit', handleAddExamSubmit);

// 在views数组中添加addExamView
const views_index = views.indexOf(document.getElementById('exams-settings-view'));
if (views_index !== -1) {
  views.splice(views_index + 1, 0, addExamView);
} else {
  views.push(addExamView);
}

examsReady = setupExamsSettings().then(initializeExams).catch((error) => {
  examsStatus.textContent = `读取本地考试数据失败：${error.message}`;
  examsStatus.classList.add('error');
});
