# AGENTS.md
> Operational guidance and boundary contracts for AI agents working in `ci-guards`.

## 1. Monorepo Objective
`ci-guards` is the authoritative multi-package monorepo for developer-facing CI quality, isolation, and accessibility enforcement libraries (`bun-test-network-guard`, `landmark-audit`, `suppression-census`).

## 2. Invariants & Rules
- **No External Dependencies in Micro-Libraries**: Packages must remain lightweight, fast, and runtime-free. Do not add runtime dependencies to `packages/*` without explicit justification.
- **TDD Contract Preservation**: The test suite integrity contract in `test/suite-integrity.test.ts` validates that the total baseline test count (53 tests across 6 files) never regresses.
- **Explicit Workspaces**: Root `package.json` workspaces must declare `"packages/*"`.
- **Changesets**: Any user-facing or API-contract change in a package requires an accompanying changeset via `bunx changeset`.

## 3. Verification Commands
Always verify changes with the root scripts before opening a PR or claiming task completion:
```bash
bun run build        # Compile TypeScript across all packages (dist/index.js, dist/index.d.ts)
bun run typecheck    # Strict TypeScript checks across tsconfig.base.json and packages
bun run test         # Run all unit tests and the monorepo integrity contract
bun run check        # Combined build, typecheck, and test suite gate
```

## 4. Packaging & Publishing
- Build artifacts land in each package's `dist/` directory.
- Root CI workflow runs on `.github/workflows/ci.yml`.
- Automated SemVer release and npm publication runs via `.github/workflows/release.yml` with Changesets.
