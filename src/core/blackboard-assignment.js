// Port of sustech_survival/bb/submit.py's proven Original Course View form flow.
// The public gradebook REST write API requires a separate OAuth integration.
const BLACKBOARD_ORIGIN = 'https://bb.sustech.edu.cn';
const SUBMISSION_PATH = '/webapps/assignment/uploadAssignment';
const BB_ID = /^_\d+_\d+$/;

function assignmentUrl(courseId, contentId) {
  if (!BB_ID.test(courseId) || !BB_ID.test(contentId)) throw new Error('作业链接无效');
  const url = new URL(SUBMISSION_PATH, BLACKBOARD_ORIGIN);
  url.searchParams.set('action', 'newAttempt');
  url.searchParams.set('content_id', contentId);
  url.searchParams.set('course_id', courseId);
  url.searchParams.set('group_id', '');
  return url.href;
}

function validBlackboardDestination(destination) {
  const url = new URL(destination, BLACKBOARD_ORIGIN);
  if (url.origin !== BLACKBOARD_ORIGIN || url.username || url.password) {
    throw new Error('Blackboard 返回了无效的提交结果地址');
  }
  return url.href;
}

function findSubmissionField(form, kind) {
  const patterns = kind === 'text'
    ? [/^studentSubmission$/i, /^submissionText$/i, /^textSubmission$/i, /(?:submission|assignment).*(?:text|body)/i, /(?:text|body).*submission/i, /vtbe.*(?:text|body)|(?:text|body).*vtbe/i]
    : [/^studentComments$/i, /^submissionComments$/i, /^comments?$/i, /(?:assignment|submission).*comment/i];
  const candidates = [...form.querySelectorAll('textarea[name], input[name]')]
    .filter((field) => field.type !== 'file' && !field.name.startsWith('newFile_'));
  for (const pattern of patterns) {
    const matches = candidates.filter((field) => pattern.test(field.name) || pattern.test(field.id));
    if (matches.length === 1) return matches[0];
  }
  if (kind === 'text') {
    const visibleEditors = candidates.filter((field) => field.tagName === 'TEXTAREA'
      && !/comment/i.test(`${field.name} ${field.id}`));
    if (visibleEditors.length === 1) return visibleEditors[0];
  }
  return null;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export async function submitBlackboardAssignment(courseId, contentId, submission, fetcher = fetch) {
  const text = String(submission?.text || '').trim();
  const comments = String(submission?.comments || '').trim();
  const files = Array.isArray(submission?.files) ? submission.files : [];
  if (!text && !files.length) throw new Error('请填写提交文本或选择附件');
  if (files.length > 10) throw new Error('一次最多提交 10 个附件');
  for (const entry of files) {
    if (!entry?.file?.name || !Number.isFinite(entry.file.size) || entry.file.size === 0) {
      throw new Error('附件中包含空文件或无效文件');
    }
  }

  const formResponse = await fetcher(assignmentUrl(courseId, contentId), {
    method: 'GET', credentials: 'include', cache: 'no-store',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!formResponse.ok || !formResponse.url?.startsWith(BLACKBOARD_ORIGIN + SUBMISSION_PATH)) {
    throw new Error('无法取得 Blackboard 作业提交表单，请确认登录状态和提交次数');
  }
  const document = new DOMParser().parseFromString(await formResponse.text(), 'text/html');
  const form = document.getElementById('uploadAssignmentFormId');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('Blackboard 未返回作业提交表单，可能不允许继续提交');
  }

  const body = new FormData();
  for (const input of form.querySelectorAll('input[name][value]')) {
    if (input.type === 'file') continue;
    body.append(input.name, input.value);
  }
  for (const textarea of form.querySelectorAll('textarea[name]')) {
    body.set(textarea.name, textarea.value);
  }
  const ajaxNonce = document.getElementById('ajaxNonceId');
  if (ajaxNonce?.name && !body.has(ajaxNonce.name)) body.append(ajaxNonce.name, ajaxNonce.value);
  if (!body.has('blackboard.platform.security.NonceUtil.nonce')) {
    throw new Error('Blackboard 提交表单缺少安全令牌');
  }

  const textField = findSubmissionField(form, 'text');
  if (text) {
    if (!textField) throw new Error('Blackboard 表单中未找到文本提交字段，本次未发送任何内容');
    body.set(textField.name, `<p>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</p>`);
  }
  if (comments) {
    const commentsField = findSubmissionField(form, 'comments');
    if (!commentsField) throw new Error('Blackboard 表单中未找到评论字段，本次未发送任何内容');
    body.set(commentsField.name, comments);
  }

  // The picker sends one metadata group per selected file, with numbered multipart parts.
  const fileFields = ['newFile_attachmentType', 'newFile_fileId', 'newFile_artifactFileId',
    'newFile_artifactType', 'newFile_artifactTypeResourceKey', 'newFile_linkTitle'];
  for (const field of fileFields) body.delete(field);
  for (const [index, entry] of files.entries()) {
    body.append('newFile_attachmentType', 'L');
    body.append('newFile_fileId', 'new');
    body.append('newFile_artifactFileId', 'undefined');
    body.append('newFile_artifactType', 'undefined');
    body.append('newFile_artifactTypeResourceKey', 'undefined');
    const note = String(entry.note || '').trim();
    body.append('newFile_linkTitle', note ? `${entry.file.name} — ${note}` : entry.file.name);
    body.append(`newFile_LocalFile${index}`, entry.file, entry.file.name);
  }
  body.set('dispatch', 'submit');

  const response = await fetcher(`${BLACKBOARD_ORIGIN}${SUBMISSION_PATH}?action=submit`, {
    method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'manual',
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }, body,
  });
  if (response.type === 'opaqueredirect') {
    throw new Error('Blackboard 已重定向，提交结果无法确认。请先到 Blackboard 核对提交记录');
  }
  let result;
  try { result = await response.json(); }
  catch {
    throw new Error(`Blackboard 未返回提交回执（HTTP ${response.status}），请先核对提交记录`);
  }
  if (!response.ok || !result?.destinationUrl) {
    throw new Error(result?.message || `Blackboard 未确认提交成功（HTTP ${response.status}），请先核对提交记录`);
  }
  return { destinationUrl: validBlackboardDestination(result.destinationUrl) };
}
