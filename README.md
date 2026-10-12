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

## Quick Start

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
