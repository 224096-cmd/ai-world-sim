# AI世界シミュレーター (PWA)

Fantasy Map Simulator の国家・歴史シミュレーションと、WorldBox のような神視点の介入を組み合わせた、AI世界シミュレーションゲームです。

- 国家の建国・発展・戦争・外交・滅亡をルールベースで自動シミュレーション
- 王・将軍・商人・学者などの人物が生成され、王位継承なども発生
- 年表・世界ニュースが自動生成される
- プレイヤーは「神」として天災・恩恵・資源発見・法律(税制/軍拡/交易)で介入できる
- 王などの人物とチャットで対話可能(ローカルAIモデル、なければテンプレートで応答)
- PC/Android/iPhone で動作する PWA (オフライン対応・無料・インストール可能)

## 設計方針(重要)

**AIがゲームを動かすのではなく、AIが物語を紡ぐ。**

- 国家運営・戦争・外交・経済・技術発展などの通常処理は、すべてルールベース/テンプレートで実装されており、AIを一切呼び出さずに高速に動作します (`src/core/`)。
- AIは「王との会話」「神託」など、物語性が必要な場面でのみ `src/ai/aiService.ts` 経由で呼び出されます。
- ローカルAIモデル(約1GB程度を想定、`@xenova/transformers` 経由でブラウザ内実行)が無効/未ダウンロードの場合は、即座に日本語のテンプレート文で応答するため、AIなしでも完全に遊べます。

---

## 1. 必要環境

- [Node.js](https://nodejs.org/) 18以上(20推奨)
- [VS Code](https://code.visualstudio.com/)

ターミナルで確認:

```bash
node -v
npm -v
```

## 2. セットアップ手順 (VSCodeのターミナルで実行)

このリポジトリ一式(zip)を展開し、フォルダごと VSCode で開いたら、統合ターミナル (``` Ctrl+` ```) で以下を実行してください。

```bash
# 依存パッケージのインストール
npm install

# 開発サーバーを起動 (http://localhost:5173)
npm run dev
```

ブラウザで `http://localhost:5173` を開けば動作します。スマホで確認する場合は同一Wi-Fi内から `npm run dev -- --host` で起動し、表示された Network の URL にアクセスしてください。

### 本番ビルド / PWA動作確認

Service Worker は開発モードでも有効ですが、実機に近い形で確認する場合はビルド後のプレビューを使ってください。

```bash
npm run build      # dist/ に本番ビルドを出力
npm run preview     # ビルド結果をローカルで配信して確認
```

### 新規プロジェクトとして作り直す場合のコマンド例

すでに zip から展開済みなら不要ですが、ゼロから同じ構成を作る場合の流れは以下の通りです(参考)。

```bash
mkdir ai-world-sim && cd ai-world-sim
npm init -y
npm install @xenova/transformers
npm install -D typescript vite vite-plugin-pwa
code .   # VSCodeで開く
```

その後、本zip内の `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` の内容をそのまま配置すれば同じ状態になります。

## 3. デプロイ (公開して無料でPWAとして使う)

静的ファイルをホスティングできるサービスであればどこでも公開できます(すべて無料枠あり)。`dist/` フォルダをそのままアップロードするだけです。

- **Cloudflare Pages**: `npm run build` → `dist` フォルダをドラッグ&ドロップ
- **GitHub Pages**: GitHubにpush → Actionsで `npm run build` → `dist` を公開
- **Netlify / Vercel**: リポジトリを連携し、Build command: `npm run build` / Publish directory: `dist`

公開後、スマホでURLを開き「ホーム画面に追加」を選ぶとPWAとしてインストールできます。

---

## 4. プロジェクト構成

```
ai-world-sim/
├── index.html                 # エントリーHTML
├── vite.config.ts             # Vite + PWAプラグイン設定(マニフェスト/キャッシュ戦略)
├── tsconfig.json
├── package.json
├── public/
│   └── icons/                 # PWAアイコン (svg/png)
└── src/
    ├── main.ts                 # 画面構築・状態管理・全パネルの結線(エントリーポイント)
    ├── style.css                # デザイントークン(古地図/インク基調のUI)
    ├── pwaRegister.ts           # Service Worker登録
    ├── vite-env.d.ts
    ├── core/                    # ゲームロジック(AI不使用・ルールベース)
    │   ├── types.ts             # 型定義 (Tile/Nation/Person/WorldEvent など)
    │   ├── rng.ts                # シード付き乱数 & 地形用ノイズ
    │   ├── nameGenerator.ts      # 文化圏ごとの国名/人名生成
    │   ├── worldgen.ts           # 地形(海/平野/森/山/砂漠/氷原)生成
    │   ├── nations.ts            # 建国・領土拡張・戦争判定などの補助関数
    │   ├── people.ts             # 王・将軍・商人・学者の生成
    │   ├── events.ts             # 年表/ニュースのテンプレート文
    │   └── simulation.ts         # GameWorldクラス: 1年ごとのメインループ、神の力API、セーブ/ロード
    ├── ai/                       # 物語生成(AI or フォールバック)
    │   ├── aiService.ts          # ローカルAIモデル(transformers.js)の抽象化レイヤー
    │   ├── templates.ts          # AI無効時のフォールバック文章(会話/神託など)
    │   └── chatController.ts     # 人物とのチャットUI + プロンプト構築
    └── ui/                       # 画面パーツ
        ├── renderer.ts           # Canvasへの地図描画・タイルのヒットテスト
        ├── panels.ts             # 国家/人物一覧・詳細、年表の描画
        └── godActions.ts         # 「神の力」パネル(天災・恩恵・法律など)
```

## 5. 拡張しやすい設計について

- **新しいイベントを増やす**: `src/core/events.ts` の `TEMPLATES` にキーと文言を追加し、`simulation.ts` の該当箇所から `generateTemplateEvent("キー", ...)` を呼ぶだけです。
- **新しい神の力を増やす**: `src/ui/godActions.ts` の `ACTIONS` に追加し、`src/main.ts` の `handleGodAction` に処理を1ケース追加、実処理は `GameWorld` にメソッドを1つ追加するだけです。
- **新しい人物の役職を増やす**: `src/core/types.ts` の `PersonRole` に追加し、`nameGenerator.ts` の称号テーブル・`panels.ts` の `ROLE_LABEL` を更新します。
- **AIモデルを差し替える**: `src/ai/aiService.ts` の `DEFAULT_MODEL_ID` / `LIGHT_MODEL_ID` を、`@xenova/transformers` で動作する別の `text-generation` 系モデルIDに変更するだけです(設定タブからも切り替え可能)。
- **セーブデータの拡張**: `GameWorld.toSnapshot()` / `fromSnapshot()` にフィールドを追加すれば、`localStorage` への自動保存に反映されます。

## 6. 既知の制約 / 今後の発展アイデア

- 現在のセーブは `localStorage` の単一スロットです。複数セーブスロットやクラウド同期は未実装です。
- チャット履歴はセッション内メモリのみで、セーブデータには含まれていません(会話の要約だけ人物の`achievements`に残ります)。
- ローカルAIモデルは初回ダウンロードにWi-Fi環境を推奨します(数百MB〜1GB程度)。低スペック端末では「軽量」モデルの利用、またはAI無効(テンプレートのみ)での利用を推奨します。
- 地図は正方グリッドの簡易ノイズ地形です。より自然な海岸線が必要であれば `src/core/worldgen.ts` のノイズ関数をSimplex Noise等に差し替えてください。
