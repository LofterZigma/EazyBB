const BLACKBOARD_ORIGIN = 'https://bb.sustech.edu.cn';

export function blackboardFileUrl(file) {
  let url;
  try { url = new URL(typeof file === 'string' ? file : file?.url); }
  catch { throw new Error('附件地址无效'); }
  if (url.origin !== BLACKBOARD_ORIGIN || url.username || url.password) {
    throw new Error('附件地址无效');
  }
  return url.href;
}

export function openBlackboardFile(file, tabs = globalThis.chrome?.tabs) {
  const url = blackboardFileUrl(file);
  if (typeof tabs?.create !== 'function') throw new Error('无法创建浏览器标签页');
  return tabs.create({ url, active: true });
}
