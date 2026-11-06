# 새 GitHub 저장소에 저장하기

이 소스는 `DS-8305/N_Blog_V15_Realtime`의 `e53ea4c9032fb763520fd3bd650a04b75ac5fbb4`를 바탕으로 수정한 V16입니다. 원래 원격 저장소에는 변경을 보내지 않았습니다.

1. `N_Blog_V16_Realtime.zip`을 내려받아 압축을 풉니다. 예: `C:\Projects\N_Blog_V16_Realtime`.
2. GitHub에서 원하는 이름의 **빈 새 저장소**를 만듭니다. 아래 명령을 쓸 경우 README·.gitignore·라이선스 자동 생성 옵션은 비워 둡니다.
3. Git이 설치된 PowerShell에서 압축을 푼 폴더로 이동해 아래 명령을 실행합니다. `새_저장소_URL`은 방금 만든 저장소의 주소로 바꿉니다.

```powershell
cd 'C:\Projects\N_Blog_V16_Realtime'
git init -b main
git add .
git commit -m "Add N_Blog_V16_Realtime"
git remote add origin '새_저장소_URL'
git push -u origin main
```

GitHub 웹의 **Add file → Upload files**를 사용해도 됩니다. 이때 ZIP 파일 한 개를 올리는 대신, 압축을 푼 소스 파일과 폴더를 올립니다. `README.md`, `package.json`, `src`, `tests`, `config`, `image_collector` 등이 저장소 최상위에 있어야 합니다. `.gitignore`도 함께 포함합니다.

## 설치와 첫 실행

```powershell
.\scripts\setup.ps1
```

생성된 `nblog.config.json`에서 `blogId`를 설정합니다. 새 버전의 기본값은 본문 1,000~1,600자, 섹션 4~6개, 이미지 10~12장입니다. 네이버 로그인은 `login-9225.bat`, 구글 이미지 검색은 `login-9230.bat`을 사용합니다. 기존에 해당 포트를 사용하는 Chrome이 있다면 계정·프로필을 섞지 않도록 원래 작업을 마무리한 뒤 새 폴더의 로그인 도구로 실행하세요.

V15의 입력·저장 중 작업은 V15와 같은 세션에서 마무리합니다. V16에는 이전 `workspaces/`, `.runtime/` 또는 잠금·시도 기록을 복사하지 않습니다. 새 작업에서 `titleTemplateIds`, 현재/배경 사실, 이미지별 본문 문장을 작성하세요. 공개 발행 명령은 없습니다.

## 바뀐 섹션 작성 방법

각 섹션의 이미지와 본문은 같은 순서로 짝을 이룹니다. 예를 들어 이미지가 3장이면 `paragraphs`도 아래처럼 3개를 적습니다. 각 항목은 본문 한 문장이며 필요하면 `\n`으로 모바일 줄바꿈을 넣습니다.

```json
{
  "paragraphs": [
    "첫 번째 이미지 다음에\n들어가는 본문 문장이에요.",
    "두 번째 이미지 다음에\n들어가는 본문 문장이에요.",
    "세 번째 이미지 다음에\n들어가는 본문 문장이에요."
  ]
}
```

에디터에는 **인용구 → 이미지 1 → 첫 문장 → 이미지 2 → 둘째 문장 → 이미지 3 → 셋째 문장 → 다음 인용구** 순서로 들어갑니다. 본문을 사진 캡션 필드에 넣지 않습니다.
