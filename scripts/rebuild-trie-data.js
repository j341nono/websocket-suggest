// =============================================================================
//  scripts/rebuild-trie-data.js  ―  辞書再構築バッチ
// =============================================================================
//
//  集計の流れ（再掲）：
//     ① click-logs.json → ② aggregate-clicks.js → ③ このスクリプト
//
//  このスクリプトは ③「辞書再構築」を担当します。
//
//  ■ やること
//    - data/words.json（元の辞書）を読む
//    - data/aggregated-scores.json（集計結果）を読む
//    - term ごとに、集計で出た newScore があればそれを採用、無ければ元スコアを維持
//    - 結果を data/words-updated.json に書く（words.json と同じ形式）
//
//  サーバは既定で words.json を読みますが、環境変数で words-updated.json に
//  切り替えられます（README 参照）。これは実サービスの
//  「集計結果を反映した新しい辞書を本番へ反映する」流れのミニチュアです。
// =============================================================================

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

/** data/ 配下の JSON を読む。失敗したら fallback を返す。 */
async function readJson(fileName, fallback) {
  try {
    const raw = await readFile(path.join(DATA_DIR, fileName), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[rebuild] ${fileName} を読めませんでした（${err.message}）。既定値を使います。`);
    return fallback;
  }
}

async function main() {
  const words = await readJson('words.json', []);
  const aggregated = await readJson('aggregated-scores.json', []);

  // term -> newScore（集計で更新されたスコア）の対応表
  const newScoreByTerm = new Map();
  for (const row of aggregated) {
    if (row && typeof row.term === 'string') {
      newScoreByTerm.set(row.term, Number(row.newScore) || 0);
    }
  }

  // 元辞書の各 term を、集計結果があれば新スコアで上書きして作り直す
  const updated = words.map((word) => {
    const term = word.term;
    const score = newScoreByTerm.has(term) ? newScoreByTerm.get(term) : Number(word.score) || 0;
    return { term, score };
  });

  // 集計結果にあるが元辞書に無い term（新しく人気が出た語）も取り込む
  const knownTerms = new Set(words.map((w) => w.term));
  for (const [term, score] of newScoreByTerm) {
    if (!knownTerms.has(term)) {
      updated.push({ term, score });
    }
  }

  // 見やすいようにスコア降順で並べる
  updated.sort((a, b) => b.score - a.score);

  const outPath = path.join(DATA_DIR, 'words-updated.json');
  await writeFile(outPath, JSON.stringify(updated, null, 2), 'utf-8');

  console.log(`[rebuild] ${updated.length} 単語の辞書を再構築（更新あり: ${newScoreByTerm.size} 件）`);
  console.log(`[rebuild] 出力: ${outPath}`);
}

main().catch((err) => {
  console.error('[rebuild] 失敗:', err);
  process.exit(1);
});
