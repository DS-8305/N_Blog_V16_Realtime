# Naver Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly requested continuous implementation through final verification without further questions.

**Goal:** 사용자가 전달한 실시간 이슈의 원고와 이미지 12장 이상을 준비해 포트 9225의 네이버 에디터에 입력하고 임시저장을 검증하는 CLI를 만든다.

**Architecture:** Codex가 조사와 원고를 JSON으로 작성한다. TypeScript CLI는 데이터 검증·작업 상태·이미지 검색기·캡처·네이버 입력과 저장 재조회를 담당한다. 이미지별 다운로드·캡처를 같은 자산 계약에 연결한다.

**Tech Stack:** Node.js 22, TypeScript, Playwright, sharp, Python Selenium 이미지 수집기, Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-20-naver-realtime-design.md`

## Global Constraints

- 본문 공백 포함 1,000~1,200자; 소제목 포함, 제목·캡션·출처·태그 제외.
- 소제목 4개와 소제목별 최소 3장, 기본 12장; 추가 이미지도 전체 순서와 개수를 검증.
- 기본 CDP `http://127.0.0.1:9225`; 포트 대체 연결 없음.
- 공개·예약 발행 없음; 저장된 원고를 다시 확인한 경우에만 `draft_saved`.
- 사용자 지시에 따라 계획·구현 단계의 추가 승인 질문 없이 현재 전용 프로젝트에서 직접 실행.
- 입력 시도 이후 자료 불변, 불확실 입력·저장은 확인 없이 재전송하지 않음.

## Review Focus

- 경로 탈출·심볼릭 링크: 이미지와 증거는 작업 폴더 안의 실제 파일만 접근한다 (Task 1, 3).
- 중복 이미지·슬롯 누락: 전체 글의 해시 중복과 섹션 내부 순서를 검사한다 (Task 2, 3).
- 포트·블로그 불일치: 임의의 로그인 Chrome이나 다른 블로그에 입력하지 않는다 (Task 4, 5).
- 입력 직후 중단·저장 직후 중단: 시도 기록을 먼저 남기고 재개는 확인된 내용 이후에만 수행한다 (Task 5).
- 저장 목록 동명 글·서버 내용 불일치: 개수 증가만으로 성공 판정하지 않는다 (Task 5, 6).

### Task 1: 실행 환경·설정·작업 계약

**Files:** `package.json`, `tsconfig.json`, `build.mjs`, `src/domain/types.ts`, `src/domain/validation.ts`, `src/config.ts`, `src/state/files.ts`, `src/state/jobs.ts`, `tests/core.test.ts`.

**Interfaces:** `resolveConfig(options, root): Promise<Config>`; `initJob(config, topic): Promise<string>`; `readJob(path): Promise<JobRequest>`; `validateResearch(request, research): string[]`; `safeFile(root, relative): Promise<string>`.

- [x] 테스트: 기본 9225·옵션 우선순위·원격 CDP 차단, 작업 초기화 기본값, 날짜·사실 참조 오류, 경로 탈출·링크 차단을 작성한다.
- [x] `npm test -- tests/core.test.ts`로 누락 기능의 실패를 확인한다.
- [x] 고정 기본값, 런타임 검증, 원자적 JSON, 작업 잠금과 변경 금지를 구현한다.
- [x] 해당 테스트와 `npm run typecheck`로 검증하고 커밋한다.

### Task 2: 원고·이미지 계획·최종 검토

**Files:** `src/editorial/post.ts`, `src/editorial/bundle.ts`, `tests/editorial.test.ts`, `tests/helpers.ts`.

**Interfaces:** `validatePost(request, research, post): string[]`; `bodyLength(post): number`; `loadDraft(job): Promise<PreparedDraft>`; `preparePost(job): Promise<ReviewBasis>`; `recordReview(job, fingerprint, reviewer): Promise<void>`.

- [x] 테스트: 999/1000/1200/1201자 경계, 캡션 제외, 섹션별 3장, 13장 유지, 동일 슬롯·사실 누락, 파일 수정 후 검토 만료를 작성한다.
- [x] 테스트 실패를 확인한 뒤 순서 있는 이미지 슬롯과 입력 이벤트를 구현한다.
- [x] 미리보기와 해시 기반 검토 기록을 구현한다. 검토 명령은 실제로 검토한 사람이 명시적으로 호출한다.
- [x] 테스트·타입 검사로 검증하고 커밋한다.

### Task 3: 이미지 수집·캡처

**Files:** `image_collector/`, `requirements.txt`, `src/images/collect.ts`, `src/images/assets.ts`, `src/capture/capture.ts`, `tests/images.test.ts`.

**Interfaces:** `collectImages(job, options): Promise<void>`; `captureImages(job, options): Promise<void>`; `validateAssets(job, request, post): Promise<Asset[]>`.

- [x] 테스트: 실제 PNG 검증, 중복 해시, 계획별 출처·순서, Python manifest 파싱, 누락·실패 슬롯, 캡처 준비 상태 검사를 작성한다.
- [x] 테스트 실패 확인 후 고정 커밋의 Python 수집기와 필요한 캡처 준비 검사를 이식한다.
- [x] Python은 shell 없이 실행하고 슬롯마다 결과를 보관한다. 실패한 시도는 기존 성공을 무효화한다.
- [x] 테스트·타입 검사, Python 컴파일과 CLI 도움말을 확인하고 커밋한다.

### Task 4: 브라우저·SmartEditor 입력

**Files:** `src/browser/`, `src/automation/selectors.ts`, `editorHelpers.ts`, `textWriter.ts`, `imageUploader.ts`, `imageCaption.ts`, `editorPort.ts`, `tests/editor.test.ts`.

**Interfaces:** `openSession(config, request, targetId?): Promise<Session>`; `EditorPort`의 `snapshot/apply/save/confirm`; `createEditorPort(session): EditorPort`.

- [x] 테스트: 실제 로컬 페이지에서 제목 뒤·인용 뒤·3장 연속 업로드 뒤 본문 위치와 각 캡션, 굵게 해제, 블로그 불일치 차단을 작성한다.
- [x] 테스트 실패 후 주식 레포의 에디터 코어를 공통 이벤트 계약으로 이식한다.
- [x] 작업 소유 탭·프로필·CDP 잠금과 인증·대상 확인, 종료 후 Chrome 유지를 구현한다.
- [x] 오프라인·로컬 브라우저 검증과 타입 검사 후 커밋한다.

### Task 5: 입력·저장·재개 상태 기계

**Files:** `src/automation/runner.ts`, `src/automation/readback.ts`, `tests/runner.test.ts`.

**Interfaces:** `runDraft(job, config, options?): Promise<RunResult>`; `matchesSnapshot(draft, snapshot, receipts): boolean`.

- [x] 테스트: 12장 저장 확인, 13장 순서 보존, 입력 시도 후 중단, 일치하는 접두 입력 재개, 미확인 입력 재전송 금지, 저장 시도 후 재저장 금지, 동명 저장 글·변조 영수증을 작성한다.
- [x] 테스트 실패 후 입력 직전 시도 기록·적용 확인 체크포인트·한 번 저장·재조회 흐름을 구현한다.
- [x] 재개 시 같은 CDP·프로필·탭·원고를 요구하고 저장 시도 후에는 확인만 한다.
- [x] 전체 테스트·타입 검사로 검증하고 커밋한다.

### Task 6: CLI·Windows 실행 도구·사용 문서

**Files:** `src/cli/main.ts`, `src/cli/args.ts`, `scripts/`, `nblog.config.example.json`, `README.md`, `AGENTS.md`, `docs/validation.md`, `tests/cli.test.ts`.

**Interfaces:** 빌드 결과 `dist/cli.js`; spec의 모든 명령, `post:review --fingerprint ... --reviewer ...`, `browser:login`, `doctor`.

- [x] 테스트: 빌드한 CLI로 작업 초기화·검사·오류 종료 코드·추가 이미지·검토 만료를 확인한다.
- [x] 테스트 실패 확인 후 CLI를 연결하고, Windows setup/login 실행 도구에 9225를 적용한다.
- [x] Codex 조사·작성 절차와 실제 검토 명령, 운영 예제·문제 해결·참고 코드 출처를 문서화한다.
- [x] `npm test`, `npm run typecheck`, `npm run build`, `node dist/cli.js help`, Python 검사와 로컬 브라우저 검사를 실행한다.

### Task 7: 최종 검토·수정·전달

**Files:** 위 변경 전체, `docs/validation.md`.

- [x] 별도 문맥의 코드 리뷰를 요청하고 실패 위험·요구사항 누락을 점검한다.
- [x] 중요한 지적은 재현 테스트를 먼저 작성해 수정한다.
- [x] 최종 검증을 새로 실행하고 오프라인 결과와 실계정 확인 범위를 구분해 기록한다.
- [x] 변경을 커밋하고 현재 폴더의 실행 방법과 남은 외부 실행 조건을 전달한다.
