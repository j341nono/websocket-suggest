// =============================================================================
//  src/suggestionService.js  ―  検索ロジックのまとめ役
// =============================================================================
//
//  このファイルの役割は「単語データ(JSON)を読み込み、Trie を1回だけ構築し、
//  クエリに対して候補を返す」ことです。
//
//  ★ ポイント：AJAX モードも WebSocket モードも、最終的にここの
//     getSuggestions() を呼びます。つまり「検索の本体」は共通で、
//     違うのは “通信のやり方” だけ、という構成になっています。
// =============================================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Trie } from './trie.js';

// ES Modules には __dirname が無いので自前で用意する（このファイルの場所）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

export class SuggestionService {
  constructor(maxCandidatesPerNode = 10) {
    this.trie = new Trie(maxCandidatesPerNode);
    this.wordCount = 0;
  }

  /**
   * data/ 配下の単語ファイルを読み込み、Trie を構築する。
   * 起動時に1回だけ呼ぶ想定。
   *
   * @param {string} wordsFileName 読み込むファイル名（既定: words.json）
   * @returns {Promise<number>} 取り込んだ単語数
   */
  async load(wordsFileName = 'words.json') {
    const filePath = path.join(DATA_DIR, wordsFileName);

    // --- ファイル読み込み（失敗時は分かりやすいエラーにする）---
    let raw;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`単語データを読み込めませんでした: ${filePath} (${err.message})`);
    }

    // --- JSON パース（壊れた JSON を握りつぶさずエラーにする）---
    let words;
    try {
      words = JSON.parse(raw);
    } catch (err) {
      throw new Error(`単語データの JSON が不正です: ${filePath} (${err.message})`);
    }

    if (!Array.isArray(words)) {
      throw new Error('単語データはオブジェクトの配列である必要があります');
    }

    // --- 1件ずつ Trie に挿入 ---
    let inserted = 0;
    for (const entry of words) {
      if (!entry || typeof entry.term !== 'string') continue; // 不正な行はスキップ
      const score = Number.isFinite(entry.score) ? entry.score : 0;
      this.trie.insert(entry.term, score);
      inserted += 1;
    }

    this.wordCount = inserted;
    return inserted;
  }

  /**
   * クエリ文字列に対する候補を返す。
   * AJAX / WebSocket どちらの入口からも、最後はこのメソッドに集約される。
   *
   * @param {string} query 入力中の文字列
   * @param {number} limit 返す最大件数
   * @returns {{term: string, score: number}[]}
   */
  getSuggestions(query, limit = 10) {
    const q = (query ?? '').trim();

    // 空クエリは候補なし（無駄な全件返しを避ける）
    if (q === '') return [];

    // limit を安全な範囲に丸める（不正値や巨大値への防御）
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : 10;

    return this.trie.suggest(q, safeLimit);
  }
}
