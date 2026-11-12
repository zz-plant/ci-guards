---
"suppression-census": patch
---

Count a lint or type-checker suppression only where the directive opens a comment. A comment that mentions `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` or `biome-ignore` mid-sentence suppresses nothing and is no longer counted, so `typeSuppressions` and `lintSuppressions` can fall on upgrade.
