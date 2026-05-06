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
dist/                           # compiled output (gitignored on main; only in release tags)
scripts/next-version.mjs        # version determination script (see Release pipeline)
.versionrc.json                 # commit-and-tag-version config (tag prefix, commit message)
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
2. **Check** (`scripts/next-version.mjs`): determines if releasable commits exist since the last `release/v*` tag and computes the next version. Outputs JSON: `{"needed":false}` or `{"needed":true,"bump":"minor","nextVersion":"0.4.0"}`.
3. **Release prep** (`commit-and-tag-version --release-as <nextVersion>`): bumps `package.json`, updates `CHANGELOG.md`, creates the release commit and `release/v{version}` tracking tag. Pushes both to main.
4. Builds `dist/`
5. Creates a detached-HEAD commit with `dist/` force-added, tags it `v{version}`, pushes the tag
6. Creates a GitHub Release with release notes + `dist-v{version}.zip` as an asset

The result is this git shape:

```
main:  ... ──→ [chore(release): release/v1.1.0] ──→ (future commits)
                        │  ↑
                        │  └── lightweight tag: release/v1.1.0  (on main commit, for range detection)
                        │
                        └──→ [include dist for v1.1.0] ← annotated tag: v1.1.0  (for npm install)
```

### Two tags per release

| Tag | Example | Points to | Purpose |
|---|---|---|---|
| `release/v*` | `release/v1.1.0` | Version bump commit on `main` | Commit-range anchor for version detection |
| `v*` | `v1.1.0` | Detached dist commit (off main) | What clients install via `npm install github:…#v1.1.0` |

The `v*` tag must point to a commit containing `dist/`, which is not on `main`. Because it is not an ancestor of `main` HEAD, the version detection tooling cannot find it from HEAD. The `release/v*` tracking tag sits on the main commit and is used instead. Without it, the tooling would scan all history and emit a spurious bump on every push.

### Why `dist/` is not on main

`dist/` is in `.gitignore` so `git add .` never accidentally stages build output. The release workflow uses `git add -f dist/` to bypass this intentionally. The dist commit is created on a detached HEAD (no branch) so it is only reachable via the `v*` tag.

### Step ordering rationale

- **Check is a separate step**: GitHub Actions `if:` conditions gate on step outputs. All subsequent steps use `if: steps.check.outputs.needed == 'true'`. Merging check into release prep would require exit-code gymnastics instead.
- **Release prep pushes before build**: The version bump commit must be on `main` before the dist tag is created, so the dist commit's parent is the correct release commit. If build or tagging fails after this push, the next run finds the `release/v*` tag, sees no new releasable commits, and exits cleanly — no double-bump.
- **Build is separate from the dist tag step**: makes build failures clearly attributable in the Actions UI.
- **GitHub Release is last**: `gh release create` requires the tag to already exist on the remote.

### `scripts/next-version.mjs`

Standalone ESM script. Uses `conventional-recommended-bump`'s `Bumper` API and `ConventionalGitClient` programmatically — same library the CLI wraps, but with full control.

Key behaviour:
- `conventional-recommended-bump` with the angular preset always returns `patch` even for zero releasable commits. The script explicitly checks for releasable types (`feat`, `fix`, `perf`, `revert`, breaking changes) before invoking `whatBump`.
- The angular parser's header regex does not handle the `type(scope)!:` shorthand. The script detects these via `commit.header` and synthesizes the missing `BREAKING CHANGE` note before passing commits to `whatBump`, so `feat!:` correctly produces a major bump.
- Uses `getLastSemverTag({ prefix: 'release/v' })` to anchor the commit range (not `v*` tags, which point to off-branch dist commits).

Run locally to inspect: `node scripts/next-version.mjs`

### `.versionrc.json`

Configures `commit-and-tag-version`:
- `tagPrefix: "release/v"` — creates `release/v{version}` tracking tags and scans for them when detecting the last release.
- `releaseCommitMessageFormat` — appends `[skip ci]` so the release commit does not re-trigger the workflow.

### Retroactive tracking tags

If you need to bootstrap `release/v*` tags (e.g. after cloning fresh or recovering from broken state), tag each release commit on main:

```bash
git tag "release/v{VERSION}" {SHA}
git push origin "release/v{VERSION}"
```

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

- **`conventional-recommended-bump` v10 is ESM-only** — `scripts/next-version.mjs` is `.mjs` for this reason. It imports `Bumper` from `conventional-recommended-bump`, `ConventionalGitClient` from `@conventional-changelog/git-client`, and `createPreset` from `conventional-changelog-angular` — all transitive deps available after `npm ci`.
- **`ts-node` is required** even though not directly referenced: `jest.config.ts` is TypeScript, and Jest uses `ts-node` to parse it. Without it, `npm test` fails with `'ts-node' is required for the TypeScript configuration files`.
- **`tsconfig.json` excludes `src/**/*.test.ts`** so test files are not emitted into `dist/`. Always clean before building: `rm -rf dist/ && npm run build` — `tsc` does not delete stale files.
