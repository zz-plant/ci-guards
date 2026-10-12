import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  "bun-test-network-guard",
  "landmark-audit",
  "suppression-census",
];

describe("CI Guards Monorepo Integrity Contract (TDD Harness)", () => {
  it("contains all three constituent packages under packages/", () => {
    for (const pkg of PACKAGES) {
      const pkgPath = join(ROOT, "packages", pkg);
      expect(existsSync(pkgPath)).toBe(true);
      expect(existsSync(join(pkgPath, "package.json"))).toBe(true);
    }
  });

  it("ensures each package defines required packaging metadata", () => {
    for (const pkg of PACKAGES) {
      const pkgJsonPath = join(ROOT, "packages", pkg, "package.json");
      if (!existsSync(pkgJsonPath)) {
        throw new Error(`Package manifest missing for ${pkg}`);
      }
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      expect(pkgJson.name).toBe(pkg);
      expect(pkgJson.version).toBeDefined();
      expect(pkgJson.scripts?.build).toBeDefined();
      expect(pkgJson.scripts?.test).toBeDefined();
      expect(pkgJson.license).toBe("MIT");
    }
  });

  it("verifies suppression-census CLI entrypoint exists", () => {
    const binPath = join(ROOT, "packages", "suppression-census", "bin", "suppression-census.mjs");
    expect(existsSync(binPath)).toBe(true);
  });

  it("builds all packages and produces valid dist/ bundles", () => {
    for (const pkg of PACKAGES) {
      const pkgDir = join(ROOT, "packages", pkg);
      const res = spawnSync("bun", ["run", "build"], { cwd: pkgDir, encoding: "utf-8" });
      expect(res.status).toBe(0);
      expect(existsSync(join(pkgDir, "dist", "index.js"))).toBe(true);
      expect(existsSync(join(pkgDir, "dist", "index.d.ts"))).toBe(true);
    }
  });
});
