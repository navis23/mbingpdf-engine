# Versioning and the changelog

How mbingpdf's versions are numbered, where each release is recorded, and how a release is made.

## What a version number means

The packages follow [semantic versioning](https://semver.org). While the library is below 1.0:

| Change | Number | Example |
| --- | --- | --- |
| A fix, or something new that breaks no existing document or code | patch | 0.2.2 → 0.2.3 |
| A change an application has to act on: something renamed or removed, a default that changes what documents look like, a new entry point of some size | minor | 0.2.3 → 0.3.0 |
| The API is declared stable | major | 1.0.0 |

Below 1.0 a caret range does not cross a minor: `^0.2.0` takes 0.2.3 but not 0.3.0. So a patch reaches every application on its next install, and a minor waits until the application asks for it. That is why additions go out as patches: an application should never have to edit its ranges to receive a fix.

From 1.0 on, the usual rules hold: patch for fixes, minor for additions, major for breaking changes. The criteria for 1.0 are in [05-roadmap.md](05-roadmap.md).

**What counts as breaking.** Anything that makes code that compiled stop compiling, or makes the same document come out differently in a way a reader would see: a page break that moves, a size, a colour. A change in the file's bytes that draws the same pixels is not breaking (the byte digests in the tests change; the pictures do not).

## The packages

| Package | Follows |
| --- | --- |
| `mbingpdf` | Its own number. A release is named after it: `v0.2.3` |
| `@mbingpdf/react`, `@mbingpdf/vue` | Their own numbers, changed only when the adapter itself changes. Each says which `mbingpdf` it needs in its peer dependency |
| `@mbingpdf/dev` | Its own number |

An adapter does not move just because the library did. `@mbingpdf/react` 0.1.2 works with every `mbingpdf` 0.2.x.

## Where a release is recorded

| Place | What it holds |
| --- | --- |
| [`CHANGELOG.md`](../CHANGELOG.md) at the root | Every release in one file, newest first, dated, with what changed in each package. Generated; the place to read |
| `packages/*/CHANGELOG.md` | The same entries per package, written by changesets. These are what npm shows |
| [GitHub Releases](https://github.com/navis23/mbingpdf-engine/releases) | One per release, with the same notes, on the tag `v<version>` |
| [07-open-decisions.md](07-open-decisions.md) | Why: the decision behind a change, with its date |
| [SESSION-LOG.md](SESSION-LOG.md) | The work itself, session by session, including what was tried and dropped |

The changelog says what changed for someone using the library. It does not list refactoring, tests, documentation fixes or work on the website, unless a user would notice.

## Writing an entry

Every change a user would notice gets a changeset in the same commit:

```sh
pnpm changeset        # pick the packages, patch or minor, and write the entry
```

An entry is written for the person upgrading. It says what is different for them, in the words of the API, and what to do if anything: "`leading` is accepted on every element, not only in theme text styles", not "fix TextProps type". A fix names what was wrong as the user saw it, with the error message if there was one.

## Making a release

1. `pnpm version` applies the pending changesets: it raises the versions, writes the packages' changelogs and regenerates the root `CHANGELOG.md`.
2. Commit ("Version x.y.z") and push. Wait for CI.
3. Run the **Release** workflow from the Actions tab with dry-run unticked. It checks, publishes to npm through trusted publishing (versions already on npm are skipped), tags the commit `v<version>` and writes the GitHub Release.

A release with nothing but an adapter in it has no new `mbingpdf` version and so no new tag; its notes go into the next release's entry.
