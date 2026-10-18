# bun-test-network-guard

## 0.2.0

### Minor Changes

- bd7547f: Refuse every connection API, not only `fetch` (`WebSocket`, `node:http`/`node:https`, `node:net`/`node:tls`, `net.Socket`, `Bun.connect`), and fail the test that made a refused attempt even when the code under test caught the error.

  #### Migration Guidance
  - **Swallowed Refusals**: If your test previously passed while catching a network refusal (e.g. testing fallback or offline behavior against a live URL), the runner now charges the refusal and fails after the test completes. To migrate:
    - Mock the client call directly or assign `globalThis.fetch` in that test with a mock that throws/rejects, restoring `globalThis.fetch` in `afterEach`.
    - Or run a local mock server using `Bun.serve({ hostname: "127.0.0.1", port: 0 })`.
  - **Localhost & Allow Boundaries**: Loopback connections (`127.0.0.1`, `localhost`, `0.0.0.0`, `::`, and IPv4-mapped loopback) remain permitted. To stand down the guard and run against real external networks, set `TEST_ALLOW_NETWORK=1`.
