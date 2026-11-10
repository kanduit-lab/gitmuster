# gitmuster

Muster every Git repository in the current folder, fetch them all, then pick which
ones to fast-forward-pull — without leaving the terminal.

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

`gitmuster pull` shows the same table, then opens a TUI where you check the
repositories you want and press Enter.

[한국어 문서는 README.ko.md 를 보세요.](README.ko.md)

## Install

Install from the latest release. The install script and the code it installs come from
the same release tag, so what you run is what was released.

**PowerShell (Windows)**

```powershell
irm https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.ps1 | iex
```

**POSIX shell (macOS, Linux, Git Bash)**

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.sh | sh
```

Pin a specific release instead of the latest:

```powershell
$s = irm https://github.com/kanduit-lab/gitmuster/releases/download/v1.0.0/install.ps1
& ([scriptblock]::Create($s)) -Version v1.0.0
```

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/download/v1.0.0/install.sh | sh -s -- --version v1.0.0
```

Remove the command:

```powershell
irm https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1 -Uninstall
```

```sh
curl -fsSL https://github.com/kanduit-lab/gitmuster/releases/latest/download/install.sh | sh -s -- --uninstall
```

Requirements: Node.js 18 or newer, Git, and curl + tar during installation.
**npm is not used**, and the package is not published to any registry — the scripts
download the release asset and place a launcher on `PATH` themselves.

The installed tree records which tag it came from in `.gitmuster-version`.

Where things land:

```text
macOS / Linux / Git Bash    ~/.local/share/gitmuster   +  ~/.local/bin/gitmuster
Windows                     %LOCALAPPDATA%\Programs\gitmuster  (added to your user PATH)
```

## Usage

Run `gitmuster` from the folder that holds the repositories. That folder is always
the target; there is no root override.

```text
gitmuster sync                 fetch every repository and print the table
gitmuster pull                 fetch, then pick repositories in a TUI and pull them
gitmuster help                 show the help text
gitmuster sync --folders a,b   limit the run to exact folder names
gitmuster sync --no-fetch      skip the fetch and reuse the last one
```

`--no-fetch` reads the state left by the previous fetch instead of contacting remotes.
Use it when you just ran `sync` and do not want `pull` to fetch again — on a large
workspace the second sweep is the slow part. The counts and the TUI are then based on
that older state, and the table says so. `pull` still re-inspects each repository
before touching it, so a stale entry is refused rather than pulled blindly.

TUI keys: arrows or `j`/`k` move, Space checks, `a` checks every eligible entry,
Enter pulls the checked ones, `q` or Esc or Ctrl+C cancels.

## Reading the output

Both the table and the TUI use color when the output is a terminal, and drop it when
piped or when `NO_COLOR` is set. `FORCE_COLOR` overrides both.

```text
ready to pull   green     nothing is in the way
up to date      dim       already current, nothing to pull
local changes   red       uncommitted work; pull would risk it, so it is refused
diverged        red       local and remote both moved; fast-forward is impossible
no upstream     red       the branch does not track a remote
```

`IN` is commits the remote has that you do not; `OUT` is commits you have that the remote
does not. `IN` is cyan, `OUT` is yellow. A dash means the branch has no upstream.

While fetching, a single progress line redraws in place with a counter and bar. When the
output is piped each repository gets its own line instead, so the log stays readable.

## What it does and does not do

- Only immediate child folders that contain `.git` are considered.
- Commit counts use the current branch's upstream.
- `pull` uses `--ff-only`. Repositories with local changes, diverged branches, a
  missing upstream, a detached HEAD, or an ongoing merge/rebase are skipped and
  marked unavailable in the TUI.
- **Nothing is ever pushed.** The tool only fetches and fast-forwards.
- The TUI restores the terminal on exit, error, resize, and Ctrl+C.

## Development

```bash
node cli.mjs help          # run the working copy without installing
make test                  # local fixtures, no network
make build                 # tests plus syntax and CLI smoke checks
make smoke FOLDER=repo-a   # run sync against one folder
make release TAG=v0.2.0 NOTES=notes.md   # publish a release
```

No dependencies, no build step, no package manager: the source is three ES modules.

Release notes are not kept in the repository. `make release` takes a notes file, hands
it to GitHub as the release body, and deletes the original. GitHub owns the text, so
there is no repository copy that can drift away from it.

## License

MIT
