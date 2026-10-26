// Exam management — integration with TIS exam schedule into the sidebar.

/**
 * Default exam preferences
 */
export const DEFAULT_EXAM_PREFERENCES = Object.freeze({
  daysAhead: 30,     // Show exams within N days from today
  sortBy: 'dateAsc', // Sort order: 'dateAsc'
  enabled: true,     // Show exam card
});

/**
 * Normalize and validate exam preferences from storage
 */
export function normalizeExamPreferences(saved) {
  const prefs = { ...DEFAULT_EXAM_PREFERENCES };
  if (typeof saved === 'object' && saved !== null) {
    if (Number.isFinite(saved.daysAhead)) {
      prefs.daysAhead = Math.min(Math.max(Math.trunc(saved.daysAhead), 1), 365);
    }
    if (typeof saved.sortBy === 'string' && ['dateAsc'].includes(saved.sortBy)) {
      prefs.sortBy = saved.sortBy;
    }
    if (typeof saved.enabled === 'boolean') {
      prefs.enabled = saved.enabled;
    }
  }
  return prefs;
}

/**
 * Filter exams by date range (today to today + daysAhead)
 */
export function filterExamsByRange(exams, daysAhead, today = null) {
  if (!Array.isArray(exams)) return [];

  // Parse today's date (expects YYYY-MM-DD format string or null)
  const todayStr = today || new Date().toISOString().split('T')[0];
  const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  const endMs = todayMs + daysAhead * 24 * 60 * 60 * 1000;

  return exams.filter(exam => {
    if (!exam.KSRQ) return false;
    const examMs = new Date(exam.KSRQ + 'T00:00:00Z').getTime();
    return examMs >= todayMs && examMs <= endMs;
  });
}

/**
 * Sort exams by date ascending
 */
export function sortExams(exams, sortBy = 'dateAsc') {
  const sorted = [...exams];
  if (sortBy === 'dateAsc') {
    sorted.sort((a, b) => (a.KSRQ || '').localeCompare(b.KSRQ || ''));
  }
  return sorted;
}

export function combineExamSources(tisRecords, manualRecords, sortBy = 'dateAsc') {
  const tis = Array.isArray(tisRecords) ? tisRecords.filter((exam) => exam && !isManualExam(exam)) : [];
  const manual = Array.isArray(manualRecords) ? manualRecords.filter((exam) => exam && isManualExam(exam)) : [];
  return sortExams([...tis, ...manual], sortBy);
}

export function removeStoredManualExam(records, target) {
  if (!Array.isArray(records)) return null;
  const index = records.findIndex((exam) => target.manualId
    ? exam?.manualId === target.manualId : JSON.stringify(exam) === JSON.stringify(target));
  if (index < 0) return null;
  return [...records.slice(0, index), ...records.slice(index + 1)];
}

/**
 * Group exams by date for display
 */
export function groupExamsByDate(exams) {
  const groups = {};
  exams.forEach(exam => {
    const date = exam.KSRQ || '未知';
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(exam);
  });
  return groups;
}

/**
 * Parse exam date string (YYYY-MM-DD) into a readable format
 */
export function formatExamDate(dateStr) {
  if (!dateStr || dateStr === '未知') return '未知';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return dateStr;
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${month}月${day}日 ${weekday}`;
}

/**
 * Parse time slot into hours and minutes
 * Handles formats like "08:00-08:50" or period-based times
 */
export function formatExamTime(timeStr) {
  if (!timeStr) return '时间未知';
  return timeStr;
}

/**
 * Get period name from period number (1-13)
 */
export function getPeriodName(periodNum) {
  const periods = {
    1: '第1节', 2: '第2节', 3: '第3节', 4: '第4节',
    5: '第5节', 6: '第6节', 7: '第7节', 8: '第8节',
    9: '第9节', 10: '第10节', 11: '第11节', 12: '第12节',
    13: '第13节',
  };
  return periods[periodNum] || `第${periodNum}节`;
}

/**
 * Convert form data to exam object
 */
export function formDataToExam(formData) {
  return {
    KCMC: formData.courseName || '课程名称未知',
    KCDM: '',
    KSRQ: formData.date || '',
    XQJMC: '',
    KSJTSJ: formData.timeRange || '',
    KSJC: formData.startPeriod || '',
    JSJC: formData.endPeriod || '',
    JXLMC: formData.location || '',
    JXCDMC: '',
    XIAOQUBMC: '',
    KSSJDMC: '考试',
    XNXQMC: '',
    notes: formData.notes || '',
    isManuallyAdded: true,
  };
}

/**
 * Validate exam form data
 */
export function validateExamForm(formData) {
  const errors = [];

  if (!formData.courseName || formData.courseName.trim() === '') {
    errors.push('课程名称不能为空');
  }

  if (!formData.date) {
    errors.push('考试日期不能为空');
  } else {
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) {
      errors.push('考试日期格式不正确');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Check if exam is manually added
 */
export function isManualExam(exam) {
  return exam.isManuallyAdded === true;
}

/**
 * Get delete button for exam if manually added
 */
export function getExamDeleteButton(exam, onDelete) {
  if (!isManualExam(exam)) {
    return null;
  }

  const btn = document.createElement('button');
  btn.className = 'exam-delete-button';
  btn.type = 'button';
  btn.title = '删除此考试';
  btn.innerHTML = '×';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`删除“${exam.KCMC}”的考试？`)) {
      onDelete(exam);
    }
  });

  return btn;
}
