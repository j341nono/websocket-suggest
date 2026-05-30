// =============================================================================
//  src/server.js  ―  サーバ本体（Express + WebSocket を 1 プロセスで起動）
// =============================================================================
//
//  この1ファイルが、3つの入口を1つの検索エンジン(Trie)につなぎます：
//
//    [AJAX]      GET  /api/suggest?q=...   → suggestionService.getSuggestions()
//    [WebSocket] ws://.../ws の suggest    → suggestionService.getSuggestions()
//    [click log] POST /api/click           → logService.appendClickLog()
//
//  ★ AJAX も WebSocket も「同じ getSuggestions() を呼ぶ」のがこの教材の肝です。
//     検索ロジックは共通で、違うのは “運び方（transport）” だけ。
//
//  ■ なぜ Express と ws を1つの http.Server に載せるのか？
//    こうすると同じポート(3000)で「HTTP も WebSocket も」受けられます。
//    WebSocket は最初 HTTP リクエストとして来て、途中で接続を
//    "Upgrade" して WebSocket に切り替わる仕組みだからです。
// =============================================================================

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { SuggestionService } from './suggestionService.js';
import { appendClickLog } from './logService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 環境変数で上書き可能（README 参照）。
//   PORT       … 待ち受けポート
//   WORDS_FILE … 読み込む単語ファイル（words.json / words-updated.json）
const PORT = process.env.PORT || 3000;
const WORDS_FILE = process.env.WORDS_FILE || 'words.json';

// --- 1. 検索エンジンを用意（起動時に1回だけ Trie を構築する）---
const suggestionService = new SuggestionService();

// --- 2. Express アプリ（HTTP 側の入口）---
const app = express();
app.use(express.json()); // POST の JSON ボディを解析
app.use(express.static(PUBLIC_DIR)); // public/ をそのまま配信（/ で index.html）

// [AJAX] サジェスト：GET /api/suggest?q=tok&limit=10
app.get('/api/suggest', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = parseInt(req.query.limit, 10) || 10;

  const items = suggestionService.getSuggestions(q, limit);

  res.json({
    type: 'suggestions',
    transport: 'http', // ← この応答が HTTP 経由だと分かるよう印をつける
    q,
    items,
  });
});

// [click log] クリック記録：POST /api/click
app.post('/api/click', async (req, res) => {
  try {
    const saved = await appendClickLog(req.body ?? {});
    res.json({ ok: true, saved });
  } catch (err) {
    // term 欠落などの検証エラーは 400 で返す
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- 3. HTTP サーバを作り、その上に WebSocket サーバを載せる ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  // ブラウザ1タブにつき1本の接続が張られる。
  socket.on('message', (data) => {
    // [WebSocket] クライアントからのメッセージを処理
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      socket.send(JSON.stringify({ type: 'error', error: 'JSON が不正です' }));
      return;
    }

    if (message.type === 'suggest') {
      const items = suggestionService.getSuggestions(message.q ?? '', message.limit ?? 10);

      // requestId をそのまま返す（= echo）。
      // クライアントはこれを見て「古い応答(stale)」を捨てられる。
      socket.send(
        JSON.stringify({
          type: 'suggestions',
          transport: 'websocket', // ← この応答が WebSocket 経由だと分かる印
          q: message.q ?? '',
          requestId: message.requestId,
          items,
        }),
      );
    }
  });
});

// --- 4. 起動 ---
async function start() {
  const count = await suggestionService.load(WORDS_FILE);
  server.listen(PORT, () => {
    console.log('--------------------------------------------------');
    console.log('  Mini Suggest Lab を起動しました');
    console.log(`  URL        : http://localhost:${PORT}`);
    console.log(`  単語ファイル : ${WORDS_FILE}（${count} 件）`);
    console.log('--------------------------------------------------');
  });
}

start().catch((err) => {
  console.error('起動に失敗しました:', err.message);
  process.exit(1);
});
