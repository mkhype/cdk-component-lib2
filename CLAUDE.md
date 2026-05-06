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
src/              # source files (TypeScript)
dist/             # compiled output (gitignored on main; only exists in release tags)
.github/workflows/release.yml   # automated release pipeline
```

## Release pipeline

Every push to `main` triggers `.github/workflows/release.yml`, which:

1. Runs tests
2. Determines if a release is needed (conventional commits analysis, anchored to `release/v*` tracking tags)
3. Bumps `package.json` version + generates `CHANGELOG.md`
4. Commits those two files to `main` (no `dist/`) and pushes a lightweight tracking tag (`release/v{version}`) on that commit
5. Builds `dist/`
6. Creates a detached-HEAD commit with `dist/` force-added, tags it `v{version}`, pushes the tag
7. Creates a GitHub Release with release notes + `dist-v{version}.zip` as an asset

The result is this git shape:

```
main:  ... ──→ [chore(release): v1.1.0] ──→ (future commits)
                        │  ↑
                        │  └── lightweight tag: release/v1.1.0  (on main commit, for range detection)
                        │
                        └──→ [include dist for v1.1.0] ← annotated tag: v1.1.0  (for npm install)
```

The `v*` tag (with `dist/`) is only reachable via the tag — not via any branch. The `release/v*` tag sits on the main commit and is used internally for commit-range detection.

### Why not semantic-release?

semantic-release was considered and rejected. It always creates the git tag itself (on the main commit, without `dist/`). The only way to then move that tag to a dist-bearing commit is to force-push it, which is undesirable (cached SHAs on client side become stale). Using semantic-release's internal `tagFormat` to work around this adds a tracking tag for every release that pollutes the repo with no benefit.

The conventional-changelog CLI tools (`conventional-recommended-bump` + `conventional-changelog`) are the lower-level primitives that semantic-release itself wraps. Using them directly gives full control over the git operations with no overhead.

### Why are the workflow steps split up the way they are?

The ordering and separation of steps is load-bearing. Here is why each boundary exists:

**"Check if release is needed" is a separate step (not merged into the bump step)**

GitHub Actions `if:` conditions only work at the step boundary using `steps.<id>.outputs`. All subsequent steps use `if: steps.check.outputs.needed == 'true'` to skip cleanly when there are no releasable commits (e.g. a push containing only `chore:` or `docs:` commits). If the check were merged into the bump step, you'd need to gate the rest of the workflow on exit codes or file-based signals — less clear and harder to debug in the Actions UI.

**"Bump version and update changelog" is separate from "Commit version bump to main"**

`npm version` and `conventional-changelog` modify files in the working tree but do not commit. Keeping the mutation and the commit as distinct steps makes it easy to inspect what changed (each step's log shows its output cleanly) and allows inserting validation steps in between in future.

**"Commit version bump to main" pushes a tracking tag in the same step**

The tracking tag (`release/v{VERSION}`) is a lightweight tag created on the version bump commit immediately after it is pushed. It must be in the same step as the commit/push because:
- It references the SHA that was just pushed — this is not known until the commit exists.
- If the tagging were a separate step and the workflow failed between them, the next run would find no tracking tag, scan all history, and generate a spurious bump. Keeping them together is the atomic unit of "a release has been anchored".

**"Commit version bump to main" happens before "Build"**

The version bump commit must land on `main` before the build and tag steps. This ensures:
- The `package.json` version that gets embedded in the dist matches the git tag.
- The detached-HEAD commit (the tag commit) has the version bump commit as its parent, making the tag a clear fork off the correct point in history.
- If the build or tagging step fails after this push, the next run will find the `release/v*` tracking tag, see no releasable commits since then, and exit early. No double-bump. No manual recovery needed.

**"Build" is separate from "Create release tag with dist"**

Separation of concerns: `npm run build` produces the artefact; the tag step consumes it. If the build command changes (e.g. adding a bundle step), the tag step is unaffected. It also makes build failures attributable in the Actions UI.

**"Create release tag with dist" uses a detached HEAD, not a branch**

This is the core constraint: `dist/` must not land on `main`. The detached-HEAD technique achieves this cleanly:

```bash
git checkout --detach HEAD   # detach at the version bump commit
git add -f dist/             # force-add (bypasses .gitignore)
git commit -m "..."          # new commit, parent = version bump commit
git tag -a "v1.1.0" HEAD     # tag points here
git push origin v1.1.0       # push only the tag, no branch
```

No branch is created or pushed. The commit with `dist/` is only reachable via the tag. `git branch --contains v1.1.0` returns empty.

**"Create GitHub Release" is last**

`gh release create` requires the tag to already exist in the remote. It must come after the tag push. Release notes are extracted from `CHANGELOG.md` (which was already committed to main by this point).

### Why are there two kinds of tags per release?

| Tag | Example | Commit it points to | Purpose |
|---|---|---|---|
| `release/v*` | `release/v1.1.0` | Version bump commit on `main` | Anchor for `conventional-recommended-bump` range detection |
| `v*` | `v1.1.0` | Detached dist commit (off main) | What clients install via `npm install github:…#v1.1.0` |

The `v*` tag must point to a commit that contains `dist/`. That commit is not on `main`. Because it is not an ancestor of `main` HEAD, `git describe --tags HEAD` cannot find it. Without the `release/v*` tracking tag on the main commit, `conventional-recommended-bump` would find no previous release, scan all of history, and emit a spurious bump on every push (this bug was observed in practice before the tracking tag was introduced).

The tracking tags are lightweight (just a ref pointer, no extra git object), clearly namespaced, and invisible to clients who only ever reference `v*` tags.

### Why does the check step use `-t release/v`?

`conventional-recommended-bump -t release/v` and `conventional-changelog -t release/v` tell both tools to look for tags with the prefix `release/v` when determining the commit range. Without this flag, they default to looking for `v*` tags — which, as explained above, point to detached commits not reachable from `main` HEAD.

### Could the workflow be simplified?

Yes, with trade-offs:

| Simplification | Trade-off |
|---|---|
| Commit `dist/` to `main` (remove detached-HEAD step, eliminate tracking tags) | `dist/` pollutes the main branch history; every release doubles the commit count |
| Use `semantic-release` | Opaque tooling; requires force-pushing the tag or accepting a tracking tag anyway |
| Skip `CHANGELOG.md` and use GitHub's auto-generated release notes | Loses the local changelog file; release notes only exist on GitHub |
| Merge "check" + "bump" + "commit" into one step | Less readable CI output; harder to add steps between stages later |
| Skip the zip asset and only rely on `npm install github:…#tag` | Loses a convenient download for non-npm consumers |

### Why is `dist/` in `.gitignore` if it gets committed to tags?

`.gitignore` applies to the working tree and index — it prevents `git add .` from accidentally staging the build artefact during development. The release workflow uses `git add -f dist/` (force) to bypass this explicitly and intentionally. This is the standard pattern for keeping generated files out of normal development commits while still being able to include them in specific contexts (release tags, in this case).

## Commit convention

Commits to `main` must follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Version bump | Example |
|---|---|---|
| `fix:` | patch | `fix: handle null input in greet` |
| `feat:` | minor | `feat: add greet function` |
| `feat!:` or body contains `BREAKING CHANGE:` | major | `feat!: rename hello to greet` |
| `chore:`, `docs:`, `refactor:`, `test:`, `ci:` | none | `chore: update deps` |

Commits that produce no version bump (chore, docs, etc.) cause the workflow to exit early after the test step — no version bump, no tag, no release.

## Client installation

```bash
# Install a specific tagged version (no npm registry required)
npm install github:mkhype/cdk-component-lib2#v1.0.0

# Or pin in package.json
"dependencies": {
  "cdk-component-lib2": "github:mkhype/cdk-component-lib2#v1.0.0"
}
```

Because `dist/` is committed into every release tag, no build step is required on the client side. TypeScript type definitions (`dist/index.d.ts`) are included.

## Key implementation notes

- **`conventional-changelog-cli` package → binary is `conventional-changelog`** (not `conventional-changelog-cli`). The package name and the bin name differ. The workflow uses `npx conventional-changelog`.
- **`conventional-recommended-bump` v10 is ESM-only** — it cannot be `require()`d from CommonJS. It is only used via the CLI (`npx conventional-recommended-bump`), which works fine regardless of module format.
- **`ts-node` is required** even though it is not directly referenced: `jest.config.ts` is a TypeScript file, and Jest uses `ts-node` internally to parse TypeScript configuration files. Without it, `npm test` fails with `'ts-node' is required for the TypeScript configuration files`.
- **`tsconfig.json` excludes `src/**/*.test.ts`** so that `npm run build` does not emit compiled test files into `dist/`. Always clean the `dist/` directory before building (`rm -rf dist/ && npm run build`) to guarantee a clean output — `tsc` does not delete stale files.
- **Retroactive tracking tags**: if you ever need to bootstrap the `release/v*` tracking tags for existing releases (e.g. after cloning a fresh copy or recovering from a broken state), tag each `chore(release):` commit on main: `git tag "release/v{VERSION}" {SHA} && git push origin "release/v{VERSION}"`.
