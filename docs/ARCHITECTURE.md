# Architecture

## Runtime boundary

The application uses Tauri 2. React is the presentation layer; all local process, model-server, persistence and project filesystem operations are invoked through Rust commands.

```text
React UI
  ├── conversation and navigation state
  ├── CodeMirror editor and project browser
  ├── markdown messages and activity display
  └── Tauri invoke/listen bridge
          │
          ▼
Rust command layer (src-tauri/src/lib.rs)
  ├── Agent manager (agents/)
  │     ├── PATH discovery and version checks
  │     ├── allowlisted CLI adapters
  │     └── stdout/stderr stream + process cancellation
  ├── Local model providers (models/)
  │     ├── Ollama API
  │     └── OpenAI-compatible local API
  ├── Project manager (projects/)
  │     └── canonical-path-constrained filesystem access
  └── SQLite persistence (db/)
```

## Agent adapter contract

Each built-in adapter is selected by a stable ID. The process layer resolves the executable through the current `PATH`. Unix launches the executable directly. Windows uses a fixed PowerShell wrapper for `.cmd` and `.bat` compatibility; the executable path and each argument are Base64-encoded before they enter the wrapper, so prompt text is not interpolated as PowerShell source. AgentHub does not offer arbitrary shell-command execution. The adapter prepares provider-specific arguments and runs the process in the selected project directory when one is configured. Stdout and stderr are emitted separately as Tauri events. A process ID is retained for cancellation.

The adapter registry intentionally contains only a small set of implemented command modes. Before adding an integration, verify its current official CLI options, authentication requirements and output behavior. Update `docs/INTEGRATIONS.md` to distinguish detection from execution support.

## Local model transport

Ollama is queried through its local `/api/tags` and streaming `/api/chat` endpoints. LM Studio and the generic local endpoint use `/v1/models` and streaming `/v1/chat/completions`. The default URLs are loopback-only. The current release does not expose custom host, port or authentication settings in the UI.

## Database

A SQLite database is created in Tauri's application data directory. It contains `conversations` and `messages`; message inserts update the parent conversation's `updated_at` timestamp. Foreign keys are enabled and deleting a conversation cascades to its messages.

## Filesystem boundary

The user explicitly chooses a project root. Each file operation canonicalizes the root and target and rejects targets outside it. File reads are restricted to text files no larger than 2 MB. Symlinks are skipped from directory enumeration. The current editor supports text-file viewing and saving, not conflict-aware diff approval.

## Extension points

Future modules should remain separate by responsibility: adapter registry, PTY manager, diff/proposal store, secure credential storage, global shortcut manager, user settings, and provider-specific model APIs. Do not place OS-specific behavior in React components.
