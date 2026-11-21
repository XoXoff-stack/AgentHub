# Contributing to AgentHub

Thanks for helping improve AgentHub. The project is an early desktop foundation, so focused, tested changes are especially useful.

## Development setup

1. Install Node.js 24, npm, Rust stable and the Tauri prerequisites for your OS.
2. Clone the repository and install dependencies:

```bash
npm install
```

3. Start the desktop app:

```bash
npm run tauri -- dev
```

## Before opening a pull request

Run the applicable checks:

```bash
npm run lint
npm run build
cd src-tauri
cargo fmt --all -- --check
cargo check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Do not silence type errors or compiler warnings merely to make CI pass. Add tests for new Rust behavior and keep frontend components focused.

## Design principles

- Keep system access in Rust, not the React frontend.
- Use official CLI/API behavior. Do not infer support from an app's product name.
- Keep integrations isolated behind adapters and report unsupported capabilities clearly.
- Restrict project file access to the selected project root.
- Do not add network services or automatic project uploads.
- Never commit tokens, API keys, local databases, build output or personal project files.
- Avoid fake controls, fake detection results and unimplemented feature claims.

## Pull request checklist

- [ ] The change has one clear responsibility.
- [ ] New behavior is covered by tests or has a reproducible manual test plan.
- [ ] Documentation and the integration status page are updated.
- [ ] `cargo fmt`, Clippy, Rust tests, ESLint and the frontend build pass where applicable.
- [ ] No secrets or personal data are included.
