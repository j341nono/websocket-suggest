// =============================================================================
//  src/types.ts  ―  プロジェクト全体で共有する型定義
// =============================================================================
//
//  TypeScript では「データの形」を型として一箇所にまとめておくと、
//  サーバ・サービス・スクリプトの間で食い違いが起きにくくなります。
//  ここはランタイムのコード（実際に動く処理）を一切持たず、
//  interface / type だけを並べた“設計図”のファイルです。
// =============================================================================

/** 通信方式。HTTP(AJAX) か WebSocket のどちらか。 */
export type Transport = 'http' | 'websocket';

/** サジェスト候補 1 件。term（単語）と score（重み）を持つ。 */
export interface Suggestion {
  term: string;
  score: number;
}

/** 辞書ファイル（words.json）の 1 行。形は Suggestion と同じ。 */
export type WordEntry = Suggestion;

/** クリックログ 1 件（data/click-logs.json に保存される形）。 */
export interface ClickLogEntry {
  term: string;
  query: string;
  transport: Transport;
  timestamp: string;
}

/** クライアント → サーバ（WebSocket）へ送る「サジェスト要求」。 */
export interface SuggestRequest {
  type: 'suggest';
  q: string;
  limit?: number;
  requestId?: number;
}

/** サーバ → クライアントへ返す「サジェスト応答」。HTTP/WebSocket 共通。 */
export interface SuggestionsResponse {
  type: 'suggestions';
  transport: Transport;
  q: string;
  requestId?: number; // WebSocket のときだけ付く（stale 判定に使う）
  items: Suggestion[];
}

/** 集計結果（data/aggregated-scores.json）の 1 行。 */
export interface AggregatedScore {
  term: string;
  clicks: number;
  baseScore: number;
  newScore: number;
}
