#!/usr/bin/env node
/**
 * scripts/next-version.mjs
 *
 * Determines whether a release is needed and what the next version should be,
 * based on conventional commits since the last release/v* tracking tag.
 *
 * Uses the same underlying library (conventional-recommended-bump) as the
 * release tooling, but programmatically — giving full control over the
 * "no releasable commits" case that the CLI cannot distinguish from a patch bump.
 *
 * Output: single JSON line to stdout
 *   {"needed":false}
 *   {"needed":true,"bump":"minor","nextVersion":"0.4.0"}
 *
 * Usage:
 *   node scripts/next-version.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bumper } from 'conventional-recommended-bump';
import { ConventionalGitClient } from '@conventional-changelog/git-client';
import createPreset from 'conventional-changelog-angular';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 1. Read current version from package.json
const currentVersion = JSON.parse(
  readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')
).version;

// 2. Get the angular preset's config (parser options, commit filter, whatBump fn)
const { commits: commitsConfig, parser: parserConfig, whatBump } = createPreset();

// 3. Find the last release/v* tracking tag.
//    These lightweight tags sit on the version bump commits on main and are
//    reachable from HEAD. The user-facing v* tags point to detached dist commits
//    that are NOT ancestors of main HEAD, so we cannot use them here.
const gitClient = new ConventionalGitClient(repoRoot);
const lastTag = await gitClient.getLastSemverTag({ prefix: 'release/v' });

// 4. Collect parsed commits since that tag.
//    format '%B%n-hash-%n%H' is required for filterReverts to work (needs the hash).
const commits = [];
for await (const commit of gitClient.getCommits(
  { format: '%B%n-hash-%n%H', from: lastTag ?? '', filterReverts: true, ...commitsConfig },
  parserConfig
)) {
  commits.push(commit);
}

// 5. Normalize commits: the angular preset's header pattern does not handle the
//    `type(scope)!: subject` breaking-change shorthand from the Conventional Commits
//    spec. Those commits parse with no `type` but with a full `header`. Synthesize
//    the missing breaking-change note so both releasability detection and whatBump
//    produce the correct result.
const BREAKING_HEADER = /^[a-z]+(?:\([^)]+\))?!:/;
const normalizedCommits = commits.map((c) => {
  if (c.notes.length === 0 && BREAKING_HEADER.test(c.header ?? '')) {
    return { ...c, notes: [{ title: 'BREAKING CHANGE', text: c.header }] };
  }
  return c;
});

// 6. Detect releasable commits.
//    whatBump starts at level 2 (patch) regardless of commit count, returning the
//    same result for 0 commits as for a "fix:" commit — we cannot use it alone to
//    determine whether a release is needed. Check explicitly using the same criteria
//    the angular preset applies internally.
const RELEASABLE_TYPES = new Set(['feat', 'fix', 'perf', 'revert']);
const isReleasable = normalizedCommits.some(
  (c) => c.notes.length > 0 || RELEASABLE_TYPES.has(c.type)
);

if (!isReleasable) {
  process.stdout.write(JSON.stringify({ needed: false }) + '\n');
  process.exit(0);
}

// 7. Determine bump level using the angular preset's whatBump.
//    Feed the already-normalized commits into the Bumper to avoid a second git call.
const bumper = new Bumper(repoRoot);
bumper.commits(normalizedCommits);
const { releaseType: bump } = await bumper.bump(whatBump);

if (!bump) {
  process.stderr.write('bump() returned no releaseType\n');
  process.exit(1);
}

// 8. Compute next version (simple semver arithmetic for patch/minor/major).
const [major, minor, patch] = currentVersion.split('.').map(Number);
const nextVersion =
  bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`;

// 9. Emit result
process.stdout.write(JSON.stringify({ needed: true, bump, nextVersion }) + '\n');
