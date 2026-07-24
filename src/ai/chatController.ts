import { Rng } from "../core/rng";
import { Nation, Person } from "../core/types";
import { GameWorld } from "../core/simulation";
import { aiService } from "../ai/aiService";
import { fallbackChatReply } from "../ai/templates";

interface ChatLine {
  speaker: "player" | "npc";
  text: string;
}

const ROLE_LABEL: Record<string, string> = {
  king: "王",
  heir: "王",
  general: "将軍",
  merchant: "商人",
  scholar: "学者"
};

export class ChatController {
  private histories = new Map<string, ChatLine[]>();
  private chatRng = new Rng(Date.now() & 0xffffffff);

  constructor(private world: GameWorld) {}

  private historyFor(personId: string): ChatLine[] {
    if (!this.histories.has(personId)) this.histories.set(personId, []);
    return this.histories.get(personId)!;
  }

  render(container: HTMLElement, person: Person, nation: Nation, onMessageAdded: () => void) {
    container.innerHTML = "";
    const panel = document.createElement("div");
    panel.className = "chat-panel";

    const log = document.createElement("div");
    log.className = "chat-log";

    const history = this.historyFor(person.id);
    if (history.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = `${ROLE_LABEL[person.role] ?? ""}${person.name}に話しかけてみましょう。`;
      log.appendChild(hint);
    } else {
      for (const line of history) {
        log.appendChild(this.renderLine(line, person));
      }
    }

    const inputRow = document.createElement("div");
    inputRow.className = "chat-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "メッセージを入力...";
    const sendBtn = document.createElement("button");
    sendBtn.className = "btn btn--gold";
    sendBtn.textContent = "送信";

    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      input.disabled = true;
      sendBtn.disabled = true;

      history.push({ speaker: "player", text });
      log.appendChild(this.renderLine({ speaker: "player", text }, person));
      log.scrollTop = log.scrollHeight;

      const thinking = document.createElement("div");
      thinking.className = "chat-msg";
      thinking.innerHTML = `<span class="chat-msg__speaker">${person.name}</span>…`;
      log.appendChild(thinking);
      log.scrollTop = log.scrollHeight;

      const prompt = this.buildPrompt(person, nation, history, text);
      const { text: replyText } = await aiService.generate(prompt, () =>
        fallbackChatReply(person, nation, this.chatRng)
      );

      thinking.remove();
      history.push({ speaker: "npc", text: replyText });
      log.appendChild(this.renderLine({ speaker: "npc", text: replyText }, person));
      log.scrollTop = log.scrollHeight;

      person.achievements.push(`「${replyText}」`);
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
      onMessageAdded();
    };

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    panel.appendChild(log);
    panel.appendChild(inputRow);
    container.appendChild(panel);
    log.scrollTop = log.scrollHeight;
  }

  private renderLine(line: ChatLine, person: Person): HTMLElement {
    const div = document.createElement("div");
    div.className = "chat-msg" + (line.speaker === "player" ? " chat-msg--player" : "");
    const speaker = document.createElement("span");
    speaker.className = "chat-msg__speaker";
    speaker.textContent = line.speaker === "player" ? "あなた" : person.name;
    div.appendChild(speaker);
    div.appendChild(document.createTextNode(line.text));
    return div;
  }

  private buildPrompt(person: Person, nation: Nation, history: ChatLine[], latest: string): string {
    const roleLabel = ROLE_LABEL[person.role] ?? "人物";
    const recent = history
      .slice(-6)
      .map((l) => `${l.speaker === "player" ? "プレイヤー" : person.name}: ${l.text}`)
      .join("\n");

    return [
      `あなたは剣と魔法の世界に生きる${nation.name}の${roleLabel}「${person.name}」です。`,
      `性格: 知恵${person.traits.wisdom} 野心${person.traits.ambition} 冷酷さ${person.traits.cruelty} カリスマ${person.traits.charisma} (0-100)。`,
      `${nation.name}の現状: 人口${nation.population}、国庫${nation.treasury}、安定度${nation.stability}/100。`,
      "プレイヤー(見えざる神のような存在)との会話です。日本語で、2文以内の短い口調で返答してください。",
      recent,
      `プレイヤー: ${latest}`,
      `${person.name}:`
    ].join("\n");
  }
}
