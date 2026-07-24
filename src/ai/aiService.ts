// ============================================================
// AIサービス
//
// 設計方針:
//   - ゲームの通常進行(内政/戦争/外交/技術)はAIを一切使わない。
//   - 王との会話・歴史書生成・戦争理由の説明など「物語性」が
//     必要な場面でのみ、このサービス経由でテキスト生成を試みる。
//   - ローカルAIモデル(約1GB程度を想定)が未ダウンロード/無効の場合は
//     即座にフォールバック(テンプレート文)を返し、ゲームが止まらない
//     ようにする。
//   - モデルは @xenova/transformers を利用し、初回のみブラウザの
//     Cache Storageにダウンロードされ、以降はオフラインで動作する。
// ============================================================

export type AiStatus = "disabled" | "idle" | "loading" | "ready" | "error";

export interface AiProgress {
  status: AiStatus;
  progress: number; // 0-100
  message: string;
}

// 実際に使うモデルはここを差し替えるだけで良い。
// 目安として ~1GB 前後の軽量チャットモデルを想定。
// (端末の性能に応じて、より小さいモデルに変更しても構わない)
export const DEFAULT_MODEL_ID = "Xenova/Qwen1.5-1.8B-Chat";
export const LIGHT_MODEL_ID = "Xenova/Qwen1.5-0.5B-Chat";

const STORAGE_KEY_ENABLED = "ai-world-sim:ai-enabled";
const STORAGE_KEY_MODEL = "ai-world-sim:ai-model";

type Listener = (p: AiProgress) => void;

class AIService {
  private status: AiStatus = "idle";
  private progressValue = 0;
  private generator: any = null;
  private loadingPromise: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  get modelId(): string {
    return localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL_ID;
  }

  set modelId(id: string) {
    localStorage.setItem(STORAGE_KEY_MODEL, id);
  }

  get enabled(): boolean {
    return localStorage.getItem(STORAGE_KEY_ENABLED) === "1";
  }

  set enabled(value: boolean) {
    localStorage.setItem(STORAGE_KEY_ENABLED, value ? "1" : "0");
    if (!value) {
      this.status = "disabled";
      this.emit();
    } else if (this.status === "disabled") {
      this.status = "idle";
      this.emit();
    }
  }

  getStatus(): AiProgress {
    return { status: this.status, progress: this.progressValue, message: this.statusMessage() };
  }

  private statusMessage(): string {
    switch (this.status) {
      case "disabled":
        return "ローカルAIは無効です(テンプレート文で動作中)";
      case "idle":
        return "未読み込み";
      case "loading":
        return `モデルを読み込み中... ${this.progressValue}%`;
      case "ready":
        return "ローカルAI準備完了";
      case "error":
        return "AIモデルの読み込みに失敗しました";
    }
  }

  onProgress(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const p = this.getStatus();
    for (const l of this.listeners) l(p);
  }

  /** モデルを明示的にダウンロード/初期化する(設定画面のボタン等から呼ぶ) */
  async ensureLoaded(): Promise<boolean> {
    if (!this.enabled) return false;
    if (this.status === "ready") return true;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return (this.status as AiStatus) === "ready";
    }

    this.status = "loading";
    this.progressValue = 0;
    this.emit();

    this.loadingPromise = (async () => {
      try {
        // 動的importにより、AIを使わないユーザーは
        // transformers.js (数MB) すら読み込まずに済む。
        const { pipeline, env } = await import("@xenova/transformers");
        env.allowLocalModels = false;

        this.generator = await pipeline("text-generation", this.modelId, {
          progress_callback: (p: any) => {
            if (p?.status === "progress" && typeof p.progress === "number") {
              this.progressValue = Math.round(p.progress);
              this.emit();
            }
          }
        });

        this.status = "ready";
        this.progressValue = 100;
        this.emit();
      } catch (err) {
        console.error("AIモデルの読み込みに失敗:", err);
        this.status = "error";
        this.emit();
      }
    })();

    await this.loadingPromise;
    this.loadingPromise = null;
    return (this.status as AiStatus) === "ready";
  }

  /**
   * テキスト生成。モデルが使えない場合は即座に fallback() の結果を返す。
   * 呼び出し側は必ず fallback を用意すること(オフライン/低スペック端末対応)。
   */
  async generate(
    prompt: string,
    fallback: () => string,
    options: { maxNewTokens?: number } = {}
  ): Promise<{ text: string; usedAi: boolean }> {
    if (!this.enabled) {
      return { text: fallback(), usedAi: false };
    }

    const ready = await this.ensureLoaded();
    if (!ready || !this.generator || (this.status as AiStatus) !== "ready") {
      return { text: fallback(), usedAi: false };
    }

    try {
      const output = await this.generator(prompt, {
        max_new_tokens: options.maxNewTokens ?? 80,
        temperature: 0.8,
        do_sample: true,
        top_p: 0.9
      });
      const raw = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
      const text = typeof raw === "string" ? raw.replace(prompt, "").trim() : "";
      return { text: text || fallback(), usedAi: Boolean(text) };
    } catch (err) {
      console.error("AI生成エラー:", err);
      return { text: fallback(), usedAi: false };
    }
  }
}

export const aiService = new AIService();
