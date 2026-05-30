// =============================================================================
//  scripts/aggregate-clicks.ts  ―  クリックログ集計バッチ
// =============================================================================
//
//  実サービスの autocomplete はだいたい次の流れで「人気度」を学習します：
//
//     ① 行動ログ収集     ユーザーのクリックや検索を記録する
//        （= data/click-logs.json）
//             │
//             ▼
//     ② 集計（このスクリプト）  ログを term ごとに数え、新しいスコアを出す
//        （= data/aggregated-scores.json）
//             │
//             ▼
//     ③ 辞書再構築（rebuild-trie-data.ts）  元辞書に集計結果を反映する
//        （= data/words-updated.json）
//
//  このスクリプトは ② にあたる「集計（アグリゲーション）」です。
//
//  ■ やること
//    - data/click-logs.json を読む（= ①の行動ログ）
//    - data/words.json も読む（各 term の “元のスコア(baseScore)” を知るため）
//    - term ごとにクリック数を数える
//    - newScore = baseScore + clicks * CLICK_WEIGHT を計算する
//    - 結果を data/aggregated-scores.json に書く
//
//  ※ スコアの決め方はわざと単純にしています。実際は CTR（表示に対する
//     クリック率）、表示位置バイアス、新しさ（時間減衰）などを使います。
// =============================================================================

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AggregatedScore, ClickLogEntry, WordEntry } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// 1 クリックあたり何点スコアを足すか。ここを変えると“クリックの重み”が変わる。
const CLICK_WEIGHT = 1;

/**
 * data/ 配下の JSON を読む。失敗したら fallback を返す（バッチを止めない）。
 * ジェネリクス <T> で「読み込んだ結果の型」を呼び出し側が指定できる。
 */
async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path.join(DATA_DIR, fileName), 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[aggregate] ${fileName} を読めませんでした（${message}）。既定値を使います。`);
    return fallback;
  }
}

async function main(): Promise<void> {
  // ① 行動ログ と 元辞書 を読む
  const logs = await readJson<ClickLogEntry[]>('click-logs.json', []);
  const words = await readJson<WordEntry[]>('words.json', []);

  // term -> baseScore（元のスコア）の対応表を作る
  const baseScoreByTerm = new Map<string, number>();
  for (const word of words) {
    if (word && typeof word.term === 'string') {
      baseScoreByTerm.set(word.term, Number(word.score) || 0);
    }
  }

  // ② term ごとにクリック数を数える
  const clicksByTerm = new Map<string, number>();
  for (const log of logs) {
    if (!log || typeof log.term !== 'string') continue;
    const term = log.term.trim().toLowerCase();
    if (term === '') continue;
    clicksByTerm.set(term, (clicksByTerm.get(term) ?? 0) + 1);
  }

  // ③ クリック数を新しいスコアに変換
  const aggregated: AggregatedScore[] = [];
  for (const [term, clicks] of clicksByTerm) {
    const baseScore = baseScoreByTerm.get(term) ?? 0;
    const newScore = baseScore + clicks * CLICK_WEIGHT;
    aggregated.push({ term, clicks, baseScore, newScore });
  }

  // クリックが多い順に並べる（人気ランキングとして見やすい）
  aggregated.sort((a, b) => b.clicks - a.clicks);

  // 書き出し
  const outPath = path.join(DATA_DIR, 'aggregated-scores.json');
  await writeFile(outPath, JSON.stringify(aggregated, null, 2), 'utf-8');

  console.log(`[aggregate] ${logs.length} 件のクリックログ → ${aggregated.length} 単語を集計`);
  console.log(`[aggregate] 出力: ${outPath}`);
}

main().catch((err: unknown) => {
  console.error('[aggregate] 失敗:', err);
  process.exit(1);
});
