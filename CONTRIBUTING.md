# Contributing

Thanks for your interest in improving the CSA Swarm Platform.

## Workflow

1. Open an issue first for non-trivial changes so the design can be discussed.
2. Fork the repo and create a topic branch from `main`:
   - `feature/<short-description>` for new functionality
   - `fix/<short-description>` for bug fixes
   - `docs/<short-description>` for documentation-only changes
3. Make your changes, keep commits focused, and write clear commit messages.
4. Open a pull request against `main`. Include a summary of what changed and why, and link the related issue.

## Development Setup

See the **Local Development** section in [README.md](README.md#local-development) for backend and frontend setup.

## Code Style

- **Python**: format with `black` and lint with `ruff` (configuration is project default). Type hints encouraged.
- **TypeScript / React**: follow the existing ESLint config (`npm run lint` in `frontend/`).
- **Bicep**: format with `bicep format infra/main.bicep` before committing.
- Keep changes minimal and focused. Avoid drive-by refactors in unrelated files.

## Tests

There is no automated test suite yet. When adding tests, prefer `pytest` for the backend and Vitest / Playwright for the frontend. Document how to run them in your PR.

## Secrets

Never commit secrets. The repo's `.gitignore` covers the common locations (`.env`, `frontend/.env.local`, `.azure/`). If you accidentally commit one, rotate it immediately and contact the maintainers.

## Reporting Security Issues

Please **do not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
