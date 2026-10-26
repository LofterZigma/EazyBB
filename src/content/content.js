// Content script：注入 bb/tis 页面，与 background 通过消息通信。

(() => {
  if (window.__eazybbLoaded) return;
  window.__eazybbLoaded = true;

  if (location.hostname === 'tis.sustech.edu.cn') {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'tis.semesterRequest' || window.top !== window) return;
      const { xn, xq } = message;
      if (!/^\d{4}-\d{4}$/.test(xn) || !/^[123]$/.test(String(xq))) {
        sendResponse({ error: 'TIS 学期参数无效' });
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      fetch('/xszykb/queryxszykbzong', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({ xn, xq }),
        signal: controller.signal,
      }).then(async (response) => ({
        url: response.url,
        status: response.status,
        body: await response.text(),
      })).then(sendResponse, (error) => {
        sendResponse({ error: controller.signal.aborted ? 'TIS 请求超时，请稍后重试' : error.message });
      }).finally(() => clearTimeout(timeout));
      return true;
    });
    return;
  }

  if (location.hostname !== 'bb.sustech.edu.cn') return;
  let lastMenu = '';
  function saveCourseMenu() {
    const menu = document.querySelector('#courseMenuPalette_contents');
    if (!menu) return false;
    const items = [...menu.querySelectorAll(':scope > li')];
    const links = items.map((item) => item.querySelector('a[href]'));
    const pageUrl = new URL(location.href);
    const ids = [pageUrl.searchParams.get('course_id')];
    if (pageUrl.searchParams.get('type')?.toLowerCase() === 'course') ids.push(pageUrl.searchParams.get('id'));
    for (const link of links) {
      if (!link) continue;
      try { ids.push(new URL(link.href, location.href).searchParams.get('course_id')); }
      catch { /* Ignore JavaScript links. */ }
      ids.push(link.getAttribute('href')?.match(/[?&]course_id=(_\d+_\d+)/i)?.[1]);
    }
    const courseId = ids.find((id) => /^_\d+_\d+$/.test(id || ''));
    if (!courseId) return false;
    const entries = items.map((item, position) => {
      const link = links[position];
      const label = (link || item).textContent.replace(/\s+/g, ' ').trim();
      let contentId = null;
      if (link) {
        try { contentId = new URL(link.href, location.href).searchParams.get('content_id'); }
        catch { /* Ignore JavaScript links. */ }
        contentId ||= link.getAttribute('href')?.match(/[?&]content_id=(_\d+_\d+)/i)?.[1];
      }
      return {
        id: item.id || `position:${position}`,
        position,
        label,
        contentId,
        targetType: !link ? (label ? 'Subheader' : 'Divider') : 'Content',
      };
    }).filter((entry) => entry.label || entry.targetType === 'Divider');
    const serialized = JSON.stringify(entries);
    if (entries.length && serialized !== lastMenu) {
      lastMenu = serialized;
      chrome.storage.local.set({ [`bb:menu:${courseId}`]: entries }).catch(() => {});
    }
    return entries.length > 0;
  }
  saveCourseMenu();
  let pending;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(saveCourseMenu, 200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => { observer.disconnect(); clearTimeout(pending); saveCourseMenu(); }, 15000);
})();
