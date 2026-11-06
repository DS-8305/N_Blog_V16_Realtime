# N_Blog_V16_Realtime

주제를 Codex에 전달하면 최신 자료를 조사해 원고와 이미지를 준비하고, 로컬 CLI가 네이버 블로그에 **임시저장**합니다.

- 본문 공백 포함 **1,000~1,600자**
- 본문 문단·소제목은 네이버 에디터에서 **가운데 정렬**
- 소제목은 네이버 **인용구 1** 스타일과 굵게 표시 (**4~6개**)
- **이미지 10~12장** (소제목당 기본 2~3장, 이미지와 본문 한 문장을 번갈아 배치)
- 사진별 캡션 없이, `post.json`의 `photoSources`를 모아 본문 맨 끝에 **"사진 출처 : 매체A, 매체B"** 1줄만 표기 (기존 전체 자료 출처 목록 자동 첨부 생략)
- 연예 홈판용 작성 규칙 적용 (제목 35~45자, 숫자 필수, '제목템플릿' 17종 틀 순환 적용으로 단일 패턴 반복 금지, `…`·`!` 금지, `~했어요/~이에요` 문체, 첫 문단 즉시 답변, `한 줄 정리` + 질문 + 인용구 소제목 `함께 보기 좋은 이슈` 및 관련 글 링크 3개, 태그 10개)
- 기본 Chrome CDP **`http://127.0.0.1:9225`** (네이버 로그인·임시저장)
- 구글 이미지 수집 CDP **`http://127.0.0.1:9230`** (전용 프로필, 검색이 끝나도 닫지 않음)
- 저장한 글을 다시 열어 제목·전체 본문·이미지와 본문의 교차 순서·이미지 비율을 확인

조사·원고 생성은 이 프로젝트를 연 Codex가 수행합니다. CLI 자체에 언어 모델이나 별도 글 생성 API를 넣지 않았습니다. 공개·예약 발행 명령은 없습니다.

`함께 보기 좋은 이슈` 아래에는 [관련 글 설정](config/related-posts.json)의 URL 3개가 정해진 순서로 들어갑니다. `post.json`의 `conclusion`에는 소제목까지만 작성하세요. 이전 원고의 `[내 글 카드 1]`~`[내 글 카드 3]` 자리 표시는 준비 단계에서 대체됩니다. 현재 에디터 삽입 방식은 링크 카드가 아닌 URL 일반 텍스트입니다. 사용자가 변경을 지시하기 전까지 설정의 URL과 순서를 유지합니다.

V15 검토 사항 4개와 이미지·본문 교차 배치를 반영한 버전입니다. [새 저장소에 올리는 방법](docs/new-repository.md)을 참고하세요. 기본 분량·개수·최신성은 [공통 작성 규칙](config/editorial-rules.json), 제목 기준은 [제목 설정](config/title-templates.json)이 기준입니다. 로컬 `conditions`는 명시적 사용자 재정의로 우선 적용됩니다. 설정 변경 후 `npm run build`로 다시 빌드하세요.

## V16 입력 계약

- 현재 사실은 `temporalRole: "current"`(생략 시 기본값), 과거 배경은 `"background"`입니다. 현재 사실마다 최근 72시간 이내 게시·수정일이 확인된 출처가 필요하고, 본문에서도 현재 사실을 하나 이상 인용해야 합니다. 조사 묶음도 72시간이 지나면 다시 조사해야 합니다.
- 게시일 미상이나 오늘 접속했다는 기록만으로 최신성을 인정하지 않습니다. 날짜만 확인된 출처는 서울의 해당 하루 범위로 비교하며 시각을 지어내지 않습니다. 날짜 검사는 실제 사건 시점·내용의 실질적 갱신·출처의 관련성 검토를 대신하지 않습니다.
- 제목 후보는 7개이며 각 후보는 숫자를 포함한 35~50자, `!`·`…` 금지입니다. 46~50자는 권장 길이 초과 경고입니다. `titleTemplateIds`에 후보와 같은 순서의 서로 다른 유효 ID 7개를 기록합니다. 태그는 정확히 10개입니다. ID 검사는 의미 적합성과 이전 글과의 패턴 반복 검토를 대신하지 않습니다.
- 각 섹션의 `paragraphs` 개수는 `images` 개수와 정확히 같아야 합니다. `paragraphs[0]`이 첫 이미지 다음, `paragraphs[1]`이 두 번째 이미지 다음에 들어갑니다. 각 항목은 본문 한 문장으로 작성하며 모바일 줄바꿈은 유지합니다. 네이티브 사진 캡션은 사용하지 않습니다.
- 수집 이미지는 그 슬롯의 전체 계획과 참조 출처 URL에 묶입니다. URL·selector·frameSelector·requiredLabels·sourceId 등이 바뀌면 해당 슬롯을 다시 수집해야 합니다. 다른 슬롯을 수집해도 이전 캡처가 새 계획으로 통과하지 않습니다. 수집 계획이 같은 이미지는 원고 문장만 바뀌면 재사용할 수 있습니다.
- V15 입력은 새 작업에서 다시 준비하세요. `titleTemplateIds`, 현재/배경 사실, 이미지별 본문 문장을 보완해야 합니다. V15의 입력·저장 중 작업은 원래 버전과 세션에서 마무리하며 기록을 지워 강제 이관하지 않습니다.
- 2026-10-20 설계·계획·검증 문서는 당시 기록입니다. 현재 설정과 위 계약이 우선합니다.

## 설치

Windows 11, Node.js 22.12 이상, Python 3.10 이상, Google Chrome이 필요합니다.

```powershell
cd 'C:\Projects\N_Blog_V16_Realtime'
.\scripts\setup.ps1
# Python 경로를 지정해야 하는 경우
.\scripts\setup.ps1 -Python 'C:\경로\python.exe'
```

또는 `setup.bat`을 실행합니다. 설치 도구는 `npm ci`, 프로젝트 전용 `.venv`, Python 의존성 설치, CLI 빌드를 수행합니다.

`nblog.config.json`의 `blogId`를 실제 네이버 블로그 ID로 바꿉니다. 이메일 전체가 아니라 블로그 주소 `https://blog.naver.com/<ID>`의 ID입니다. 예시 파일에서 복사한 `YOUR_BLOG_ID`는 실제 값이 아닙니다.

```json
{
  "cdpEndpoint": "http://127.0.0.1:9225",
  "profilePath": ".runtime/chrome-profile",
  "googleCdpEndpoint": "http://127.0.0.1:9230",
  "googleProfilePath": ".runtime/chrome-google-profile",
  "workspaceRoot": "workspaces",
  "blogId": "실제_블로그_ID",
  "conditions": {
    "bodyMin": 1000,
    "bodyMax": 1600,
    "sectionMin": 4,
    "sectionMax": 6,
    "sectionCount": 4,
    "imagesPerSection": 2,
    "imageMin": 10,
    "imageMax": 12
  }
}
```

비밀번호나 쿠키는 파일에 입력하지 않습니다. `.venv` Python을 자동으로 사용하며 필요하면 설정의 `pythonPath` 또는 CLI `--python`으로 지정합니다. Chrome 경로가 기본 위치와 다르면 `NBLOG_CHROME_PATH` 환경변수를 지정합니다.

## 로그인과 주제 전달

```powershell
.\scripts\login.ps1
# 또는 login-9225.bat
node dist/cli.js doctor
```

전용 Chrome에서 네이버에 직접 로그인하고 창을 유지합니다. CLI는 현재 프로필과 포트를 확인하며 다른 Chrome에 자동으로 연결하지 않습니다.

구글 이미지를 쓰기 전에는 9230 전용 Chrome을 한 번 엽니다. 이 창은 네이버 9225 창과 프로필을 공유하지 않으며, 수집이 끝나도 닫지 않습니다. 캡차나 로그인 화면이 나오면 그 창에서 직접 처리합니다. 자동으로 풀거나 우회하지 않습니다.

```powershell
.\scripts\login-google.ps1
# 또는 login-9230.bat
```

이 폴더를 연 Codex에 다음처럼 요청합니다.

> “주제: ○○ 발표. 최신 자료를 조사해서 네이버 임시저장까지 진행해줘.”

Codex는 [운영 지침](AGENTS.md)과 [작성 프롬프트](prompts/realtime-post.md)를 따라 조사·작성·이미지 검토·CLI 실행을 진행합니다. 최근 72시간의 동향을 먼저 확인하고 필요한 과거 배경은 날짜를 구분합니다.

## CLI로 단계별 실행

```powershell
$jobResult = node dist/cli.js job:init --topic '작성할 실제 주제' | ConvertFrom-Json
$jobPath = $jobResult.jobPath
```

새 작업은 `research.json`과 소제목 4개·이미지 슬롯 12개가 있는 빈 `post.json`을 만듭니다. Codex가 직접 읽은 출처·사실·원고·이미지 검색어를 채워야 다음 검사를 통과합니다.

```powershell
node dist/cli.js research:check --job $jobPath
node dist/cli.js post:check --job $jobPath
node dist/cli.js image:search --job $jobPath --query '인물 이름'
node dist/cli.js image:search --job $jobPath --query '인물 이름 가족사진'
node dist/cli.js image:search --job $jobPath --query '인물 이름 프러포즈 언론사'
node dist/cli.js image:candidates --job $jobPath
```

**요소별 소량 검색 → 실제 사진 검토 → 중복 제거 → 슬롯 배정 → 부족한 장면 재검색** 순서입니다. 기본은 검색어당 후보 5장·35초이며, 원고에 적은 미확보 검색어를 처리하는 `image:collect`는 한 번에 최대 3개 검색어만 검색합니다. 같은 검색어의 완료된 후보는 재사용하고, 추가 검색이 필요할 때만 `image:search --refresh true`를 사용합니다. 구글은 표시된 9230 전용 Chrome을 재사용하고, 네이버 보완 검색은 기존 헤드리스 수집을 사용합니다.

`image:candidates`가 출력하는 `receipts/image-candidates.jpg`와 후보 파일을 직접 열어 인물·장면·잘림·중복·원사진 출처를 검토합니다. JSON에는 검색어, 출처 URL, 크기, 품질 경고, 유사 이미지와 검토 기록이 남습니다. `candidateCount`는 출처별 후보 수, `uniqueImageCount`는 고유 사진 수입니다. 동일 사진이 다른 매체에서 발견되면 파일은 공유하되 출처 선택지는 보존합니다. 가로폭이 좁거나 지나치게 긴 합성 사진, 로고, 기사 하단의 무관한 추천 사진은 선정하지 마세요.

검토한 사진의 게재 페이지를 `research.json`의 실제 출처로 기록한 뒤 후보 ID와 출처 ID를 사용합니다. `--origin-url`은 원사진의 실제 출처이고, `--source-id`가 가리키는 URL은 후보의 게재 페이지 URL과 정확히 같아야 합니다.

```powershell
node dist/cli.js image:select --job $jobPath --slot s1-1 --candidate 'img-실제후보ID' --source-id '실제출처ID' --reviewer Codex --origin-kind publisher --origin-url 'https://확인한_원출처_URL' --note '실제 사진의 인물·장면·원출처·중복 검토 내용'
# 필요한 슬롯을 모두 선정한 뒤
node dist/cli.js post:prepare --job $jobPath
```

선정한 원본은 검증된 로컬 파일에서 가져오며 다시 다운로드하지 않습니다. 유사도 경고가 있지만 서로 다른 장면임을 직접 확인했다면 검토 내용과 `--distinct-scene true`를 함께 기록합니다. 같은 사진을 두 슬롯에 넣을 수는 없습니다. `image:collect`의 후보 확보를 원고 사진 선정 완료로 간주하지 마세요.

일반인 개인 블로그·인스타그램 원사진은 다운로드·캡처·캐시 재사용을 금지합니다. 언론 기사에 재게재된 사진도 원출처가 개인 계정이거나 미확인이면 `personal`·`unknown`으로 판단하고 제외합니다. 원사진을 `publisher`(언론 자체 사진/제공 자료) 또는 `official`(공식기관·소속사·확인된 당사자 공식 자료)로 확인한 경우만 선정합니다. URL만으로 확인할 수 없는 자체 도메인 개인 블로그도 이 원출처 검토에서 걸러야 합니다.

차단 플랫폼의 공식 계정 예외는 [출처 정책](config/image-source-policy.json)의 `verifiedOfficialSources`에 정확한 `sourceUrl` 또는 계정 범위의 `sourceUrlPrefix`, `verifiedBy`, `evidenceUrl`을 기록한 경우만 허용합니다. 그 계정의 이미지 URL도 `imageUrls`에 정확히 등록해야 하며 다른 계정의 CDN 사진에 예외를 빌려 쓸 수 없습니다. 기본 등록 예외는 없고, 근거를 추정해서 채우지 않습니다. 정책을 수정하면 `npm run build`로 CLI를 다시 빌드합니다.

확인한 원본 URL을 직접 다운로드하는 `engine: "direct"` 계획과 공개 자료의 `capture:run`도 지원합니다. 해당 페이지의 `sourceId`와 실제 URL에 더해 `originKind: "publisher" | "official"`, `originUrl`을 기록해야 합니다. 캡처 selector는 실제 원문에서 확인합니다. 차단 출처나 리다이렉트로 정책을 우회할 수 없으며, 이전 성공 파일과 실패 기록은 보존합니다.

완성 원고와 `preview.md`, **실제 이미지 전체**를 확인한 뒤 `post:prepare`가 출력한 fingerprint로 검토를 기록합니다.

```powershell
node dist/cli.js post:review --job $jobPath --fingerprint '출력된_fingerprint' --reviewer Codex
node dist/cli.js draft:check --job $jobPath
node dist/cli.js draft:run --job $jobPath
node dist/cli.js job:status --job $jobPath
```

`post:review`는 검토 결과를 기록하는 명령입니다. 해당 명령이나 구조 검사가 사실 확인·이미지 검토를 자동 수행하지는 않습니다. 원고·출처·이미지를 변경하면 검토가 만료됩니다. 입력이 시작된 작업은 새 작업으로 다시 작성해야 합니다.

## 원고와 이미지 형식

`research.json`은 `schemaVersion: 1`, 조사시각 `researchedAt`, `sources`, `facts`를 갖습니다. 출처 항목은 `sourceId/title/publisher/url/publishedAt/updatedAt/accessedAt`, 사실 항목은 `factId/text/sourceIds/temporalRole`입니다. 확인할 수 없는 게시·수정일은 `null`로 둡니다. 시각은 실제 조사 시점의 서울 오프셋(+09:00) 또는 UTC ISO 형식이며 매번 갱신합니다.

`post.json`은 `schemaVersion: 1`, 제목 후보 7개 `titleCandidates`, 같은 순서의 서로 다른 템플릿 ID 7개 `titleTemplateIds`, 선정 제목 `title`, `intro`, `sections`, `conclusion`, `tags`입니다. 도입부·문단·마무리는 문자열 배열입니다. 섹션은 `sectionId`, `heading`, `paragraphs`, `factIds`, `images`를 갖습니다.

한 섹션의 이미지 배열 예시입니다. 사진별 캡션은 쓰지 않고, 사진 출처는 `post.json` 최상위 `photoSources` 배열(예: `["연합뉴스", "tvN"]`)에 적습니다.

```json
[
  { "slotId": "s1-1", "mode": "download", "engine": "google", "query": "주제 관련 인물 현장" },
  { "slotId": "s1-2", "mode": "download", "engine": "naver", "query": "주제 관련 발표 행사" },
  {
    "slotId": "s1-3",
    "mode": "capture",
    "originKind": "publisher",
    "originUrl": "https://확인한_원출처_URL",
    "sourceId": "source-1",
    "url": "https://원문주소",
    "selector": "실제 확인한 영역 selector",
    "requiredLabels": ["화면에 실제로 보이는 제목"]
  }
]
```

이미지 배열 순서가 삽입 순서입니다. 소제목 아래 **인용구 → 이미지 1 → 본문 한 문장 → 이미지 2 → 본문 한 문장 → 이미지 3 → 본문 한 문장 → 다음 인용구** 순서로 세로 배치합니다. 같은 파일은 글 전체에서 중복 사용하지 않습니다. 원본 비율을 유지하고 그리드 합성이나 고정 비율 크롭을 하지 않습니다.

본문 글자 수는 도입부·소제목·본문 문단·마무리를 빈 줄로 이어 붙인 길이입니다. 제목·사진 출처·해시태그는 제외합니다. 빈 줄은 `\n\n` 두 글자로 계산하고 `post:check`로 실제 길이를 확인합니다. 본문 분량은 **1,000~1,600자**, 소제목 **4~6개**, 총 이미지 **10~12장**으로 작성합니다. 태그 바로 위에는 `photoSources`를 모은 `사진 출처 : 매체A, 매체B` 한 줄만 자동으로 배치됩니다.

## 중단과 재개

입력·저장 결과가 불확실하면 새 입력이나 저장 클릭을 반복하지 않습니다.

```powershell
node dist/cli.js draft:resume --job $jobPath
```

같은 포트·프로필·작업 소유 탭과 확인된 전체 입력 내용이 일치해야 재개합니다. 적용 여부가 확인되지 않은 이미지 업로드는 재전송하지 않습니다. 저장을 시도한 작업의 재개는 **저장 목록 재확인만** 수행합니다. 이미 확인된 작업의 재실행은 보관한 영수증을 반환합니다.

완료 영수증 조회와 이미 시도한 저장의 결과 재확인은 72시간이 지나도 파일·검토 식별값·입력 증거·세션 검사를 유지한 채 처리합니다. 이 경로는 새 입력이나 저장 재클릭을 하지 않습니다. 아직 저장을 시도하지 않은 작업은 재개 옵션을 주어도 최신성 검사를 계속 적용합니다.

동명 임시저장 글이 여러 개이거나 서버에서 다시 읽은 내용이 다르면 성공 처리하지 않습니다. 기존 내용이 있는 에디터·복구 대화상자·보안 인증·대상 블로그 불일치는 사용자 조치가 필요합니다. 잠금·시도 기록을 지워 강제 실행하지 않습니다. 비정상 종료 후 잠금이 남으면 파일의 PID·시각과 실제 프로세스가 종료됐는지 확인하고 해당 잠금만 수동으로 정리합니다.

종료 코드: `0` 성공, `2` 검사·실행 오류, `3` 설정·자료·사용자 조치 필요, `4` 입력·저장 결과 불확실.

## 검증

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
node dist/cli.js help
.venv\Scripts\python.exe -m image_collector --help
```

`test:browser`는 설치된 Chrome의 새 임시 세션과 로컬 응답만 사용합니다. 실제 네이버나 로그인 계정에는 저장하지 않습니다. 입력·가운데 정렬·이미지 업로드·사진 설명의 소유 관계·소제목과 사진 배치·저장 후 재조회·지연 저장 내용 불일치·화면 캡처를 검사합니다. 일반 `npm test`에서는 브라우저 검사 9개를 건너뜁니다.

테스트 임시 폴더의 `rename`이나 디렉터리 링크가 제한된 실행 환경에서는 정상 로컬 터미널에서 실행합니다. 이번 버전의 확인 범위는 [V16 검증 기록](docs/v16-validation.md), 이전 실계정 확인은 [과거 기록](docs/validation.md)에 남깁니다.

참고 코드와 기준 커밋은 [출처 기록](docs/references.md), 이번 변경은 [V16 설계](docs/superpowers/specs/2026-11-06-quality-fixes-design.md)를 참고하세요. 원고·계정·프로필·캡처·실행 기록은 `workspaces/`와 `.runtime/`에 두며 Git에서 제외합니다.

공개 자료 캡처는 로그인 쿠키를 공유하지 않는 별도 임시 컨텍스트에서 실행합니다. 리다이렉트가 있으면 `capture_redirect_requires_canonical_url`로 중단하므로 직접 확인한 최종 URL을 계획에 기록합니다.
