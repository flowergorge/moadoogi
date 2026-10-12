import { parseShareFragment, buildShareItem, assertItemSize, errorMessage, normalizeShareTags, withShareTags, withSourceUrl, suggestedShareTags, xPostAuthor, withShareMetadata } from './mobile-core.mjs?v=1.2.0';

const $ = id => document.getElementById(id);
const captureMode = new URLSearchParams(location.search).get('capture') === '1';
const draftKey = 'moadoogi-android-share-v1';
let suggestions = suggestedShareTags(), suggestionEpoch = 0;
let draft = null, auth, lib, user = null, busy = false, initialized = false, problem = '';
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function remember() {
  // No credentials are stored here. Firebase owns persistent authentication.
  try { if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
}
function previousDraft() {
  try { return JSON.parse(sessionStorage.getItem(draftKey) || 'null'); }
  catch { return null; }
}
function editable() { return draft && !busy && !draft.done && !draft.prepared; }
function setTags(tags) {
  if (!editable()) return;
  try { draft.item = withShareTags(draft.item, tags); remember(); renderCaptureOptions(); }
  catch (error) { status(errorMessage(error), true); }
}
function commitTagInput() {
  if (!editable()) return;
  const tags = normalizeShareTags($('tag-input').value);
  draft.item = withShareTags(draft.item, [...draft.item.tags, ...tags]);
  draft.tagText = ''; $('tag-input').value = ''; remember(); renderCaptureOptions();
}
function commitSource() {
  if (!editable()) return;
  draft.item = withSourceUrl(draft.item, $('source-url').value);
  draft.sourceInput = draft.item.url; remember(); renderCaptureOptions();
}
function renderCaptureOptions() {
  if (!draft) return;
  $('capture-options').disabled = !editable();
  $('capture-options').hidden = !!draft.done;
  $('tags-locked').hidden = !draft.prepared || !!draft.done;
  $('source-url').value = draft.sourceInput ?? draft.item.url;
  $('tag-input').value = draft.tagText || '';
  const selected = $('selected-tags'), recommended = $('suggested-tags');
  selected.replaceChildren(); recommended.replaceChildren();
  for (const tag of draft.item.tags || []) {
    const button = document.createElement('button');button.type = 'button';
    button.className = tag === '쇼핑' ? 'shopping-tag' : '';
    button.textContent = '#' + tag + ' ×';button.setAttribute('aria-label', tag + ' 태그 삭제');
    button.addEventListener('click', () => setTags(draft.item.tags.filter(t => t !== tag)));
    selected.append(button);
  }
  for (const tag of suggestions) {
    const button = document.createElement('button');button.type = 'button';
    button.className = tag === '쇼핑' ? 'shopping-tag' : '';
    const chosen = draft.item.tags.includes(tag);
    button.textContent = (chosen ? '✓ ' : '+ ') + tag;button.setAttribute('aria-pressed', String(chosen));
    button.addEventListener('click', () => setTags(chosen ? draft.item.tags.filter(t => t !== tag) : [...draft.item.tags, tag]));
    recommended.append(button);
  }
}
async function refreshSuggestions() {
  const epoch = ++suggestionEpoch, uid = user?.uid;
  suggestions = suggestedShareTags();renderCaptureOptions();
  if (!uid || !captureMode || !draft || draft.done) return;
  try {
    const data = await api('/api/tags');
    if (epoch !== suggestionEpoch || user?.uid !== uid) return;
    suggestions = suggestedShareTags(Array.isArray(data.tags) ? data.tags : []);renderCaptureOptions();
  } catch { /* Default suggestions stay available when the network is unavailable. */ }
}
function render() {
  $('capture-panel').hidden = !captureMode;
  $('account-panel').hidden = captureMode;
  $('account-name').textContent = user ? (user.displayName || '구글 계정') : initialized ? '로그인이 필요해요' : '로그인 확인 중…';
  $('account-email').textContent = user ? (user.email || '') : '구글 계정으로 스크랩을 저장해요.';
  $('login').hidden = !initialized || !!user;
  $('switch').hidden = !user;
  $('logout').hidden = !user;
  for (const id of ['login', 'switch', 'logout']) $(id).disabled = busy;
  $('save').hidden = !user || !draft || !!draft.done || !!problem;
  $('save').disabled = busy || !initialized;
  $('save').textContent = busy ? '저장하는 중…' : '이 계정에 저장';
  $('success').hidden = !draft?.done;
  if (draft) {
    $('share-title').textContent = draft.item?.title || draft.share.title || '공유한 내용';
    $('share-text').textContent = draft.item?.note || draft.item?.url || draft.share.text;
    renderCaptureOptions();
  }
}
try {
  if (captureMode) {
    const share = parseShareFragment(location.hash);
    if (share) {
      // The stable item id makes an uncertain-response retry an upsert, not a duplicate.
      const previous = previousDraft();
      draft = previous?.share?.id === share.id ? previous : { share, item: buildShareItem(share), uid: null, done: false };
      remember();
    } else {
      const previous = previousDraft();
      if (previous?.share) {
        const checked = parseShareFragment('#share=' + encodeURIComponent(JSON.stringify(previous.share)));
        draft = { ...previous, share: checked };
      }
    }
    if (!draft) problem = '공유한 내용이 없어요. 원래 앱에서 다시 공유해 주세요.';
  }
} catch (error) { problem = errorMessage(error); }
finally { history.replaceState(null, '', location.pathname + location.search); }
render();

async function api(path, options = {}) {
  if (!user || auth.currentUser?.uid !== user.uid) throw Error('로그인 계정이 바뀌었어요. 다시 확인해 주세요.');
  const current = user;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await current.getIdToken(attempt === 1);
    if (auth.currentUser?.uid !== current.uid) throw Error('로그인 계정이 바뀌었어요.');
    const response = await fetch(window.MOADOOGI_CONFIG.apiBase + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(15000)
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) {
      const error = new Error(data.message || '저장 서버에 연결하지 못했어요.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
}

async function login() {
  if (busy || !auth) return;
  busy = true; render(); status('구글 계정을 선택해 주세요.');
  try {
    const provider = new lib.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    // Called directly from a user click so mobile browsers permit the popup.
    await lib.signInWithPopup(auth, provider);
    status(draft && !draft.done ? '계정을 확인하고 저장을 눌러 주세요.' : '공유할 준비가 됐어요.');
  } catch (error) { status(errorMessage(error), true); }
  finally { busy = false; render(); }
}
$('login').addEventListener('click', login);
$('switch').addEventListener('click', () => {
  if (draft?.uid && !draft.done) { status('저장을 시도한 공유는 같은 계정으로 재시도해 주세요. 계정을 바꾸려면 이 화면을 닫고 앱 아이콘으로 열어 주세요.', true); return; }
  return login();
});
$('logout').addEventListener('click', async () => {
  if (busy) return;
  busy = true; render();
  try { await lib.signOut(auth); status('로그아웃했어요.'); }
  catch (error) { status(errorMessage(error), true); }
  finally { busy = false; render(); }
});
$('tag-input').addEventListener('input', () => { if (editable()) { draft.tagText = $('tag-input').value; remember(); } });
$('tag-input').addEventListener('keydown', event => {
  if (!event.isComposing && event.key === 'Enter') {
    event.preventDefault();try { commitTagInput(); } catch (error) { status(errorMessage(error), true); }
  }
});
$('tag-add').addEventListener('click', () => { try { commitTagInput(); } catch (error) { status(errorMessage(error), true); } });
$('source-url').addEventListener('input', () => { if (editable()) { draft.sourceInput = $('source-url').value; remember(); } });
$('source-url').addEventListener('change', () => { try { commitSource(); } catch (error) { status(errorMessage(error), true); } });
$('save').addEventListener('click', async () => {
  if (busy || !initialized || !user || !draft || draft.done || problem) return;
  if (draft.uid && draft.uid !== user.uid) { status('처음 저장을 시도한 계정으로 로그인해 주세요. 다른 계정에는 이 공유를 재전송하지 않아요.', true); return; }
  try { commitSource(); commitTagInput(); } catch (error) { status(errorMessage(error), true); return; }
  busy = true; draft.uid = user.uid; remember(); render();
  try {
    // Resolve metadata only before the first sync attempt. Retries use exactly the same body.
    if (!draft.prepared) {
      const xAuthor = xPostAuthor(draft.item.url);
      if (xAuthor) draft.item = withShareMetadata(draft.item, { author: xAuthor });
      if (draft.item.url.startsWith('https://') && (xAuthor || !draft.share.title)) {
        status(xAuthor ? 'X 게시자와 본문을 확인하고 있어요…' : '링크 제목을 확인하고 있어요…');
        try {
          const data = await api('/api/metadata?url=' + encodeURIComponent(draft.item.url));
          draft.item = withShareMetadata(draft.item, data);
        } catch { /* A blocked metadata fetch must never discard the shared text. */ }
      }
      draft.prepared = true; remember();
    }
    if (auth.currentUser?.uid !== draft.uid) throw Error('로그인 계정이 바뀌었어요. 원래 계정으로 다시 로그인해 주세요.');
    status('관심 목록에 저장하고 있어요…');
    assertItemSize(draft.item);
    const result = await api('/api/sync', { method: 'POST', body: JSON.stringify({ changes: [{ op: 'upsert', item: draft.item }] }) });
    if (result.ok !== true) throw Error('서버의 저장 완료 응답을 확인하지 못했어요. 다시 저장해 주세요.');
    draft.done = true; remember(); status('저장 완료 · 웹에도 반영됐어요.');
  } catch (error) { status(errorMessage(error), true); }
  finally { busy = false; render(); }
});

try {
  const [firebase, authModule] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js')
  ]);
  lib = authModule;
  auth = lib.getAuth(firebase.initializeApp(window.MOADOOGI_CONFIG.firebase));
  await lib.setPersistence(auth, lib.browserLocalPersistence);
  lib.onAuthStateChanged(auth, next => {
    user = next; void refreshSuggestions(); initialized = true; window.moadoogiMobileReady = true;
    render();
    if (problem) status(problem, true);
    else if (draft?.done) status('이미 저장한 공유예요.');
    else if (!busy) status(user ? (draft ? '계정을 확인하고 저장을 눌러 주세요.' : '공유할 준비가 됐어요.') : '처음 한 번 로그인하면 다음 공유부터 유지돼요.');
  });
} catch (error) { window.moadoogiMobileReady = true; status('로그인 기능을 연결하지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.', true); }
