# bun-test-network-guard

[![npm version](https://img.shields.io/npm/v/bun-test-network-guard?style=flat-square)](https://www.npmjs.com/package/bun-test-network-guard)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.3-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

Stop `bun test` from reaching the internet. Any `fetch` to a remote host throws an error, while requests to your own machine still work.

```console
$ bun test
[test-network-guard] This suite serves its own upstreams so a run means the same thing on every box.
  Serve one: pass a fixture fetcher into the code under test, or assign globalThis.fetch in the test and restore it after.
  To exercise the real upstream on purpose: TEST_ALLOW_NETWORK=1.

error: [test-network-guard] blocked outbound fetch to https://api.example.com
```



## Why

When tests can reach the internet, results depend on where they run. A test can pass on a laptop with no internet access and fail in CI, where the same code reaches a real API and gets a different answer. The usual cause is code under test that calls an external service on a path the test never checks.

Those calls are also slow. In the project this package was extracted from, blocking them cut the full test run from 49.3 seconds to 13.7 seconds, and every test still passed.

Blocking the network by default makes each test supply its own data. That keeps results the same on every machine.

Bun's built-in `fetch` doesn't go through Node's `http` module, so the usual Node tools for this don't work under Bun. `nock.disableNetConnect()` [has no effect](https://github.com/oven-sh/bun/issues/7544). This package wraps `globalThis.fetch` directly instead.

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

| Request to | Result |
| --- | --- |
| `localhost`, `*.localhost`, `::1` | Allowed |
| `127.0.0.1` and the rest of `127.x.x.x` | Allowed |
| A relative URL such as `/api/health` | Allowed |
| A non-HTTP URL such as `data:` or `file:` | Allowed |
| Anything else | Throws |

Addresses like `127.0.0.1.example.com` look local but belong to a remote domain, so they are blocked. The guard checks for exactly four numbers, not a text prefix.

The error names only the protocol and host, such as `https://api.example.com`. The path and query are dropped because they often hold secrets: webhook URLs carry a token in the path, and many APIs take a key in the query string. Test output often ends up in CI logs.

The explanation at the top of the example prints once per test run, not once per blocked call. Code under test often catches and logs errors, and repeating the explanation would flood the output.

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

Replaces `globalThis.fetch` with the guarded version, unless the allow variable is set to `1`. Returns a function that restores the previous `fetch`.

| Option | Default | Meaning |
| --- | --- | --- |
| `allowEnv` | `"TEST_ALLOW_NETWORK"` | Environment variable that turns the guard off when set to `1`. |
| `hint` | None | An extra line added to the explanation. |
| `explain` | Writes to stderr | Receives the explanation text the first time a call is blocked. |

### `createGuardedFetch(passThrough, explain, options?)`

Returns a guarded `fetch` that sends allowed requests to `passThrough`. Use it to combine the guard with another `fetch` wrapper.

### Helpers

- `isLocalTarget(url)` returns `true` when the URL is allowed.
- `redactTarget(url)` returns the protocol and host only.
- `targetUrl(input)` returns the URL from a string, `URL`, or `Request`.

## Limitations

The guard wraps `fetch` and nothing else.

- **Other ways to connect are not blocked.** That includes `node:http`, `node:https`, `node:net`, `WebSocket`, and `Bun.connect`. If your code uses any of them, this guard won't catch those calls.
- **A caught error still lets the test pass.** The guard throws, but if the code under test catches the error and carries on, the test can pass without anyone noticing the attempted call.

A stricter approach patches all of those connection methods and fails any test that attempted a blocked connection. [This pull request](https://github.com/SijanC147/better-ccflare/pull/260) shows one way to do it. It is code inside that project, not a package you can install.

## How it compares

| Tool | Works with Bun's `fetch` | Covers non-`fetch` connections | Installable package |
| --- | --- | --- | --- |
| **bun-test-network-guard** | Yes | No | Yes |
| `nock.disableNetConnect()` | [No](https://github.com/oven-sh/bun/issues/7544) | Node `http` and `https` | Yes |
| Socket-level guard in [better-ccflare](https://github.com/SijanC147/better-ccflare/pull/260) | Yes | Yes | No |

[MSW](https://mswjs.io/) can also reject unmatched requests with `onUnhandledRequest: "error"`. It is a full mocking library, so it is the better choice if you also want to define fake responses in one place.

## Structure

```
bun-test-network-guard/
├── src/         # Guard implementation and fetch proxy
├── test/        # Guard unit and integration test suite
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
