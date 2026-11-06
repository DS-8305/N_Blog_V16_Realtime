// 뉴스체·상투 표현 금지 목록 (AGENTS.md 연예 홈판 규칙, docs/review-notes.md 참고).
// label은 오류 코드(banned_phrase:<label>:<위치>)에 그대로 쓰인다. 활용형까지 잡아야 하면 pattern에 반영한다.
export type BannedPhrase = { label: string; pattern: RegExp };
export const BANNED_PHRASES: readonly BannedPhrase[] = [
  // 자아내다의 모든 활용형: 자아내, 자아냈, 자아낸, 자아낼, 자아냄
  { label: '자아내', pattern: /자아[내냈낸낼냄]/u },
  { label: '큰 웃음', pattern: /큰\s*웃음/u },
  // 모으다 활용형: 모으, 모아, 모았, 모은, 모을, 모읍
  { label: '기대를 모으', pattern: /기대를\s*모[으아았은을읍]/u },
  // 끌다 활용형: 끌, 끈, 끕니다
  { label: '눈길을 끌', pattern: /눈길을\s*[끌끈끕]/u },
  { label: '화제를 모으', pattern: /화제를\s*모[으아았은을읍]/u },
  // 이목을/이목이 집중(시키다·되다) 모든 형태
  { label: '이목을 집중', pattern: /이목[을이]\s*집중/u },
  { label: '관심이 쏠', pattern: /관심이\s*쏠/u },
  { label: '귀추가', pattern: /귀추가/u },
];
export function findBannedPhrases(text: string): string[] {
  const normalized = text.normalize('NFC');
  return BANNED_PHRASES.filter((p) => p.pattern.test(normalized)).map((p) => p.label);
}
