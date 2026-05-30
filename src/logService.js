// =============================================================================
//  src/logService.js  ―  クリックログの読み書き
// =============================================================================
//
//  ユーザーが候補をクリックしたら、その事実を data/click-logs.json に
//  追記します。これは実サービスでいう「行動ログ収集」のミニチュアです。
//
//  ★ 学習用なので JSON ファイルを直接 読み書き します。
//     （本番では DB やログ基盤 / メッセージキューを使いますが、
//      ここでは「ログが溜まる」という流れを体感するのが目的です）
//
//  ※ 注意：read → 追記 → write を素朴に行うため、
//     大量同時アクセスでは競合し得ます。学習用と割り切っています。
// =============================================================================

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLICK_LOG_PATH = path.join(__dirname, '..', 'data', 'click-logs.json');

/**
 * 既存のクリックログを読み込む。
 * ファイルが無い・JSON が壊れている場合は「空ログ」として扱う（落とさない）。
 * @returns {Promise<Array>}
 */
export async function readClickLogs() {
  try {
    const raw = await readFile(CLICK_LOG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // ファイル未作成や JSON 破損は、空配列スタートとして扱う
    return [];
  }
}

/**
 * クリックログを1件追記する。
 *
 * @param {{term?: string, query?: string, transport?: string}} entry
 * @returns {Promise<object>} 実際に保存したログ1件
 */
export async function appendClickLog(entry) {
  // --- 入力検証：term は必須 ---
  const term = typeof entry?.term === 'string' ? entry.term.trim() : '';
  if (term === '') {
    throw new Error('クリックログには term が必要です');
  }

  // 保存する形に整える（不正な transport は http に寄せる）
  const logEntry = {
    term,
    query: typeof entry.query === 'string' ? entry.query : '',
    transport: entry.transport === 'websocket' ? 'websocket' : 'http',
    timestamp: new Date().toISOString(),
  };

  // 読み込み → 追記 → 書き戻し
  const logs = await readClickLogs();
  logs.push(logEntry);
  await writeFile(CLICK_LOG_PATH, JSON.stringify(logs, null, 2), 'utf-8');

  return logEntry;
}
