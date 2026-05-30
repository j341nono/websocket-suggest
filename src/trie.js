// =============================================================================
//  src/trie.js  ―  Trie（トライ木）による prefix（前方一致）検索エンジン
// =============================================================================
//
//  ■ Trie（トライ木）とは？
//    文字列を「1文字ずつ」枝分かれさせて格納する木構造です。
//    たとえば "tokyo" と "toyota" を入れると、最初の "t" -> "o" までの
//    経路を共有し、3文字目で "k" と "y" に分かれます。
//
//        root
//         └─ t
//            └─ o
//               ├─ k ─ y ─ o        ("tokyo")
//               └─ y ─ o ─ t ─ a    ("toyota")
//
//  ■ なぜ prefix 検索に向いているのか？
//    "tok" と入力されたら、root から t -> o -> k と
//    「入力文字数ぶんだけ」ノードをたどるだけで、
//    "tok" で始まる単語の入口（ノード）に到達できます。
//    全単語を1つずつ調べる（線形スキャン）必要がありません。
//    つまり探索コストは「単語数」ではなく「入力文字数」に比例します。
//
//  ■ topCandidates という工夫
//    各ノードに「このノードを prefix に持つ単語のうち score 上位のもの」を
//    あらかじめ並べてキャッシュしておきます。
//    こうすると suggest のたびに木をたどって全候補を集める（DFS する）必要がなく、
//    「prefix ノードまで降りて、置いてある上位候補を返す」だけで済みます。
//    → autocomplete の応答がとても速くなります。
//
// =============================================================================

/**
 * Trie の 1 ノード。
 * 木の中の「ある1文字までの経路（= ある prefix）」を表します。
 */
class TrieNode {
  constructor() {
    // children: 「次の1文字」-> 子ノード への対応表。
    //   例) root.children.get('t') で "t" の子ノードが取れる。
    this.children = new Map();

    // isWord: このノードでちょうど単語が終わるなら true。
    //   "to" の途中ノードは false、"toyota" の終端ノードは true。
    this.isWord = false;

    // term / score: このノードが単語の終端のとき、その単語と重み（スコア）。
    this.term = null;
    this.score = 0;

    // topCandidates: このノードを prefix に持つ単語の「score 上位リスト」。
    //   要素は { term, score } の形。score 降順で並べてある。
    //   suggest のときはここをそのまま返すだけなので速い。
    this.topCandidates = [];
  }
}

export class Trie {
  /**
   * @param {number} maxCandidatesPerNode 各ノードが保持する上位候補の最大数。
   *   小さいほどメモリ節約だが、limit が大きいリクエストに応えられなくなる。
   *   学習用なのでデフォルト 10。
   */
  constructor(maxCandidatesPerNode = 10) {
    this.root = new TrieNode();
    this.maxCandidatesPerNode = maxCandidatesPerNode;
  }

  /**
   * 単語を1つ Trie に挿入する。
   *
   * ■ 挿入の流れ
   *   1. 単語を正規化（前後空白除去・小文字化）する。
   *   2. root から1文字ずつ下へ降りる。途中のノードが無ければ作る。
   *   3. 降りる「すべての prefix ノード」で topCandidates を更新する。
   *      → これにより、後で suggest するとき DFS せずに済む。
   *   4. 最後のノードに単語情報（isWord/term/score）を記録する。
   *
   * @param {string} term  単語
   * @param {number} score 重み（大きいほど上位に出る）
   */
  insert(term, score) {
    if (typeof term !== 'string') return;
    const normalized = term.trim().toLowerCase();
    if (normalized === '') return;
    const safeScore = Number.isFinite(score) ? score : 0;

    // root は「空 prefix（= 何も入力していない状態）」を表すノード。
    // ここにも候補を入れておくと、空入力時に「全体の人気上位」を返せる。
    this._updateTopCandidates(this.root, normalized, safeScore);

    let node = this.root;
    for (const char of normalized) {
      // 子ノードが無ければ新規作成
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char);

      // この prefix ノードの上位候補にもこの単語を反映
      this._updateTopCandidates(node, normalized, safeScore);
    }

    // たどり着いた終端ノードに単語そのものを記録
    node.isWord = true;
    node.term = normalized;
    node.score = safeScore;
  }

  /**
   * prefix にマッチする候補を score 降順で返す。
   *
   * ■ prefix lookup（前方一致探索）の流れ
   *   1. prefix を正規化する。
   *   2. root から prefix の文字数ぶんだけノードを下へたどる。
   *   3. 途中で文字が見つからなければ「該当なし」で空配列を返す。
   *   4. たどり着いたノードには既に上位候補が並んでいるので、
   *      その先頭から limit 件を返すだけ。（DFS 不要 = 速い）
   *
   * @param {string} prefix 入力中の文字列
   * @param {number} limit  返す最大件数
   * @returns {{term: string, score: number}[]}
   */
  suggest(prefix, limit = 10) {
    const normalized = (prefix ?? '').trim().toLowerCase();

    // prefix の文字数ぶんだけ下へたどる
    let node = this.root;
    for (const char of normalized) {
      const next = node.children.get(char);
      if (!next) {
        // この prefix で始まる単語は1つも無い
        return [];
      }
      node = next;
    }

    // 到達ノードに用意済みの上位候補から limit 件を返す。
    // （外から書き換えられないよう、新しいオブジェクトに詰め替えて返す）
    return node.topCandidates
      .slice(0, limit)
      .map((candidate) => ({ term: candidate.term, score: candidate.score }));
  }

  /**
   * あるノードの topCandidates を「term を score 付きで反映 → 降順整列 → 上限で切り詰め」する。
   * 挿入時に通過する各 prefix ノードで呼ばれる内部メソッド。
   * （メソッド名の先頭の _ は「内部用」という慣習的な目印）
   */
  _updateTopCandidates(node, term, score) {
    // 既に同じ term があればスコアだけ更新、無ければ新規追加
    const existing = node.topCandidates.find((c) => c.term === term);
    if (existing) {
      existing.score = score;
    } else {
      node.topCandidates.push({ term, score });
    }

    // score の降順に並べ替える
    node.topCandidates.sort((a, b) => b.score - a.score);

    // 上位 maxCandidatesPerNode 件だけ残す（メモリと速度のトレードオフ）
    if (node.topCandidates.length > this.maxCandidatesPerNode) {
      node.topCandidates.length = this.maxCandidatesPerNode;
    }
  }
}
