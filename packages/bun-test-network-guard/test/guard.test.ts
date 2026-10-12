import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import { createGuardedFetch, installNetworkGuard, isLocalTarget, redactTarget, targetUrl, type FetchLike } from "../src/index.js";

describe("isLocalTarget", () => {
  it("allows loopback, .localhost, and relative targets", () => {
    for (const url of [
      "http://localhost:3000/x",
      "http://127.0.0.1:8787/",
      "http://127.255.0.9/",
      "http://[::1]:3000/",
      "https://app.localhost/",
      "/api/health",
      "api/health",
      "not a url at all",
      "data:text/plain,hi",
    ]) {
      assert.equal(isLocalTarget(url), true, url);
    }
  });

  it("blocks remote hosts, including the 127-prefixed trap", () => {
    for (const url of [
      "https://api.stlouisfed.org/fred",
      "http://127.0.0.1.example.com/",
      "http://127.0.0.1.evil/",
      "http://localhost.example.com/",
      "http://10.0.0.1/",
    ]) {
      assert.equal(isLocalTarget(url), false, url);
    }
  });
});

describe("isLocalTarget edge", () => {
  it("passes through what the URL parser rejects, since fetch will reject it too", () => {
    // WHATWG URL parsing refuses an IPv4 octet above 255, so this never reaches the octet check.
    assert.equal(isLocalTarget("http://127.0.0.999/"), true);
  });
});

describe("targetUrl", () => {
  it("reads a string, a URL, and a Request", () => {
    assert.equal(targetUrl("http://a/"), "http://a/");
    assert.equal(targetUrl(new URL("http://a/b")), "http://a/b");
    assert.equal(targetUrl(new Request("http://a/c")), "http://a/c");
  });
});

describe("redactTarget", () => {
  it("keeps the origin and drops path, query, and userinfo", () => {
    assert.equal(
      redactTarget("https://user:pw@hooks.slack.com/services/T1/B2/secret?api_key=k"),
      "https://hooks.slack.com",
    );
    assert.equal(redactTarget("::nope"), "an unparseable URL");
  });
});

describe("createGuardedFetch", () => {
  const passThrough: FetchLike = async (input) => new Response(`ok ${targetUrl(input)}`);

  it("passes local requests through untouched", async () => {
    const guarded = createGuardedFetch(passThrough, () => {});
    const response = await guarded("http://127.0.0.1:9/x");
    assert.equal(await response.text(), "ok http://127.0.0.1:9/x");
  });

  it("throws a one-line redacted error for a remote request and explains once", async () => {
    const explanations: string[] = [];
    const guarded = createGuardedFetch(passThrough, (text) => explanations.push(text), { hint: "see fixtures/" });

    await assert.rejects(
      guarded("https://api.example.com/v1?token=secret"),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "[test-network-guard] blocked outbound fetch to https://api.example.com" &&
        !error.message.includes("\n"),
    );
    await assert.rejects(guarded("https://other.example.com/"));

    assert.equal(explanations.length, 1, "the guidance prints once per process");
    assert.match(explanations[0] ?? "", /TEST_ALLOW_NETWORK=1/);
    assert.match(explanations[0] ?? "", /see fixtures\//);
  });
});

describe("installNetworkGuard", () => {
  it("replaces globalThis.fetch and the returned function restores it", async () => {
    const before = globalThis.fetch;
    const restore = installNetworkGuard({ explain: () => {} });
    try {
      assert.notEqual(globalThis.fetch, before);
      await assert.rejects(fetch("https://example.com/"), /blocked outbound fetch/);
    } finally {
      restore();
    }
    assert.equal(globalThis.fetch, before);
  });

  it("is a no-op when the allow variable is set", () => {
    const before = globalThis.fetch;
    process.env.CUSTOM_ALLOW = "1";
    try {
      const restore = installNetworkGuard({ allowEnv: "CUSTOM_ALLOW" });
      assert.equal(globalThis.fetch, before);
      restore();
    } finally {
      delete process.env.CUSTOM_ALLOW;
    }
  });
});
