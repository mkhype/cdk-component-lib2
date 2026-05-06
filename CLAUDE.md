# cdk-component-lib2

TypeScript component library. Published via GitHub tags — no npm registry.

## Commands

```bash
npm test          # run Jest tests
npm run build     # compile TypeScript → dist/
npm run dev       # watch mode
```

## Project structure

```
src/                            # source files (TypeScript)
dist/                           # compiled output (committed as part of each release commit)
.releaserc.json                 # semantic-release config
.github/workflows/release.yml   # automated release pipeline
```

## Commit convention

Commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Version bump | Example |
|---|---|---|
| `fix:` | patch | `fix: handle null input in greet` |
| `feat:` | minor | `feat: add greet function` |
| `feat!:` or body contains `BREAKING CHANGE:` | major | `feat!: rename hello to greet` |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | none | `chore: update deps` |

Non-releasable commits cause the workflow to exit early after tests — no version bump, no tag, no release.

## Release pipeline

Every push to `main` triggers `.github/workflows/release.yml`, which:

1. Runs tests
2. Runs `semantic-release` — if no releasable commits exist since the last `v*` tag, it exits silently. Otherwise it: bumps `package.json`, updates `CHANGELOG.md`, builds `dist/`, creates a release commit containing all three, tags it `v{version}`, and pushes to main.

The result is this git shape:

```
main:  ... ──→ [chore(release): 1.1.0 [skip ci]] ──→ (future commits)
                        ↑
              annotated tag: v1.1.0  (on main, contains dist/)
```

One tag per release, always on main.

### `.releaserc.json`

Configures `semantic-release` with the angular preset. Plugin order matters:
1. `@semantic-release/commit-analyzer` — determines bump level (skips if no releasable commits)
2. `@semantic-release/release-notes-generator` — generates changelog entry
3. `@semantic-release/changelog` — writes `CHANGELOG.md`
4. `@semantic-release/npm` (`npmPublish: false`) — bumps `package.json` version
5. `@semantic-release/exec` (`prepareCmd: "npm run build"`) — builds `dist/`
6. `@semantic-release/git` — commits `package.json` + `CHANGELOG.md` + `dist/`, creates `v*` tag, pushes

The `releaseRules` include `{"breaking": true, "release": "major"}` to ensure `feat!:` shorthand produces a major bump.

## Client installation

```bash
npm install github:mkhype/cdk-component-lib2#v1.0.0
```

```json
"dependencies": {
  "cdk-component-lib2": "github:mkhype/cdk-component-lib2#v1.0.0"
}
```

`dist/` is included in every release tag — no build step needed on the client. TypeScript types (`dist/index.d.ts`) are included.

## Key implementation notes

- **`ts-node` is required** even though not directly referenced: `jest.config.ts` is TypeScript, and Jest uses `ts-node` to parse it. Without it, `npm test` fails with `'ts-node' is required for the TypeScript configuration files`.
- **`tsconfig.json` excludes `src/**/*.test.ts`** so test files are not emitted into `dist/`. Always clean before building: `rm -rf dist/ && npm run build` — `tsc` does not delete stale files.
- **`dist/` is committed to main** as part of each release commit. It is not gitignored. Developers should not manually stage `dist/` — only the CI release process commits it.
