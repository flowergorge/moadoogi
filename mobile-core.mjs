// Pure helpers shared by the save-only page and its regression tests.
export function parseShareFragment(hash) {
  if (!hash.startsWith('#share=')) return null;
  if (hash.length > 160000) throw Error('공유 내용이 너무 길어요.');
  const data = JSON.parse(decodeURIComponent(hash.slice(7)));
  if (!data || typeof data.text !== 'string' || !data.text.trim()) throw Error('공유할 내용이 없어요.');
  if (data.text.length > 12000) throw Error('공유 내용이 너무 길어요.');
  return {
    id: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data.id || '') ? data.id : crypto.randomUUID(),
    text: data.text.trim(),
    sourceUrl: safeSourceUrl(data.sourceUrl),
    title: typeof data.title === 'string' ? data.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : ''
  };
}

export function buildShareItem(share, now = new Date()) {
  const match = share.text.match(/https?:\/\/[^\s<>"“”‘’]+/i);
  let url = safeSourceUrl(share.sourceUrl), note = share.text;
  const embedded = match ? safeSourceUrl(match[0].replace(/[)\]}>,.!?，。]+$/g, '')) : '';
  if (!url) url = embedded;
  // A separate source URL must never remove a different link from the selected quote.
  if (url && embedded === url) note = share.text.replace(match[0], '').trim();
  if (note.length > 5000) throw Error('메모는 5,000자까지 저장할 수 있어요. 짧게 나누어 공유해 주세요.');
  const host = url ? new URL(url).hostname.toLowerCase() : '';
  const tag = automaticShareTag(url);
  const title = (xPostAuthor(url) || share.title || note.split(/\r?\n/).find(Boolean) || (url ? host.replace(/^www\./, '') + '에서 공유한 링크' : '공유한 텍스트')).slice(0, 180);
  if (url && embedded && note === share.title && !share.sourceUrl) note = '';
  const item = { id: 'android-' + share.id, title, url, note, tags: tag ? [tag] : [], status: '관심', date: '', created: now.toISOString(), rank: -now.getTime() / 1000, starred: false, autoTagsApplied: true };
  assertItemSize(item);
  return item;
}

export function assertItemSize(item) {
  if (new TextEncoder().encode(JSON.stringify(item)).length > 12 * 1024) {
    throw Error('공유 내용의 용량이 너무 커요. 텍스트를 짧게 나누어 공유해 주세요.');
  }
}

// Only actual X post links qualify, never profiles or lookalike domains.
export function xPostAuthor(value) {
  const safe = safeSourceUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return '';
  if (/^\/i\/(?:web\/)?status\/\d+(?:\/|$)/.test(url.pathname)) return 'X 게시물';
  const match = /^\/([a-zA-Z0-9_]{1,15})\/status\/\d+(?:\/|$)/.exec(url.pathname);
  return match && !['i', 'intent', 'search', 'home', 'explore'].includes(match[1].toLowerCase()) ? '@' + match[1] : '';
}

export function withShareMetadata(item, data) {
  const isX = !!xPostAuthor(item.url);
  const rawTitle = isX ? data?.author : data?.title;
  const title = typeof rawTitle === 'string' ? rawTitle.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : '';
  const note = isX && typeof data?.text === 'string' ? data.text.trim().slice(0, 5000) : '';
  const candidate = { ...item, title: title || item.title, note: note || item.note };
  try { assertItemSize(candidate); return candidate; }
  catch {
    // Keep the original shared text when fetched content would exceed the save limit.
    const titleOnly = { ...item, title: candidate.title };
    try { assertItemSize(titleOnly); return titleOnly; } catch { return item; }
  }
}

export function errorMessage(error) {
  if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return '로그인을 취소했어요. 다시 로그인할 수 있어요.';
  if (error?.code === 'auth/popup-blocked') return '로그인 창이 차단됐어요. 브라우저에서 팝업을 허용하고 다시 눌러 주세요.';
  if (error?.status === 401) return '로그인이 만료됐어요. 다시 로그인한 뒤 저장해 주세요.';
  if (error?.status === 429) return '잠시 요청이 많아요. 1분 뒤 다시 저장해 주세요.';
  if (error?.name === 'TimeoutError' || error instanceof TypeError) return '연결을 확인하고 다시 저장해 주세요. 같은 공유를 다시 저장해도 중복 등록되지 않아요.';
  return error?.message || '저장하지 못했어요. 다시 시도해 주세요.';
}

export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function automaticShareTag(url) {
  const host = safeSourceUrl(url) ? new URL(url).hostname.toLowerCase() : '';
  const is = name => host === name || host.endsWith('.' + name);
  return is('youtube.com') || is('youtu.be') ? '유튜브' : is('bilibili.com') || host === 'b23.tv' ? '비리비리' : is('github.com') ? '깃허브' : is('x.com') || is('twitter.com') ? 'X게시글' : is('arca.live') ? '아카라이브' : is('dcinside.com') ? '디시인사이드' : is('kone.gg') ? '코네' : host ? '웹사이트' : '';
}
export function normalizeShareTags(input) {
  const tags = [...new Set(String(input || '').split(/[\s,]+/u).map(t => t.replace(/^#+/, '').trim()).filter(Boolean))];
  if (tags.length > 24) throw Error('태그는 24개까지 넣을 수 있어요.');
  if (tags.some(t => t.length > 80)) throw Error('태그 하나는 80자까지 넣을 수 있어요.');
  return tags;
}
export function withShareTags(item, tags) {
  const candidate = { ...item, tags: normalizeShareTags(tags.join(' ')) };
  assertItemSize(candidate);
  return candidate;
}
export function withSourceUrl(item, value) {
  const url = safeSourceUrl(value);
  if (value.trim() && !url) throw Error('원본 주소는 올바른 http:// 또는 https:// 주소를 입력해 주세요.');
  if (url === item.url) return item;
  const oldTag = automaticShareTag(item.url), newTag = automaticShareTag(url);
  const tags = [...new Set([...(item.tags || []).filter(t => t !== oldTag), newTag].filter(Boolean))];
  if (tags.length > 24) throw Error('태그는 24개까지 넣을 수 있어요.');
  const candidate = { ...item, url, tags };
  assertItemSize(candidate);
  return candidate;
}
export const DEFAULT_SHARE_TAGS = ['쇼핑', '게임', '읽을거리', '나중에보기', '자료', '아이디어'];
export function suggestedShareTags(existing = []) {
  return [...new Set(['쇼핑', ...existing.filter(t => typeof t === 'string' && t.length <= 80 && !/[\s,]/u.test(t)), ...DEFAULT_SHARE_TAGS])].slice(0, 16);
}
