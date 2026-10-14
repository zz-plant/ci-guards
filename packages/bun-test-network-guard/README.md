# bun-test-network-guard

[![npm version](https://img.shields.io/npm/v/bun-test-network-guard?style=flat-square)](https://www.npmjs.com/package/bun-test-network-guard)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.3-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

Stop `bun test` from reaching the internet. Any connection to a remote host throws an error, and the test that tried it fails even if the code under test caught that error. Connections to your own machine still work.

```console
$ bun test
[test-network-guard] This suite serves its own upstreams so a run means the same thing on every box.
  Serve one: pass a fixture fetcher into the code under test, or assign globalThis.fetch in the test and restore it after.
  To exercise the real upstream on purpose: TEST_ALLOW_NETWORK=1.

error: [test-network-guard] This test tried to reach the network 1 time(s). The call was refused, but the code under test caught the error, so nothing else would have failed:
  - fetch to https://api.example.com, from getPrice (src/price.ts:12:9) while test/price.test.ts was running
(fail) reads the price
```



## Why

When tests can reach the internet, results depend on where they run. A test can pass on a laptop with no internet access and fail in CI, where the same code reaches a real API and gets a different answer. The usual cause is code under test that calls an external service on a path the test never checks.

Those calls are also slow. In the project this package was extracted from, blocking them cut the full test run from 49.3 seconds to 13.7 seconds, and every test still passed.

Blocking the network by default makes each test supply its own data. That keeps results the same on every machine.

Bun's built-in `fetch` doesn't go through Node's `http` module, so the usual Node tools for this don't work under Bun. `nock.disableNetConnect()` [has no effect](https://github.com/oven-sh/bun/issues/7544). This package patches `fetch` and each of Bun's other ways to open a connection directly.

Throwing is not enough on its own. Code that calls an external service usually catches a failure and falls back to something, so a refused call can leave the test passing with nobody the wiser. In the project this package was extracted from, 126 tests made 4,880 refused calls and every one of them passed. So the guard also records each refused call and fails the test that made it.

## Install

```bash
bun add --dev bun-test-network-guard
```

Requires Bun 1.1 or later.

## Quick start

Add the guard as a *preload*, a file Bun runs before any test file. In `bunfig.toml` at your project root:

```toml
[test]
preload = ["bun-test-network-guard/preload"]
```

That's all the setup. It applies to `bun test`, to `bun test path/to/file.test.ts`, and to any script that runs either.

To give a test the data it needs, replace `fetch` for that test and put it back afterwards:

```ts
import { afterEach, test, expect } from "bun:test";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("reads the price", async () => {
  globalThis.fetch = async () => Response.json({ price: 42 });
  expect(await getPrice()).toBe(42);
});
```

A test that assigns its own `fetch` this way always wins. The guard only affects calls that no test has replaced. Passing a fake fetch function into the code under test works too.

## What is blocked and what is allowed

| Connection to | Result |
| --- | --- |
| `localhost`, `*.localhost`, `::1` | Allowed |
| `127.0.0.1` and the rest of `127.x.x.x`, also written as `::ffff:127.0.0.1` | Allowed |
| `0.0.0.0` and `::`, where `Bun.serve` listens by default | Allowed |
| A unix socket (`unix`, `socketPath`, or a `net.connect` path) | Allowed |
| A relative URL such as `/api/health` | Allowed |
| A URL that isn't HTTP or WebSocket, such as `data:` or `file:` | Allowed |
| A `fetch` through a proxy on your own machine | Allowed |
| Anything else | Throws, and fails the test |

These are checked:

- `fetch`
- `WebSocket`
- `node:http` and `node:https` `request` and `get`, however they are imported
- `node:net` and `node:tls` `connect` and `createConnection`, and `new net.Socket().connect()`
- `Bun.connect`

Addresses like `127.0.0.1.example.com` look local but belong to a remote domain, so they are blocked. The guard checks for exactly four numbers, not a text prefix.

The error names only the protocol and host, such as `https://api.example.com`, or the host and port for a socket. The path and query are dropped because they often hold secrets: webhook URLs carry a token in the path, and many APIs take a key in the query string. Test output often ends up in CI logs.

The explanation at the top of the example prints once per test run, not once per blocked call. Code under test often catches and logs errors, and repeating the explanation would flood the output.

## A caught error still fails the test

After each test, the guard checks whether that test made a refused call. If it did, the test fails with a list of each call: what was called, the host, and the line that made it. This happens whatever the code under test did with the error.

A call made after a test has finished, such as one from a timer, is reported when the whole run ends.

If the fallback is what a test is about, say so in the test: replace `fetch` with one that rejects, the way an unreachable host does. The guard only records calls it refused itself.

```ts
globalThis.fetch = async () => {
  throw new TypeError("fetch failed: upstream is unreachable in this test");
};
```

## Allowing the network on purpose

Set `TEST_ALLOW_NETWORK=1` to turn the guard off for one run:

```bash
TEST_ALLOW_NETWORK=1 bun test test/integration/live-api.test.ts
```

## Custom setup

To use a different environment variable, or to point people at your project's fixtures, write your own preload file and reference it from `bunfig.toml`:

```ts
// test/preload.ts
import { installNetworkGuard } from "bun-test-network-guard";

installNetworkGuard({
  allowEnv: "MYAPP_ALLOW_NETWORK",
  hint: "Fake fetchers live in test/fixtures/fetch.ts.",
});
```

```toml
[test]
preload = ["./test/preload.ts"]
```

## API

### `installNetworkGuard(options?)`

Patches every connection method listed above and fails any test that made a refused call, unless the allow variable is set to `1`. Call it from a preload, so that the check after each test applies to every test file. Returns a function that puts every patched method back and stops the check.

| Option | Default | Meaning |
| --- | --- | --- |
| `allowEnv` | `"TEST_ALLOW_NETWORK"` | Environment variable that turns the guard off when set to `1`. |
| `hint` | None | An extra line added to the explanation. |
| `explain` | Writes to stderr | Receives the explanation text the first time a call is blocked. |

### `createGuardedFetch(passThrough, explain, options?)`

Returns a guarded `fetch` that sends allowed requests to `passThrough`. Use it to combine the guard with another `fetch` wrapper. Calls refused by this function are not checked after each test. Only the guard that `installNetworkGuard` sets up does that.

### Helpers

- `isLocalHost(host)` returns `true` when a host name or address is on this machine.
- `isLocalTarget(url)` returns `true` when the URL is allowed.
- `redactTarget(url)` returns the protocol and host only.
- `targetUrl(input)` returns the URL from a string, `URL`, or `Request`.

## Limitations

- **`Bun.fetch` is not checked.** Bun doesn't allow it to be replaced. It is a second name for the real `fetch`, so code that calls `Bun.fetch` directly gets past the guard.
- **Redirects are followed.** If a server on your machine redirects to a remote host, Bun follows the redirect inside the original `fetch`, and the guard never sees it.
- **`fetch.preconnect` is passed through.** It opens a connection but sends no request.
- **The check after each test needs a preload.** If you call `installNetworkGuard` inside a test file instead, the check only covers tests that run after that call.
- **The `node:http` and `node:https` modules are replaced for the whole run.** It is the only way to catch a named import like `import { request } from "node:https"`, because Bun runs those clients on its own `fetch` rather than through `node:net`. Everything else in those modules is passed through unchanged, and `mock.restore()` does not undo it. This was measured on Bun 1.3.14.

## How it compares

| Tool | Works with Bun's `fetch` | Covers non-`fetch` connections | Fails a test that caught the error | Installable package |
| --- | --- | --- | --- | --- |
| **bun-test-network-guard** | Yes | Yes | Yes | Yes |
| `nock.disableNetConnect()` | [No](https://github.com/oven-sh/bun/issues/7544) | Node `http` and `https` | No | Yes |
| Socket-level guard in [better-ccflare](https://github.com/SijanC147/better-ccflare/pull/260) | Yes | Yes | Yes | No |

[MSW](https://mswjs.io/) can also reject unmatched requests with `onUnhandledRequest: "error"`. It is a full mocking library, so it is the better choice if you also want to define fake responses in one place.

## Structure

```
bun-test-network-guard/
├── src/         # Guard implementation: host checks, connection patches, the after-each check
├── test/        # Unit tests, and install tests that run fixtures in a child bun test
└── package.json
```

## Development

```bash
git clone https://github.com/zz-plant/bun-test-network-guard.git
cd bun-test-network-guard
bun install
bun run check   # type check and tests
```

## License

[MIT](LICENSE)
