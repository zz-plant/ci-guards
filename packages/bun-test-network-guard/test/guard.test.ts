import { describe, it } from "bun:test";
import assert from "node:assert/strict";

import net from "node:net";

import {
  bunConnectTargets,
  createGuardedFetch,
  createNetworkGuard,
  fetchTarget,
  guardMethod,
  installNetworkGuard,
  isLocalHost,
  isLocalTarget,
  nodeRequestTargets,
  redactTarget,
  socketConnectTargets,
  targetUrl,
  type FetchLike,
} from "../src/index.js";

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
      "ws://localhost:3000/socket",
      "http://0.0.0.0:3000/",
      "http://[::]:3000/",
      "http://[::ffff:127.0.0.1]/",
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
      "wss://stream.example.com/",
      "http://[::ffff:10.0.0.1]/",
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

describe("isLocalHost", () => {
  it("accepts every spelling of this machine a socket API is handed", () => {
    for (const host of ["localhost", "LOCALHOST.", "api.localhost", "127.0.0.1", "127.8.9.10", "::1", "[::1]", "0:0:0:0:0:0:0:1", "0.0.0.0", "::", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      assert.equal(isLocalHost(host), true, host);
    }
  });

  it("refuses remote hosts, including ones that only mention loopback", () => {
    for (const host of ["example.com", "127.0.0.1.example.com", "localhost.example.com", "10.0.0.1", "::ffff:10.0.0.1", "2001:db8::1", "not an [address"]) {
      assert.equal(isLocalHost(host), false, host);
    }
  });
});

describe("where each API would connect", () => {
  it("judges a fetch by its proxy and lets a unix socket through", () => {
    assert.equal(fetchTarget("https://api.example.com/x?k=1"), "https://api.example.com");
    assert.equal(fetchTarget("http://127.0.0.1:9/"), null);
    assert.equal(fetchTarget("https://api.example.com/", { unix: "/tmp/app.sock" }), null);
    assert.equal(fetchTarget("https://api.example.com/", { proxy: "http://127.0.0.1:8080" }), null);
    assert.equal(fetchTarget("http://localhost/", { proxy: "http://proxy.example.com:3128" }), "http://proxy.example.com:3128");
    assert.equal(
      fetchTarget("https://api.example.com/secret", { proxy: "http://u:p@proxy.example.com" }),
      "https://api.example.com via proxy http://proxy.example.com",
    );
  });

  it("reads a node request from a URL, an options object, or both", () => {
    assert.deepEqual(nodeRequestTargets(["https://api.example.com/path?key=1"], "https:"), ["https://api.example.com"]);
    assert.deepEqual(nodeRequestTargets([{ hostname: "api.example.com", port: 8443 }], "https:"), ["https://api.example.com:8443"]);
    assert.deepEqual(nodeRequestTargets([{ host: "api.example.com:80", protocol: "http:" }], "https:"), ["http://api.example.com"]);
    assert.deepEqual(nodeRequestTargets([{ host: "2001:db8::1" }], "http:"), ["http://[2001:db8::1]"]);
    // Node merges the options over the URL, so a remote host in either is a remote request.
    assert.deepEqual(nodeRequestTargets(["http://localhost/", { hostname: "api.example.com" }], "http:"), ["http://api.example.com"]);
    assert.deepEqual(nodeRequestTargets([{ socketPath: "/var/run/docker.sock" }], "http:"), []);
    assert.deepEqual(nodeRequestTargets([{ path: "/x" }], "http:"), [], "no host means localhost");
    assert.deepEqual(nodeRequestTargets(["http://127.0.0.1:3000/"], "http:"), []);
  });

  it("reads every net and tls connect form", () => {
    assert.deepEqual(socketConnectTargets([443, "api.example.com"]), ["api.example.com:443"]);
    assert.deepEqual(socketConnectTargets(["443", "api.example.com"]), ["api.example.com:443"]);
    assert.deepEqual(socketConnectTargets([{ host: "api.example.com", port: 443 }]), ["api.example.com:443"]);
    assert.deepEqual(socketConnectTargets([[{ host: "api.example.com", port: 443 }, () => {}]]), ["api.example.com:443"]);
    // tls merges an options object over the positional pair.
    assert.deepEqual(socketConnectTargets([443, "localhost", { host: "api.example.com" }]), ["api.example.com:443"]);
    assert.deepEqual(socketConnectTargets([{ host: "::ffff:127.0.0.1", port: 1 }]), []);
    assert.deepEqual(socketConnectTargets([3000]), [], "no host means localhost");
    assert.deepEqual(socketConnectTargets(["/tmp/app.sock"]), [], "a path is an IPC socket");
  });

  it("reads Bun.connect", () => {
    assert.deepEqual(bunConnectTargets([{ hostname: "api.example.com", port: 443 }]), ["api.example.com:443"]);
    assert.deepEqual(bunConnectTargets([{ hostname: "127.0.0.1", port: 443 }]), []);
    assert.deepEqual(bunConnectTargets([{ unix: "/tmp/app.sock" }]), []);
  });
});

describe("createNetworkGuard", () => {
  it("records each refusal with its caller until taken", () => {
    const guard = createNetworkGuard(() => {});
    const error = guard.refuse("node:net connect", "api.example.com:443");

    assert.equal(error.message, "[test-network-guard] blocked outbound node:net connect to api.example.com:443");
    const [recorded, ...rest] = guard.takeRefused();
    assert.equal(rest.length, 0);
    assert.match(recorded ?? "", /^node:net connect to api\.example\.com:443, from .*guard\.test\.ts:\d+/);
    assert.deepEqual(guard.takeRefused(), [], "taking empties the record");
  });

  it("guards a method, keeps its receiver, and restores it", () => {
    const guard = createNetworkGuard(() => {});
    const owner = {
      name: "owner",
      connect(this: { name: string }, ...args: unknown[]) {
        return `${this.name}:${args.join(",")}`;
      },
    };
    const original = owner.connect;
    const restore = guardMethod(owner, "connect", "test connect", socketConnectTargets, guard);

    assert.ok(restore);
    assert.equal(owner.connect(3000, "localhost"), "owner:3000,localhost");
    assert.throws(() => owner.connect(443, "api.example.com"), /blocked outbound test connect to api\.example\.com:443/);
    restore();
    assert.equal(owner.connect, original);
    assert.equal(guardMethod(owner, "missing", "x", () => [], guard), null, "nothing callable to wrap");
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
  it("replaces every connection API and the returned function restores them", async () => {
    const before = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, connect: net.connect, socketConnect: net.Socket.prototype.connect, bunConnect: Bun.connect };
    const restore = installNetworkGuard({ explain: () => {} });
    try {
      assert.notEqual(globalThis.fetch, before.fetch);
      assert.notEqual(net.Socket.prototype.connect, before.socketConnect);
      await assert.rejects(fetch("https://example.com/"), /blocked outbound fetch/);
      assert.throws(() => net.connect(443, "example.com"), /blocked outbound node:net connect/);
    } finally {
      // Restoring also stops charging, so the refusals above do not fail this test.
      restore();
    }
    assert.equal(globalThis.fetch, before.fetch);
    assert.equal(globalThis.WebSocket, before.WebSocket);
    assert.equal(net.connect, before.connect);
    assert.equal(net.Socket.prototype.connect, before.socketConnect);
    assert.equal(Bun.connect, before.bunConnect);
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
