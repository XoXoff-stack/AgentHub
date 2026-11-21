# AgentHub

**The Universal AI Agent Launcher.** Every AI. One Hub.

AgentHub is a local-first desktop workspace for discovering AI developer tools installed on your computer and using supported command-line agents or local model servers from one interface. The desktop shell is built with Tauri 2 and Rust; the UI uses React and TypeScript.

> **Project status: early functional foundation (0.1.0).** This repository contains working integrations for a defined subset of tools. It is not yet the complete feature set described in the long-term product plan. See [Current integration status](docs/INTEGRATIONS.md) for the exact boundaries.

## What works today

- Desktop shell configured for Windows, Linux and macOS through Tauri 2.
- PATH-based discovery for Claude Code, Codex CLI, OpenCode, Gemini CLI, Aider, Ollama, Cursor, Windsurf and Claude Desktop (where the application exposes a searchable command).
- Version probing for discovered executables.
- Prompt execution adapters for Claude Code, Codex CLI, OpenCode and Gemini CLI, with separate stdout/stderr streaming and process cancellation. Aider is detected but remains detection-only until its interactive approval flow is integrated.
- Local model discovery and streaming chat through Ollama's local API and OpenAI-compatible local endpoints (LM Studio defaults to `127.0.0.1:1234`).
- SQLite-backed conversations and messages.
- Project file listing, text-file viewing/editing and saving inside the selected project root.
- A CodeMirror editor, Markdown rendering, command palette and dark/light appearance toggle.
- CI checks and cross-platform release workflows.

The interface deliberately distinguishes detected desktop applications from runnable command-line integrations. No successful adapter is inferred just because an app name is shown.

## What is not complete yet

- The editor does not yet capture, preview and individually accept/reject an agent's file diffs. CLI tools that edit files may write them directly, according to their own behavior and permissions.
- The right-side Activity view is a process/output monitor, not a fully interactive PTY terminal. A persistent multi-tab PTY is planned.
- File navigation is currently a bounded flat listing (up to 4,000 entries and six directory levels); directory expansion, create/rename operations and recursive directory deletion are not implemented.
- Cursor, Windsurf and Claude Desktop are detection-only when a searchable executable is present. AgentHub does not claim to control their graphical interfaces.
- GUI application discovery outside PATH and process/service inspection are not implemented yet.
- Agent-specific interactive session resume, multi-agent orchestration, global hotkeys, tray integration, custom adapters, user-defined command execution and secrets-vault integration are not implemented yet.
- Ollama and LM Studio endpoints use their documented default loopback ports in this release. A settings screen for custom local endpoints is planned.
- Windows, Linux and macOS installers are configured in GitHub Actions but have not been produced or signed by this repository snapshot.

## Technology

- **Desktop:** Tauri 2, Rust, Tokio, Serde
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, Framer Motion
- **Editor:** CodeMirror 6
- **Persistence:** SQLite (`rusqlite`)
- **Local model transport:** `reqwest`, Ollama chat API and OpenAI-compatible chat completions
- **Quality:** ESLint, TypeScript, rustfmt, Clippy, Cargo tests/checks

## Requirements

### All platforms

- Node.js 24 LTS or later supported Node 24 release
- npm 10+
- Rust stable toolchain (rustup)
- Tauri 2 system prerequisites for your operating system

### Windows

- Windows 10 or 11
- Microsoft C++ Build Tools (Visual Studio Build Tools with the Desktop development with C++ workload)
- WebView2 Runtime
- Rust MSVC toolchain (`rustup toolchain install stable-x86_64-pc-windows-msvc` if needed)

### Linux (Ubuntu 24.04)

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libwebkit2gtk-4.1-dev \
  libgtk-3-dev libglib2.0-dev pkg-config
```

For other Linux distributions, install the equivalent GTK 3, WebKitGTK 4.1, OpenSSL, AppIndicator, librsvg, pkg-config and build-tool packages.

### macOS

- A supported macOS release
- Xcode Command Line Tools: `xcode-select --install`

Apple signing and notarization credentials are only required for signed/notarized distribution.

## Install and run in development

```bash
git clone https://github.com/YOUR-ACCOUNT/AgentHub.git
cd AgentHub
npm install
npm run tauri -- dev
```

To run only the browser UI (local machine integrations are unavailable in this mode):

```bash
npm run dev
```

The browser preview is intentionally marked as preview mode. Local executable detection, process control, SQLite persistence and local model calls require the Tauri desktop runtime.

## Quality checks

From the repository root:

```bash
npm install
npm run lint
npm run build
```

Rust checks:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

## Build installers locally

Run the commands from the repository root after installing the platform prerequisites:

```bash
npm install
npm run tauri -- build
```

Bundles are written under `src-tauri/target/release/bundle/`.

Expected formats:

| Platform | Bundle | Output directory |
|---|---|---|
| Windows | NSIS installer (`.exe`) | `src-tauri/target/release/bundle/nsis/` |
| Linux | AppImage (`.AppImage`) and Debian package (`.deb`) | `src-tauri/target/release/bundle/appimage/` and `deb/` |
| macOS | Disk image (`.dmg`) | `src-tauri/target/release/bundle/dmg/` |

The installer filename is generated by Tauri and may include the version. This project does not claim that unsigned builds are code-signed.

## GitHub Actions builds

The workflows in `.github/workflows/` provide:

- `ci.yml`: frontend lint/build and Rust format/check/test/Clippy checks on pushes, pull requests and manual runs.
- `build.yml`: Windows, Linux and macOS installers on pushes to `main` and manual runs. Each platform uploads a separate downloadable Actions artifact.
- `release.yml`: build all three platforms when a `v*.*.*` tag is pushed, then attach installers to a GitHub Release. The workflow can also be started manually with an existing tag.

### Publish the project

1. Create an empty repository on GitHub.
2. Extract the AgentHub ZIP archive.
3. Open a terminal inside the extracted `AgentHub` folder.
4. Initialize and push the repository:

```bash
git init
git add .
git commit -m "Initial AgentHub release"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/AgentHub.git
git push -u origin main
```

5. Open the repository's **Actions** tab. The desktop build workflow runs automatically after the push. Download the platform artifact from the completed workflow run.
6. To create a GitHub Release, update the version in `package.json` and `src-tauri/tauri.conf.json`, commit the changes, then push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

No repository secrets are required for unsigned builds. Run `npm install` once to resolve dependencies and generate `package-lock.json`; commit that lockfile before a production release for reproducible dependency resolution. GitHub's automatic `GITHUB_TOKEN` is used for release creation.

## Using AgentHub

### Detect installed tools

Launch the desktop application and use **Scan for tools** in the left sidebar. The detector searches the current process `PATH`, checks for an executable and requests its `--version` output. Detection is intentionally conservative: GUI applications are labelled detection-only unless a supported execution interface exists.

For a CLI agent, make sure its official CLI is installed and authenticated using the provider's own setup flow. AgentHub does not bypass provider authentication.

### Use local models

Start Ollama or LM Studio on the same computer. In AgentHub, select the provider in the left sidebar, refresh models, choose a model in the composer, and send a message.

Default local endpoints in 0.1.0:

| Provider | Endpoint | API |
|---|---|---|
| Ollama | `http://127.0.0.1:11434` | `/api/tags`, `/api/chat` |
| LM Studio | `http://127.0.0.1:1234` | `/v1/models`, `/v1/chat/completions` |
| OpenAI-compatible | `http://127.0.0.1:1234` | `/v1/models`, `/v1/chat/completions` |

No API key is bundled or sent to AgentHub servers. For local OpenAI-compatible servers that enforce authentication, configure the server to allow local development access; custom authentication headers are not yet configurable in this version.

### Work with a project

Choose **Open project** to select a directory. AgentHub lists project files and opens text files in the integrated CodeMirror editor. Saving writes the file under the chosen project root. File reads are limited to 2 MB and the backend rejects paths that resolve outside the selected root.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + K` | Open command palette |
| `Ctrl/Cmd + N` | New conversation |
| `Enter` | Send message |
| `Shift + Enter` | New line |

## Data and privacy

- Conversation data is stored in a local SQLite database in the operating system's application data directory.
- AgentHub does not include a cloud account or send project files to an AgentHub server.
- When using a hosted CLI agent, the agent itself may send prompts or project context to its own provider under that provider's policies. AgentHub cannot make a hosted agent operate locally.
- The process launcher executes only the built-in, allowlisted CLI adapters. It does not execute arbitrary user-entered commands in this release.
- AgentHub’s own file-browser reads and writes are restricted to the selected project root. Symlinks are skipped during listing; file reads and writes verify canonical paths. **CLI agents are not sandboxed by AgentHub**: they run with the current OS user’s permissions and may access other folders if their own tool permissions allow it. Keep provider approval settings enabled and only open projects you trust.

## Architecture

See [Architecture](docs/ARCHITECTURE.md) and [Integration status](docs/INTEGRATIONS.md).

```text
AgentHub/
├── src/                         # React UI and frontend services
├── src-tauri/
│   ├── src/agents/              # CLI discovery and process adapter layer
│   ├── src/db/                  # SQLite conversations and messages
│   ├── src/models/              # Ollama and OpenAI-compatible local models
│   ├── src/projects/            # Project-root constrained filesystem operations
│   └── capabilities/            # Tauri v2 permissions
├── .github/workflows/           # CI, platform builds and release pipeline
├── docs/
├── scripts/
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

## Troubleshooting

**No agents are detected:** confirm the tool's CLI is installed and available in the same `PATH` as AgentHub. Restart AgentHub after changing PATH, then run Scan for tools.

**A CLI starts but exits with an error:** authenticate the CLI in its own terminal first, verify its version and check its provider-specific CLI options. AgentHub displays stdout/stderr output in the conversation and Activity panel.

**Ollama or LM Studio is unavailable:** start its local server, confirm the default port, and refresh the model list. Firewall or server settings can still prevent loopback access.

**Linux build fails:** verify the WebKitGTK 4.1 and GTK development packages above are installed, then rerun the build.

**Windows installer is missing:** check the Windows job in the GitHub Actions run. The `.exe` is produced on a Windows runner; this repository snapshot was not compiled into a Windows installer on non-Windows environments.

## License

AgentHub is distributed under the MIT License. See [LICENSE](LICENSE).
