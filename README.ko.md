# gitmuster

현재 폴더의 Git 저장소를 한 번에 훑고, 고른 것만 fast-forward로 당깁니다.

```text
$ gitmuster sync
Fetching 12 repositories (up to 4 at once)
   1/12 █░░░░░░░░░░░░░░░   ok api-server
   2/12 ██░░░░░░░░░░░░░░   ok web-client
   ...

FOLDER        BRANCH    IN   OUT  STATUS
api-server    main       5     0  ready to pull
docs-site     main       0     3  local commits only
infra         master     -     -  no upstream
web-client    main      12     0  ready to pull

12 repositories  17 incoming commits  2 ready to pull
```

`gitmuster pull`은 같은 표를 보여 준 뒤 TUI를 엽니다. 당길 저장소를 체크하고
Enter를 누르면 됩니다.

[English documentation is in README.md.](README.md)

## 설치

최신 릴리스에서 설치합니다. 설치 스크립트와 그것이 설치하는 코드가 같은 태그에서
나오므로, 실행한 것이 곧 릴리스된 것입니다.

**PowerShell (Windows)**

```powershell
irm https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.ps1 | iex
```

**POSIX 셸 (macOS, Linux, Git Bash)**

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.sh | sh
```

최신이 아닌 릴리스를 지정하려면:

```powershell
$s = irm https://github.com/kanduit-lab/gitmuster/releases/download/v1.0.0/install.ps1
& ([scriptblock]::Create($s)) -Version v1.0.0
```

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/download/v1.0.0/install.sh | sh -s -- --version v1.0.0
```

명령을 지우려면:

```powershell
irm https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1 -Uninstall
```

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.sh | sh -s -- --uninstall
```

필요한 것: Node.js 18 이상, Git, 설치할 때만 curl과 tar.
**npm은 쓰지 않습니다.** 어느 레지스트리에도 등록하지 않고, 스크립트가 릴리스 자산을
내려받아 실행 링크를 직접 만듭니다.

어느 태그에서 왔는지는 설치 폴더의 `.gitmuster-version`에 남습니다.

설치 위치:

```text
macOS / Linux / Git Bash    ~/.local/share/gitmuster   +  ~/.local/bin/gitmuster
Windows                     %LOCALAPPDATA%\Programs\gitmuster  (사용자 PATH에 추가)
```

## 사용법

저장소들이 모여 있는 폴더에서 `gitmuster`를 실행합니다. 그 폴더가 항상 대상이고,
루트를 따로 지정하는 옵션은 없습니다.

```text
gitmuster sync                 전체 저장소를 fetch하고 표를 출력
gitmuster pull                 fetch 후 TUI에서 골라 당김
gitmuster help                 도움말
gitmuster sync --folders a,b   정확한 폴더 이름으로 범위 제한
gitmuster sync --no-fetch      fetch 없이 지난 결과를 그대로 씀
```

`--no-fetch`는 원격에 접속하지 않고 직전 fetch가 남긴 상태를 읽습니다. 방금 `sync`를
돌렸는데 `pull`이 또 fetch하기를 원하지 않을 때 씁니다. 저장소가 많으면 두 번째
훑기가 느린 구간입니다. 이때 커밋 수와 TUI는 그 이전 상태를 따르고, 표가 그 사실을
알립니다. `pull`은 건드리기 전에 각 저장소를 다시 확인하므로 낡은 항목은 그대로
당기지 않고 거부합니다.

TUI 키: 방향키 또는 `j`/`k` 이동, Space 체크, `a` 선택 가능한 항목 전체 체크,
Enter 당김, `q`/Esc/Ctrl+C 취소.

## 출력 읽는 법

표와 TUI는 터미널일 때 색을 씁니다. 파이프로 넘기거나 `NO_COLOR`가 있으면 색을 빼고,
`FORCE_COLOR`가 있으면 둘을 덮습니다.

```text
ready to pull   초록     막는 것 없음
up to date      흐림     이미 최신, 당길 것 없음
local changes   빨강     커밋 안 한 작업이 있음. 당기면 위험하므로 거부
diverged        빨강     로컬과 원격이 각각 움직임. fast-forward 불가
no upstream     빨강     브랜치가 원격을 추적하지 않음
```

`IN`은 원격에만 있는 커밋, `OUT`은 로컬에만 있는 커밋입니다. `IN`은 청록, `OUT`은
노랑입니다. 대시(`-`)는 upstream이 없다는 뜻입니다.

fetch하는 동안에는 카운터와 막대가 한 줄에서 제자리에 다시 그려집니다. 출력이
파이프면 저장소마다 한 줄씩 남겨 로그가 읽히게 합니다.

## 하는 일과 하지 않는 일

- `.git`이 있는 바로 아래 폴더만 대상으로 합니다.
- 커밋 수는 현재 브랜치의 upstream을 기준으로 셉니다.
- `pull`은 `--ff-only`만 씁니다. 로컬 변경이 있거나, 브랜치가 갈라졌거나,
  upstream이 없거나, detached HEAD이거나, merge/rebase가 진행 중인 저장소는
  건너뛰고 TUI에서 사용 불가로 표시합니다.
- **push는 절대 하지 않습니다.** fetch와 fast-forward만 합니다.
- TUI는 정상 종료, 오류, 창 크기 변경, Ctrl+C에서 터미널 상태를 되돌립니다.

## 개발

```bash
node cli.mjs help          # 설치하지 않고 작업 사본 실행
make test                  # 로컬 픽스처만 사용, 네트워크 없음
make build                 # 테스트 + 문법 검사 + CLI 스모크
make smoke FOLDER=repo-a   # 한 폴더를 대상으로 sync 실행
make release TAG=v0.2.0 NOTES=notes.md   # 릴리스 발행
```

의존성도, 빌드 단계도, 패키지 매니저도 없습니다. 소스는 ES 모듈 세 개입니다.

릴리스 노트는 저장소에 두지 않습니다. `make release`가 노트 파일을 받아 GitHub
Release 본문으로 올리고 원본은 지웁니다. 본문은 GitHub만 소유하므로 저장소 사본과
어긋날 일이 없습니다.

## 라이선스

MIT
