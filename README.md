# 🛡️ CI Guards

[![CI](https://github.com/zz-plant/ci-guards/actions/workflows/ci.yml/badge.svg)](https://github.com/zz-plant/ci-guards/actions)
[![Bun](https://img.shields.io/badge/runtime-bun-black?logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A consolidated suite of zero-overhead, developer-facing quality and security gates for TypeScript and Bun applications.

## Packages

| Package | Description | Tests |
| :--- | :--- | :--- |
| [`bun-test-network-guard`](packages/bun-test-network-guard) | Stops `bun test` from reaching external networks; allows localhost loopback. | 9 tests |
| [`landmark-audit`](packages/landmark-audit) | Audits web routes for single `<main>` landmark and working skip-to-content links. | 21 tests |
| [`suppression-census`](packages/suppression-census) | Fails CI when codebases add new `@ts-ignore`, `eslint-disable`, or skipped tests. | 19 tests |

## Using the Guards in Your Projects

Each package is self-contained with zero runtime dependencies. Drop them into your project to enforce invariants:

### 1. `bun-test-network-guard` — Hermetic Unit Tests

Blocks all outbound network requests during `bun test` while keeping localhost requests working:

```bash
bun add --dev bun-test-network-guard
```

In your project root `bunfig.toml`:
```toml
[test]
preload = ["bun-test-network-guard/preload"]
```

To allow live network calls on a specific test run:
```bash
TEST_ALLOW_NETWORK=1 bun test
```

---

### 2. `suppression-census` — Zero Suppression Creep

Fails CI when a PR introduces a new `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `biome-ignore`, or skipped test:

```bash
bun add --dev suppression-census
```

Create an initial baseline file:
```bash
bunx suppression-census --save-baseline .suppression-baseline.json
```

Add to your CI workflow (`.github/workflows/ci.yml`):
```yaml
- name: Check suppression creep
  run: bunx suppression-census --baseline .suppression-baseline.json
```

---

### 3. `landmark-audit` — Accessibility & Skip-Link Gate

Verifies that every route in a running application has exactly one `<main>` landmark and a working skip-to-content link:

```bash
bun add --dev landmark-audit
```

Audit running web routes:
```bash
bunx landmark-audit http://localhost:3000 --routes / /about /pricing /docs
```

Or check an HTML string inside a component test:
```ts
import { inspectMainContentHtml } from "landmark-audit";

const report = inspectMainContentHtml(renderedHtml);
expect(report.issues).toEqual([]);
```

---

## Contributing to this Monorepo

### Installation

```bash
# Clone and install monorepo dependencies
git clone https://github.com/zz-plant/ci-guards.git
cd ci-guards
bun install
```

### Monorepo Development Loop

```bash
bun run build        # Build all packages via tsc
bun run typecheck    # Typecheck all packages
bun run test         # Run complete 53-test verification suite
bun run check        # Run typecheck + all test suites
```

## Structure

```
ci-guards/
├── packages/
│   ├── bun-test-network-guard/  # Network isolation for test runners
│   ├── landmark-audit/          # Route accessibility and landmark checker
│   └── suppression-census/      # Lint suppression and test skip auditor
├── test/
│   └── suite-integrity.test.ts  # TDD monorepo integrity contract
├── .github/workflows/ci.yml     # Unified multi-package CI pipeline
├── package.json                 # Bun workspace orchestrator
└── tsconfig.base.json           # Shared base TypeScript configuration
```

## License

MIT License. See individual package directories for license details.
