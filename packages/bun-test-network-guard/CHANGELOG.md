# bun-test-network-guard

## 0.2.0

### Minor Changes

- bd7547f: Refuse every connection API, not only `fetch` (`WebSocket`, `node:http`/`node:https`, `node:net`/`node:tls`, `net.Socket`, `Bun.connect`), and fail the test that made a refused attempt even when the code under test caught the error. A suite that passed on swallowed refusals will now fail; serve the upstream, or replace `fetch` with one that rejects where the fallback is what the test is about.
