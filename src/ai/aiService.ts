// ============================================================
// 会話サービス
//
// v0.3.1 で外部AIライブラリ(@xenova/transformers)への依存を撤去。
// 理由: 内部依存の sharp が Windows でネイティブビルドに失敗し、
//       npm install が通らなくなるため。会話はテンプレート方式で
//       十分に成立するので、依存ごと削除して安定性を優先する。
//
// このモジュールは会話生成の窓口を1か所に保つためのラッパー。
// 将来また別の生成手段を差し込みたくなったら、generate() の中だけを
// 差し替えれば呼び出し側は変更不要。
// ============================================================

export interface AiProgress {
  status: "template";
  progress: number;
  message: string;
}

type Listener = (p: AiProgress) => void;

class AIService {
  private listeners = new Set<Listener>();

  getStatus(): AiProgress {
    return {
      status: "template",
      progress: 100,
      message: "会話はテンプレート方式で動作しています(外部通信なし)"
    };
  }

  onProgress(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  /** テキスト生成。現在は常に fallback() の結果を返す */
  async generate(
    _prompt: string,
    fallback: () => string,
    _options: { maxNewTokens?: number } = {}
  ): Promise<{ text: string; usedAi: boolean }> {
    return { text: fallback(), usedAi: false };
  }
}

export const aiService = new AIService();