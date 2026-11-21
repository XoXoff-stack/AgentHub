# Integration status (0.1.0)

The word **detected** means AgentHub found an executable by searching the current `PATH`. It does not mean the tool is authenticated or usable. **Runnable** means an explicit adapter is implemented in this version.

| Tool | Detection | Execution / API | Notes |
|---|---|---|---|
| Claude Code | `claude` on PATH | Runnable | Uses `claude -p` prompt mode. Provider authentication remains managed by Claude Code. |
| OpenAI Codex CLI | `codex` on PATH | Runnable | Uses `codex exec`. |
| OpenCode | `opencode` on PATH | Runnable | Uses `opencode run`. |
| Gemini CLI | `gemini` on PATH | Runnable | Uses `gemini -p` prompt mode. |
| Aider | `aider` on PATH | Detection only | Interactive approval requires the planned PTY and file-diff workflow; this version does not auto-approve edits. |
| Ollama | CLI detection plus local HTTP API | Runnable local models | API defaults to `127.0.0.1:11434`. The CLI may be absent while the server is present; model API access is available from the Models section. |
| LM Studio | Not in CLI scan | Runnable local models when server is running | Queries OpenAI-compatible API on `127.0.0.1:1234`; the app itself is not driven. |
| Cursor | `cursor` on PATH | Detection only | No control adapter is claimed. |
| Windsurf | `windsurf` on PATH | Detection only | No control adapter is claimed. |
| Claude Desktop | `claude-desktop` on PATH, if exposed | Detection only | No control adapter is claimed. |
| llama.cpp | Not yet implemented | Not yet implemented | Planned through configurable local OpenAI-compatible endpoint support. |

## Current limitations

- PATH-only executable search; platform-specific application bundles and install databases are not searched.
- `--version` is used for a best-effort version string; an unavailable version response does not prove that the executable is unusable.
- CLI flags and prompt modes can evolve upstream. Verify against the installed official CLI version when troubleshooting.
- Interactive PTY sessions and session-resume flows are not included.
- Built-in provider-specific CLI adapters do not accept arbitrary command overrides.
- Local model URL and server authorization are not configurable from the UI yet.
