# Contributing to Operon

Thank you for considering a contribution to Operon.

## License

By contributing to Operon, you agree that your contribution is licensed under the same license as the project: GNU General Public License version 3 or later (`GPL-3.0-or-later`).

You must have the right to submit the work you contribute. Do not submit code, assets, text, or other material that you do not have permission to license under `GPL-3.0-or-later`.

## Development Checks

Before submitting a change, run the public source checks from this directory:

```bash
npm run check
```

This runs strict ESLint validation and a production build. Use `npm run lint:report` to inspect the current Obsidian ESLint warning state.

The maintainer vault may also include `npm run phase5:regression` for local validation. The Phase 5 harness is not part of the public source repo or release assets.

Keep changes focused, preserve existing vault data compatibility, and avoid unrelated formatting or refactoring.

## Branding

Contributions to the official project may use Operon branding as part of the official codebase. Forks and modified distributions must follow [TRADEMARK.md](TRADEMARK.md).
