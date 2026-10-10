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
    title: typeof data.title === 'string' ? data.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : ''
  };
}

export function buildShareItem(share, now = new Date()) {
  const match = share.text.match(/https?:\/\/[^\s<>"“”‘’]+/i);
  let url = '', note = share.text;
  if (match) {
    try {
      const parsed = new URL(match[0].replace(/[)\]}>,.!?，。]+$/g, ''));
      if (!parsed.username && !parsed.password && parsed.href.length <= 4096) {
        url = parsed.href;
        note = share.text.replace(match[0], '').trim();
      }
    } catch {}
  }
  if (note.length > 5000) throw Error('메모는 5,000자까지 저장할 수 있어요. 짧게 나누어 공유해 주세요.');
  const host = url ? new URL(url).hostname.toLowerCase() : '';
  const is = name => host === name || host.endsWith('.' + name);
  const tag = is('youtube.com') || is('youtu.be') ? '유튜브' : is('bilibili.com') || host === 'b23.tv' ? '비리비리' : is('github.com') ? '깃허브' : is('x.com') || is('twitter.com') ? 'X게시글' : is('arca.live') ? '아카라이브' : is('dcinside.com') ? '디시인사이드' : is('kone.gg') ? '코네' : url ? '웹사이트' : '';
  const title = (share.title || note.split(/\r?\n/).find(Boolean) || (url ? host.replace(/^www\./, '') + '에서 공유한 링크' : '공유한 텍스트')).slice(0, 180);
  if (note === share.title) note = '';
  const item = { id: 'android-' + share.id, title, url, note, tags: tag ? [tag] : [], status: '관심', date: '', created: now.toISOString(), rank: -now.getTime() / 1000, starred: false, autoTagsApplied: true };
  assertItemSize(item);
  return item;
}

export function assertItemSize(item) {
  if (new TextEncoder().encode(JSON.stringify(item)).length > 12 * 1024) {
    throw Error('공유 내용의 용량이 너무 커요. 텍스트를 짧게 나누어 공유해 주세요.');
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
