// ============================================================
// 全IDカウンターの一元管理
//
// セーブ/ロード時にカウンターを復元しないと、ロード後に生成された
// 人物が既存の人物と同じIDになり(person-1が2人)、王位継承や
// 人物選択がおかしくなる。ここで一括して保存/復元できるようにする。
// ============================================================

export interface IdCounters {
  nation: number;
  person: number;
  city: number;
  event: number;
}

const counters: IdCounters = { nation: 0, person: 0, city: 0, event: 0 };

export function nextId(kind: keyof IdCounters): string {
  counters[kind] += 1;
  return `${kind}-${counters[kind]}`;
}

export function getIdCounters(): IdCounters {
  return { ...counters };
}

export function setIdCounters(next: Partial<IdCounters> | undefined | null): void {
  if (!next) return;
  counters.nation = next.nation ?? counters.nation;
  counters.person = next.person ?? counters.person;
  counters.city = next.city ?? counters.city;
  counters.event = next.event ?? counters.event;
}

export function resetIdCounters(): void {
  counters.nation = 0;
  counters.person = 0;
  counters.city = 0;
  counters.event = 0;
}