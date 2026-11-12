# suppression-census

## 0.1.2

### Patch Changes

- d272325: Count a lint or type-checker suppression only where the directive opens a comment. A comment that mentions `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` or `biome-ignore` mid-sentence suppresses nothing and is no longer counted, so `typeSuppressions` and `lintSuppressions` can fall on upgrade.

## 0.1.1

### Patch Changes

- 862e990: Point package source, README and issue links to the canonical ci-guards monorepo and identify each package directory.
