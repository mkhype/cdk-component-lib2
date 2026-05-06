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
2. Determines if a release is needed (conventional commits analysis)
3. Bumps `package.json` version + generates `CHANGELOG.md`
4. Commits those two files to `main` (no `dist/`)
5. Builds `dist/`
6. Creates a detached-HEAD commit with `dist/` force-added, tags it `v{version}`, pushes the tag
7. Creates a GitHub Release with release notes + `dist-v{version}.zip` as an asset

The result is this git shape:

```
main:  ... ──→ [chore(release): v1.1.0] ──→ (future commits)
                        │
                        └──→ [include dist for v1.1.0] ← tag: v1.1.0
```

`dist/` exists only in the tag commit, which is reachable only via the tag — not via any branch.

### Why not semantic-release?

semantic-release was considered and rejected. It always creates the git tag itself (on the main commit, without `dist/`). The only way to then move that tag to a dist-bearing commit is to force-push it, which is undesirable (cached SHAs on the client side become stale). Using semantic-release's internal `tagFormat` to work around this adds a tracking tag for every release (`ci-1.0.0`, etc.) that pollutes the repo with no benefit.

The conventional-changelog CLI tools (`conventional-recommended-bump` + `conventional-changelog`) are the lower-level primitives that semantic-release itself wraps. Using them directly gives full control over the git operations with no overhead.

### Why are the workflow steps split up the way they are?

The ordering and separation of steps is load-bearing. Here is why each boundary exists:

**"Check if release is needed" is a separate step (not merged into the bump step)**

GitHub Actions `if:` conditions only work at the step boundary using `steps.<id>.outputs`. All subsequent steps use `if: steps.check.outputs.needed == 'true'` to skip cleanly when there are no releasable commits (e.g. a push containing only `chore:` or `docs:` commits). If the check were merged into the bump step, you'd need to gate the rest of the workflow on exit codes or file-based signals — less clear and harder to debug in the Actions UI.

**"Bump version and update changelog" is separate from "Commit version bump to main"**

`npm version` and `conventional-changelog` modify files in the working tree but do not commit. Keeping the mutation and the commit as distinct steps makes it easy to inspect what changed (the Actions step log shows each command's output) and to add steps in between (e.g. a validation step) in future.

**"Commit version bump to main" happens before "Build"**

The version bump commit must land on `main` *before* the build and tag steps. This ensures:
- The `package.json` version that gets embedded in the dist matches the git tag.
- The detached-HEAD commit (the tag commit) has the version bump commit as its parent, making the tag a clear fork off the correct point in history.
- If the build or tagging step fails, the version bump commit is already on `main`. On a re-run, `conventional-recommended-bump` will output no bump (the bump commit itself is a `chore:` which does not trigger a release), so the workflow exits early without double-bumping. The only manual recovery needed is to re-trigger the tag creation.

**"Build" is separate from "Create release tag with dist"**

Separation of concerns: `npm run build` produces the artefact; the tag step consumes it. If the build command changes (e.g. adding a bundle step), the tag step is unaffected. Keeping them separate also makes failures easy to attribute in the Actions UI.

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

### Why no "tracking tag"?

A concern with custom tagging is: how does `conventional-recommended-bump` find the previous release on the next run? It uses `git log <last-tag>..HEAD` to determine what commits have landed since the last release.

Our `v1.1.0` tag points to the dist commit, which is a child of the version bump commit on `main`. On the next run:

```
git log v1.1.0..main  →  { commits after the version bump commit }
```

This works correctly because the version bump commit is an ancestor of the dist commit (the tag), so it is excluded from the range. Only commits after the version bump on `main` are analysed. No extra tracking tag is needed.

### Why is `dist/` in `.gitignore` if it gets committed to tags?

`.gitignore` applies to the working tree and index — it prevents `git add .` from accidentally staging the build artefact during development. The release workflow uses `git add -f dist/` (force) to bypass this explicitly and intentionally. This is the standard pattern for keeping generated files out of normal development commits while still being able to include them in specific contexts (release tags, in this case).

### Could the workflow be simplified?

Yes, with trade-offs:

| Simplification | Trade-off |
|---|---|
| Commit `dist/` to `main` (remove detached-HEAD step) | `dist/` pollutes the main branch history; every release doubles the commit count |
| Use `semantic-release` | Opaque tooling; requires force-pushing the tag or accepting an extra tracking tag per release |
| Skip `CHANGELOG.md` and use GitHub's auto-generated release notes | Loses the local changelog file; release notes only exist on GitHub |
| Merge "check" + "bump" + "commit" into one step | Less readable CI output; harder to add steps between stages later |
| Skip the zip asset and only rely on `npm install github:…#tag` | Loses a convenient download for non-npm consumers |

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
- **`tsconfig.json` excludes `src/**/*.test.ts`** so that `npm run build` does not emit compiled test files into `dist/`. Clean the `dist/` directory before building to guarantee a clean output (`tsc` does not delete stale files).
