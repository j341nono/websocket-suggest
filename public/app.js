// =============================================================================
//  public/app.js  ―  フロントエンド（ブラウザ側）
// =============================================================================
//
//  このファイルがやること：
//    1. 入力を 200ms デバウンスして検索リクエストを送る
//    2. AJAX(HTTP) モードと WebSocket モードを切り替える
//    3. 古い応答(stale)を requestId（= 通し番号）で無視する
//    4. 候補クリックをサーバへログ送信する
//
//  ★ AJAX も WebSocket も、最後は同じ handleResults() に流れ込みます。
//     「結果が来たら描画する」部分は共通で、違うのは “運び方” だけ。
// =============================================================================

const DEBOUNCE_MS = 200; // 入力が止まってから送るまでの待ち時間
const LIMIT = 10; // 1 回に取得する候補の最大数

// --- 画面要素の取得 ---
const input = document.getElementById('search-input');
const suggestionsEl = document.getElementById('suggestions');
const tabs = document.querySelectorAll('.tab');

const dbg = {
  mode: document.getElementById('dbg-mode'),
  query: document.getElementById('dbg-query'),
  requestId: document.getElementById('dbg-request-id'),
  transport: document.getElementById('dbg-transport'),
  wsStatus: document.getElementById('dbg-ws-status'),
  count: document.getElementById('dbg-count'),
};

// --- 状態 ---
let mode = 'http'; // 'http' | 'websocket'
let requestSeq = 0; // 送信のたびに +1 する通し番号（= requestId）
let lastRenderedSeq = 0; // 最後に画面へ描画した番号。これ以下の応答は古いので無視
let currentQuery = ''; // いま検索中の文字列（ハイライト等に使う）

// =============================================================================
//  デバウンス
//    連続入力のたびに送らず、入力が DEBOUNCE_MS 止まってから fn を呼ぶ。
//    これでサーバへのリクエスト数を大きく減らせる。
// =============================================================================
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// =============================================================================
//  WebSocket 接続（ページ表示中はずっと張りっぱなしにする）
// =============================================================================
let ws = null;

function connectWebSocket() {
  // http(s) に合わせて ws / wss を選ぶ
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);

  ws.addEventListener('open', () => setWsStatus('接続済み'));
  ws.addEventListener('error', () => setWsStatus('エラー'));
  ws.addEventListener('close', () => {
    // 切れたら少し待って自動再接続（学習用の簡単な実装）
    setWsStatus('切断（3 秒後に再接続）');
    setTimeout(connectWebSocket, 3000);
  });

  ws.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      return; // 壊れたメッセージは無視
    }
    if (data.type !== 'suggestions') return;

    // サーバが echo した requestId を、そのまま通し番号として stale 判定に使う
    handleResults(data.requestId, data);
  });
}

function setWsStatus(text) {
  dbg.wsStatus.textContent = text;
}

// =============================================================================
//  検索の送信（モードに応じて HTTP か WebSocket を選ぶ）
// =============================================================================
function sendQuery(rawQuery) {
  const q = rawQuery.trim();
  currentQuery = q;

  // 空クエリは候補を消すだけ（サーバに無駄なリクエストを送らない）
  if (q === '') {
    renderSuggestions([]);
    updateDebug({ query: '(なし)', count: 0 });
    return;
  }

  const seq = ++requestSeq;
  updateDebug({ mode, query: q, requestId: seq });

  if (mode === 'http') {
    sendHttp(q, seq);
  } else {
    sendWs(q, seq);
  }
}

// --- AJAX(HTTP)：毎回 1 回のリクエストを送る ---
async function sendHttp(q, seq) {
  try {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}&limit=${LIMIT}`);
    const data = await res.json();
    handleResults(seq, data); // 応答が返ってきたら共通処理へ
  } catch (err) {
    console.error('HTTP 検索に失敗:', err);
  }
}

// --- WebSocket：張りっぱなしの接続にメッセージを流す ---
function sendWs(q, seq) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setWsStatus('接続待ち…');
    return; // まだ繋がっていなければ今回は送らない（次の入力で送られる）
  }
  ws.send(JSON.stringify({ type: 'suggest', q, limit: LIMIT, requestId: seq }));
}

// =============================================================================
//  応答処理（stale = 古い応答 を捨てる）
//
//  ネットワークの都合で、後から送ったリクエストの方が先に返ることがある。
//  そのとき古い応答で新しい結果を上書きしないよう、通し番号で判定する。
// =============================================================================
function handleResults(seq, data) {
  if (typeof seq === 'number' && seq <= lastRenderedSeq) {
    return; // すでにもっと新しい結果を描画済み → これは古いので無視
  }
  lastRenderedSeq = seq;

  const items = Array.isArray(data.items) ? data.items : [];
  renderSuggestions(items, data.q ?? currentQuery);
  updateDebug({
    transport: data.transport, // 'http' or 'websocket'
    requestId: seq,
    count: items.length,
  });
}

// =============================================================================
//  描画
// =============================================================================
function renderSuggestions(items, query = '') {
  suggestionsEl.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'suggestion';
    li.innerHTML =
      `<span class="term">${highlightPrefix(item.term, query)}</span>` +
      `<span class="score">${item.score}</span>`;
    li.addEventListener('click', () => onSuggestionClick(item.term, query));
    suggestionsEl.appendChild(li);
  }
}

// 入力した prefix 部分を太字にする簡単なハイライト
function highlightPrefix(term, query) {
  const q = (query || '').trim().toLowerCase();
  if (q && term.toLowerCase().startsWith(q)) {
    return `<strong>${escapeHtml(term.slice(0, q.length))}</strong>${escapeHtml(term.slice(q.length))}`;
  }
  return escapeHtml(term);
}

// XSS を避けるための最小限のエスケープ
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// =============================================================================
//  クリックログ送信（POST /api/click）
// =============================================================================
async function onSuggestionClick(term, query) {
  input.value = term;
  renderSuggestions([]); // 選んだら候補を閉じる

  try {
    await fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term,
        query: query || currentQuery,
        transport: mode, // どちらのモードで選ばれたかも記録
      }),
    });
  } catch (err) {
    console.error('クリックログ送信に失敗:', err);
  }
}

// =============================================================================
//  デバッグ表示の更新（渡されたキーだけ書き換える）
// =============================================================================
function updateDebug(patch) {
  if (patch.mode !== undefined) dbg.mode.textContent = patch.mode;
  if (patch.query !== undefined) dbg.query.textContent = patch.query;
  if (patch.requestId !== undefined) dbg.requestId.textContent = patch.requestId;
  if (patch.transport !== undefined) dbg.transport.textContent = patch.transport;
  if (patch.count !== undefined) dbg.count.textContent = patch.count;
}

// =============================================================================
//  タブ切替
// =============================================================================
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    mode = tab.dataset.mode;
    updateDebug({ mode });

    // モードを変えたら、今入っている文字でそのまま検索し直す
    if (input.value.trim() !== '') sendQuery(input.value);
  });
});

// =============================================================================
//  入力イベント（デバウンス経由で検索）
// =============================================================================
const debouncedSend = debounce(sendQuery, DEBOUNCE_MS);
input.addEventListener('input', () => debouncedSend(input.value));

// =============================================================================
//  起動
// =============================================================================
connectWebSocket(); // ページ表示時に WebSocket を 1 本張る
updateDebug({ mode }); // 初期モードを表示
input.focus();
