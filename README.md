# Mini Suggest Lab 🔎

検索オートコンプリート（サジェスト）の仕組みを、**コードを読んで・動かして**理解するための学習用プロジェクトです。

同じバックエンド検索ロジック（Trie）を使って、**AJAX（HTTP）** と **WebSocket** の 2 つの通信方式を切り替えられます。
「検索の中身は同じで、運び方だけ違う」を体感するのが目的です。

> 読みやすさ・シンプルな構成・教育的なコメントを最優先にしています。本番運用向けの複雑さはあえて省いています。

---

## 目次

1. [このプロジェクトは何か](#このプロジェクトは何か)
2. [動かし方](#動かし方)
3. [画面の使い方](#画面の使い方)
4. [AJAX モードの仕組み](#ajax-モードの仕組み)
5. [WebSocket モードの仕組み](#websocket-モードの仕組み)
6. [Trie 検索の仕組み](#trie-検索の仕組み)
7. [なぜサジェストには AJAX が自然なのか](#なぜサジェストには-ajax-が自然なのか)
8. [なぜ WebSocket を学習で並べるのか](#なぜ-websocket-を学習で並べるのか)
9. [クリックログとは](#クリックログとは)
10. [集計スクリプトとは](#集計スクリプトとは)
11. [実サービスとの対応](#実サービスとの対応)
12. [プロジェクト構成](#プロジェクト構成)
13. [最初に読むと良いファイル](#最初に読むと良いファイル)

---

## このプロジェクトは何か

- 検索ボックスに文字を打つと、前方一致（prefix）でサジェスト候補が出ます。
- 候補は **Trie（トライ木）** という木構造から高速に取り出します。
- 通信方式を **AJAX / WebSocket** で切り替えて、違いを観察できます。
- 候補をクリックすると **クリックログ**が記録され、それを**集計**して人気度（スコア）を更新する流れまで体験できます。

---

## 動かし方

必要なもの: Node.js 18 以上（推奨 v20+）。

```bash
# 1. 依存パッケージをインストール
npm install

# 2. サーバを起動（http://localhost:3000）
npm run dev

# 3. クリックログを集計（data/aggregated-scores.json を生成）
npm run aggregate

# 4. 集計結果を辞書に反映（data/words-updated.json を生成）
npm run rebuild
```

起動したらブラウザで **http://localhost:3000** を開きます。

### 集計後の新しいスコアでサーバを動かす

サーバは既定で `data/words.json` を読みます。集計を反映した `data/words-updated.json` を使いたいときは、環境変数で切り替えます。

```bash
# 集計 → 辞書再構築 → 新しい辞書でサーバ起動
npm run aggregate
npm run rebuild
WORDS_FILE=words-updated.json npm run dev
```

ポートを変えたいとき:

```bash
PORT=4000 npm run dev
```

---

## 画面の使い方

- 上部のタブで **AJAX (HTTP) モード / WebSocket モード** を切り替えます。
- 検索ボックスに `tok` / `java` / `web` / `py` / `re` などを入力すると候補が出ます。
- 候補をクリックすると入力欄に確定し、クリックログがサーバへ送られます。
- 下の「デバッグ情報」で、現在のモード・最新クエリ・`requestId`・応答の `transport`（http か websocket か）を確認できます。

---

## AJAX モードの仕組み

1. 入力を **200ms デバウンス**（入力が止まってから送る）します。
2. 次のような HTTP リクエストを送ります。

   ```
   GET /api/suggest?q=tok&limit=10
   ```

3. サーバは Trie で検索し、JSON を返します。

   ```json
   {
     "type": "suggestions",
     "transport": "http",
     "q": "tok",
     "items": [
       { "term": "tokyo", "score": 100 },
       { "term": "tokyo station", "score": 90 }
     ]
   }
   ```

4. フロントはこれを描画します。リクエストごとに通し番号（`requestId`）を持たせ、**古い応答は捨てます**（後述）。

該当コード: `src/server.js` の `GET /api/suggest`、`public/app.js` の `sendHttp()`。

---

## WebSocket モードの仕組み

1. ページ読み込み時に **1 本の WebSocket 接続**（`ws://.../ws`）を張り、開いたままにします。
2. 入力は同じく **200ms デバウンス**。
3. 接続にメッセージ（JSON）を流します。

   ```json
   { "type": "suggest", "q": "tok", "limit": 10, "requestId": 12 }
   ```

4. サーバは `requestId` をそのまま返し（echo）、候補を送り返します。

   ```json
   {
     "type": "suggestions",
     "transport": "websocket",
     "q": "tok",
     "requestId": 12,
     "items": [
       { "term": "tokyo", "score": 100 },
       { "term": "tokyo station", "score": 90 }
     ]
   }
   ```

5. フロントは応答の `requestId` を見て、**いま画面に出ているものより古ければ無視**します（stale 対策）。

該当コード: `src/server.js` の `wss.on('connection', ...)`、`public/app.js` の `connectWebSocket()` / `sendWs()` / `handleResults()`。

### stale（古い応答）対策とは

ネットワークの都合で、後から送ったリクエストの応答が先に届くことがあります。
そのまま描画すると、新しい結果が古い結果で上書きされてしまいます。
そこで送信ごとに増える通し番号 `requestId` を付け、「すでに描画した番号以下の応答は捨てる」ことで防ぎます。
AJAX モードでも同じ通し番号を共有し、同じロジックで判定しています（`handleResults()`）。

---

## Trie 検索の仕組み

`src/trie.js` に**自前実装**しています。コメントを多めに付けているので、まずここを読むのがおすすめです。

- **Trie ノード**: 「ある1文字までの経路（= ある prefix）」を表す点。`children`（次の文字への枝）、`isWord`（ここで単語が終わるか）、`term`/`score`（終端なら単語と重み）、`topCandidates`（上位候補のキャッシュ）を持ちます。
- **なぜ prefix 検索に強い?**: `tok` と打てば `root → t → o → k` と**入力文字数ぶんだけ**たどれば候補の入口に着きます。全単語を走査しません。
- **挿入 (`insert`)**: 単語の文字を1つずつ下りながらノードを作り、**通過する各 prefix ノードの `topCandidates` を更新**します。
- **prefix 探索 (`suggest`)**: prefix の文字数ぶん下り、着いたノードの `topCandidates` から `limit` 件返すだけ。**毎回 DFS（深さ優先で全部集める）をしないので速い**のがポイントです。

```js
const trie = new Trie();
trie.insert("tokyo", 100);
trie.insert("tokyo station", 90);
trie.suggest("tok", 10);
// => [ { term: "tokyo", score: 100 }, { term: "tokyo station", score: 90 } ]
```

> 補足: 各ノードが保持する上位候補数は `maxCandidatesPerNode`（既定 10）で制限しています。メモリと応答速度のトレードオフで、ここを大きくすると `limit` の大きいリクエストにも応えられます。

---

## なぜサジェストには AJAX が自然なのか

オートコンプリートは基本的に「ユーザーが打つ → サーバが返す」という **一方向の単発リクエスト**の繰り返しです。

- リクエスト/レスポンスが 1 対 1 で完結する。
- HTTP はキャッシュ・ロードバランサ・CDN などインフラとの相性が良い。
- ステート（接続）を持たないのでスケールさせやすい。

そのため、サジェストは AJAX（HTTP）で実装するのが素直で、実サービスでも一般的です。

---

## なぜ WebSocket を学習で並べるのか

WebSocket は **1 本の接続を張りっぱなし**にして双方向にやり取りする方式で、本来は次のような用途で本領を発揮します。

- チャット、通知、株価・スコアなど**サーバ側から push したい**もの。
- 毎回の接続確立コストを避けたい高頻度通信。

サジェスト自体は AJAX で十分ですが、このプロジェクトでは

- 「同じ検索ロジックを、別の運び方（transport）で呼ぶ」と何が変わるか、
- 接続が張りっぱなしであること、`requestId` による stale 対策、

を**手を動かして体感する実験台**として WebSocket を並べています。

---

## クリックログとは

候補をクリックすると、フロントが次を送ります。

```
POST /api/click
{ "term": "tokyo", "query": "tok", "transport": "http" }
```

サーバはこれを `data/click-logs.json` に**追記**します（`src/logService.js`）。
これは実サービスの「ユーザー行動ログを集める」工程のミニチュアです。

> サンプルとして最初から数件のログが入っています。自由に消したり、UI から増やしたりして構いません。

---

## 集計スクリプトとは

「ログを溜める → 集計する → 辞書に反映する」という流れを 2 つのスクリプトで再現します。

### `npm run aggregate`（`scripts/aggregate-clicks.js`）

- `data/click-logs.json`（行動ログ）と `data/words.json`（元の重み）を読みます。
- term ごとのクリック数を数え、`newScore = baseScore + クリック数 × 重み` を計算します。
- 結果を `data/aggregated-scores.json` に書きます。

```json
[
  { "term": "tokyo", "clicks": 3, "baseScore": 100, "newScore": 103 },
  { "term": "typescript", "clicks": 3, "baseScore": 95, "newScore": 98 }
]
```

> スコアの決め方はわざと単純です。実際は CTR（表示に対するクリック率）、表示位置バイアス、新しさ（時間減衰）などを使います。`CLICK_WEIGHT` を変えると挙動が変わります。

### `npm run rebuild`（`scripts/rebuild-trie-data.js`）

- `data/words.json`（元辞書）と `data/aggregated-scores.json`（集計結果）を読みます。
- 集計で更新された term は新スコアで上書き、それ以外は元のまま、にして
  `data/words-updated.json` を書きます（`words.json` と同じ形式）。

この `words-updated.json` を `WORDS_FILE=words-updated.json npm run dev` で読み込ませると、「クリックされた語ほど上位に出る」更新が反映されます。

---

## 実サービスとの対応

この小さなプロジェクトは、大規模なオートコンプリートの主要な要素を縮小して並べています。

| この教材 | 実サービスでの対応 |
| --- | --- |
| `src/trie.js`（Trie + topCandidates） | サジェスト用のインデックス／前計算済み候補（多くは分散インデックスやキャッシュ層） |
| `GET /api/suggest` / WebSocket | サジェスト API（HTTP/RPC、エッジでのキャッシュ） |
| `data/click-logs.json` | 行動ログ収集基盤（ログ収集 → メッセージキュー → データレイク） |
| `scripts/aggregate-clicks.js` | バッチ/ストリーム集計（人気度・CTR・時間減衰の計算） |
| `scripts/rebuild-trie-data.js` → `words-updated.json` | インデックス再構築・デプロイ（新しい辞書を本番へ反映） |
| `requestId` による stale 対策 | クライアント側の競合・順序制御 |
| `200ms` デバウンス | リクエスト削減（負荷とコストの最適化） |

全体像:

```
ユーザー入力
   │ (debounce)
   ▼
サジェストAPI ──▶ Trie 検索 ──▶ 候補を返す
   │
クリック
   ▼
行動ログ(click-logs) ──▶ 集計(aggregate) ──▶ 集計データ(aggregated-scores)
                                                   │
                                                   ▼
                                      辞書再構築(rebuild) ──▶ 新辞書(words-updated)
                                                                  │
                                                                  ▼
                                                        次回起動で反映
```

---

## プロジェクト構成

```
.
├── package.json
├── README.md
├── data/
│   ├── words.json              # 元の単語辞書（term, score）
│   ├── click-logs.json         # クリックログ（行動ログ）
│   ├── aggregated-scores.json  # 集計結果（aggregate で生成）
│   └── words-updated.json      # 反映後の辞書（rebuild で生成）
├── public/
│   ├── index.html              # 画面
│   ├── styles.css              # スタイル
│   └── app.js                  # フロントのロジック（debounce/通信/描画）
├── src/
│   ├── server.js               # Express + WebSocket サーバ
│   ├── trie.js                 # Trie 検索エンジン（自前実装）
│   ├── suggestionService.js    # 辞書読み込み + Trie 構築 + 検索の入口
│   └── logService.js           # クリックログの読み書き
└── scripts/
    ├── aggregate-clicks.js     # ログ集計
    └── rebuild-trie-data.js    # 辞書再構築
```

---

## 最初に読むと良いファイル

理解しやすい順序です。

1. **`src/trie.js`** … 検索の心臓部。Trie とは何か、なぜ速いかをコメント付きで。
2. **`src/suggestionService.js`** … 辞書を読んで Trie を作り、`getSuggestions()` に集約する流れ。
3. **`src/server.js`** … AJAX / WebSocket / クリックログの 3 入口が、同じ検索につながる様子。
4. **`public/app.js`** … debounce、モード切替、`requestId` による stale 対策、クリックログ送信。
5. **`scripts/aggregate-clicks.js` → `scripts/rebuild-trie-data.js`** … ログ→集計→辞書反映のデータパイプライン。

楽しんで読んでみてください！
