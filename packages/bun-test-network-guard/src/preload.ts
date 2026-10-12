/**
 * Preload entry: `bunfig.toml`
 *
 *   [test]
 *   preload = ["bun-test-network-guard/preload"]
 *
 * Installs the guard with defaults. Set `TEST_ALLOW_NETWORK=1` to let a run reach
 * a real upstream on purpose. For a custom allow variable or hint, write a
 * one-line preload of your own that calls `installNetworkGuard`.
 */
import { installNetworkGuard } from "./index.js";

installNetworkGuard();
