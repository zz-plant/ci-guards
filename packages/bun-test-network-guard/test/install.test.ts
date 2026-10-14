import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Runs a fixture in a child `bun test` with the guard preloaded, as a consumer would. */
const runFixture = (env: Record<string, string> = {}) => {
  const { TEST_ALLOW_NETWORK: _ignored, ...inherited } = process.env;
  const child = Bun.spawnSync(
    ["bun", "test", "--preload", "./test/fixtures/preload.ts", "./test/fixtures/swallowed.fixture.ts"],
    { cwd: ROOT, env: { ...inherited, ...env }, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: child.exitCode, output: `${child.stdout.toString()}${child.stderr.toString()}` };
};

describe("installNetworkGuard in a preload", () => {
  it("fails every test that swallowed a refused connection, and only those", () => {
    const { exitCode, output } = runFixture();

    assert.equal(exitCode, 1, output);
    for (const name of [
      "swallows a fetch",
      "swallows a named node:https request",
      "swallows a default node:https get",
      "swallows a net connect",
      "swallows a Socket#connect",
      "swallows a named tls connect",
      "swallows a Bun.connect",
      "swallows a WebSocket",
    ]) {
      assert.match(output, new RegExp(`\\(fail\\) ${name.replace(/[.#]/g, "\\$&")}`), name);
    }
    // Bun lists only failures when its output is not a terminal, so the two clean tests
    // (a loopback server reached through every API, and no attempt at all) show as counts.
    assert.match(output, /\b2 pass\b/);
    assert.match(output, /\b8 fail\b/);
  });

  it("names the API, the origin and the caller, and never the path or query", () => {
    const { output } = runFixture();

    for (const via of [
      "fetch to https://api.example.invalid",
      "node:https request to https://api.example.invalid",
      "node:https get to https://api.example.invalid:443",
      "node:net connect to api.example.invalid:443",
      "node:net Socket#connect to api.example.invalid:443",
      "Bun.connect to api.example.invalid:443",
      "WebSocket to wss://api.example.invalid",
    ]) {
      assert.ok(output.includes(via), `missing "${via}"`);
    }
    assert.match(output, /from .*swallowed\.fixture\.ts:\d+/);
    assert.ok(!output.includes("token=secret"), "the query string leaked into the output");
  });

  it("stands down entirely when the allow variable is set", () => {
    const { exitCode, output } = runFixture({ TEST_ALLOW_NETWORK: "1" });

    assert.equal(exitCode, 0, output);
    assert.doesNotMatch(output, /test-network-guard/);
  });
});
