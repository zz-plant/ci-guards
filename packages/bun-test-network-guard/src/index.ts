/**
 * Blocks outbound network from a `bun test` suite, loopback excepted.
 *
 * A suite that inherits the network gives a different answer depending on where
 * it runs: a sandbox that reaches nothing passes a test that a CI container with
 * egress fails, because code under test quietly fetched a real upstream on a
 * path the test never asserted on. It is also slow, since every one of those
 * unasserted reads waits for whatever the box happens to allow. The guard makes
 * "serve your own upstream" the default rather than a thing each test remembers.
 *
 * Two halves, because one is not enough. Every way Bun opens a connection is
 * patched to throw for a remote host. And because code under test usually catches
 * that error and degrades gracefully, the attempt is also recorded, and an
 * `afterEach` fails the test that made it whatever the code did with the error.
 *
 * Loopback stays open: a server the suite itself started is the suite owning its
 * upstream rather than reaching for someone else's.
 *
 * A test that assigns its own mock over `globalThis.fetch` still wins. The guard
 * only decides what an *unmocked* call does.
 */
import { afterAll, afterEach, mock } from "bun:test";
import http from "node:http";
import * as httpModule from "node:http";
import https from "node:https";
import * as httpsModule from "node:https";
import net from "node:net";
import { relative } from "node:path";
import tls from "node:tls";

export type FetchInput = Parameters<typeof fetch>[0];

/**
 * Anything callable like `fetch`. Bun's `typeof fetch` also carries `preconnect`,
 * which a test's stub fetcher has no reason to implement, so the pass-through is
 * accepted in the looser shape and `preconnect` is forwarded when present.
 */
export type FetchLike = ((input: FetchInput, init?: RequestInit) => Promise<Response>) & {
  preconnect?: (url: string | URL) => void;
};

const isLoopbackIpv4 = (host: string): boolean => {
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
};

/**
 * A hostname that names this machine without asking DNS: `localhost` and
 * `*.localhost` (RFC 6761), 127.0.0.0/8, `::1`, the unspecified addresses
 * `0.0.0.0` and `::` (where `Bun.serve` binds by default), and IPv4-mapped
 * loopback in either spelling.
 *
 * Judged as an address, never as a string prefix: `/^127\./` also accepts
 * `127.0.0.1.example.com`, an ordinary remote host anyone can register.
 */
export const isLocalHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || isLoopbackIpv4(host)) return true;
  if (!host.includes(":")) return false;
  // Canonicalise an IPv6 literal the way URL does, so `0:0:0:0:0:0:0:1` and
  // `::ffff:127.0.0.1` reach the same spellings as everything else.
  let canonical: string;
  try {
    canonical = new URL(`http://[${host.replace(/^\[|\]$/g, "")}]/`).hostname;
  } catch {
    return false;
  }
  return canonical === "[::1]" || canonical === "[::]" || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical);
};

const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

/** Loopback, relative and non-network URLs: nothing that leaves the machine. */
export const isLocalTarget = (url: string): boolean => {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true; // relative: never leaves the process
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // not a URL we can judge; let the real call report it
  }
  if (!NETWORK_SCHEMES.has(parsed.protocol)) return true; // data:, blob:, file:
  return isLocalHost(parsed.hostname);
};

/** The request target, whatever shape `fetch` was handed. */
export const targetUrl = (input: FetchInput): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) return String(input.url);
  return String(input);
};

/**
 * What a blocked request may safely be called in an error: its origin, and nothing after.
 *
 * The message goes to test output and build logs, so it must not carry a credential.
 * Plenty of URLs are credentials in their entirety: a Slack webhook holds its secret in
 * the path, an API key sits in the query string. The origin is kept and everything else
 * dropped, rather than the path scrubbed by pattern: a heuristic has to be right about
 * every shape of secret anyone adds later, while the origin is right by construction and
 * is the whole of what the reader needs, since it names the upstream to serve.
 * `URL.origin` also drops any `user:pass@` userinfo.
 */
export const redactTarget = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "an unparseable URL";
  }
};

/** A property of a value of unknown shape, or undefined. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;

const stringField = (value: unknown, key: string): string | undefined => {
  const found = field(value, key);
  return typeof found === "string" && found !== "" ? found : undefined;
};

const portSuffix = (port: unknown): string => (typeof port === "number" || typeof port === "string" ? `:${port}` : "");

const bracketed = (host: string): string => (host.includes(":") && !host.startsWith("[") ? `[${host}]` : host);

/**
 * Where a `fetch` would open a connection, redacted, or null when it stays on the
 * machine. Bun's `unix` option is a socket path; with a `proxy` the process connects
 * only to the proxy, so the proxy is what is judged.
 */
export const fetchTarget = (input: FetchInput, init?: unknown): string | null => {
  if (stringField(init, "unix")) return null;
  const url = targetUrl(input);
  const proxy = stringField(init, "proxy");
  if (proxy !== undefined) {
    if (isLocalTarget(proxy)) return null;
    return isLocalTarget(url) ? redactTarget(proxy) : `${redactTarget(url)} via proxy ${redactTarget(proxy)}`;
  }
  return isLocalTarget(url) ? null : redactTarget(url);
};

/**
 * Where a node `http`/`https` `request` or `get` would connect, redacted. Node merges an
 * options object over a URL argument, so both are judged. A `socketPath` is a unix
 * socket, and with neither a URL nor a host node connects to localhost.
 */
export const nodeRequestTargets = (args: readonly unknown[], defaultProtocol: string): string[] => {
  const targets: string[] = [];
  let options: unknown;
  for (const arg of args) {
    if (typeof arg === "string" || arg instanceof URL) {
      const url = String(arg);
      if (!isLocalTarget(url)) targets.push(redactTarget(url));
    } else if (typeof arg === "object" && arg !== null && options === undefined) {
      options = arg;
    }
  }
  if (options === undefined || stringField(options, "socketPath")) return targets;
  const named = stringField(options, "hostname") ?? stringField(options, "host");
  if (named === undefined) return targets;
  // A `host` option may carry a port, except an unbracketed IPv6 literal.
  const host = (named.match(/:/g) ?? []).length > 1 ? named : named.replace(/:\d+$/, "");
  if (!isLocalHost(host)) {
    const protocol = stringField(options, "protocol") ?? defaultProtocol;
    targets.push(`${protocol}//${bracketed(host)}${portSuffix(field(options, "port"))}`);
  }
  return targets;
};

/**
 * Where a `net`/`tls` `connect`, `createConnection` or `Socket#connect` would connect.
 * The forms are `(options)`, `(port, host?, options?)` and `(path)`; tls merges an
 * options object at position 1 or 2 over the positional pair, so every host given is
 * judged. Node's own `net.connect` hands `Socket#connect` its normalised `[options, cb]`.
 */
export const socketConnectTargets = (args: readonly unknown[]): string[] => {
  const [first, second] = args;
  if (Array.isArray(first)) return socketConnectTargets(first);
  // A non-numeric string first is an IPC path.
  if (typeof first === "string" && !/^\d+$/.test(first)) return [];
  const hosts: string[] = [];
  if (typeof second === "string") hosts.push(second);
  for (const arg of args) {
    const host = stringField(arg, "host");
    if (host !== undefined) hosts.push(host);
  }
  const port = typeof first === "number" || typeof first === "string" ? first : field(first, "port");
  return hosts.filter((host) => !isLocalHost(host)).map((host) => `${bracketed(host)}${portSuffix(port)}`);
};

/** `Bun.connect({ hostname, port, unix })`: a unix socket, or a host to judge. */
export const bunConnectTargets = (args: readonly unknown[]): string[] => {
  const [options] = args;
  if (stringField(options, "unix")) return [];
  const hostname = stringField(options, "hostname") ?? "localhost";
  return isLocalHost(hostname) ? [] : [`${bracketed(hostname)}${portSuffix(field(options, "port"))}`];
};

export interface GuardOptions {
  /**
   * Printed to stderr once per process, the first time a connection is blocked.
   * Code under test often catches and logs the thrown error, so guidance that
   * lived in the error message would be reprinted for every blocked call.
   */
  explain?: ((text: string) => void) | undefined;
  /** Name of the environment variable that disables the guard. Default `TEST_ALLOW_NETWORK`. */
  allowEnv?: string | undefined;
  /** Extra guidance appended to the one-time explanation, e.g. where this repo keeps its fixture fetchers. */
  hint?: string | undefined;
}

const DEFAULT_ALLOW_ENV = "TEST_ALLOW_NETWORK";

const LABEL = "[test-network-guard]";

const defaultExplanation = (allowEnv: string, hint?: string) =>
  `${LABEL} This suite serves its own upstreams so a run means the same thing on every box.\n` +
  "  Serve one: pass a fixture fetcher into the code under test, assign globalThis.fetch in the test and\n" +
  '  restore it after, or start a server with Bun.serve({ hostname: "127.0.0.1", port: 0 }).\n' +
  (hint ? `  ${hint}\n` : "") +
  `  To exercise the real upstream on purpose: ${allowEnv}=1.\n`;

/** Where the guard's own frames live, so a recorded attempt names its caller instead. */
const OWN_FILE = new URL(import.meta.url).pathname;

/** The first stack frame outside the guard and the runtime: who made the call. */
const callerFrame = (): string => {
  const frames = (new Error().stack ?? "").split("\n").slice(1);
  const outside = frames.find((line) => line.includes("/") && !line.includes(OWN_FILE));
  if (!outside) return "an unknown caller";
  return outside.trim().replace(/^at\s+/, "").replaceAll(`${process.cwd()}/`, "");
};

/** A guard's record of refusals, and the way each one is made. */
export interface NetworkGuard {
  /** Records a refused attempt and returns the one-line error the caller should see. */
  refuse(via: string, target: string): Error;
  /** Every refusal since the last call, oldest first, each naming its caller. */
  takeRefused(): string[];
}

/**
 * One guard with its own record, so a test of the guard's logic never touches the
 * record the installed guard charges to tests. The thrown message is one line; the
 * guidance prints once per guard.
 */
export function createNetworkGuard(explain: (text: string) => void, options: Pick<GuardOptions, "allowEnv" | "hint"> = {}): NetworkGuard {
  const allowEnv = options.allowEnv ?? DEFAULT_ALLOW_ENV;
  let explained = false;
  let refused: string[] = [];

  return {
    refuse(via, target) {
      if (!explained) {
        explained = true;
        explain(defaultExplanation(allowEnv, options.hint));
      }
      const running = typeof Bun === "undefined" ? "" : ` while ${relative(process.cwd(), Bun.main)} was running`;
      refused.push(`${via} to ${target}, from ${callerFrame()}${running}`);
      return new Error(`${LABEL} blocked outbound ${via} to ${target}`);
    },
    takeRefused() {
      const taken = refused;
      refused = [];
      return taken;
    },
  };
}

const wrapFetch = (passThrough: FetchLike, guard: NetworkGuard): typeof fetch => {
  const guarded = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const target = fetchTarget(input, init);
    if (target !== null) throw guard.refuse("fetch", target);
    return passThrough(input, init);
  };
  // Typed by annotation rather than asserted: `preconnect` is a hint that sends no
  // request, so it is forwarded unguarded.
  const guardedFetch: typeof fetch = Object.assign(guarded, {
    preconnect: (url: string | URL) => passThrough.preconnect?.(url),
  });
  return guardedFetch;
};

/**
 * Wraps `passThrough` so a request that would leave the machine rejects instead.
 * The rejection is one line on purpose; see `GuardOptions.explain`.
 */
export function createGuardedFetch(
  passThrough: FetchLike,
  explainOrGuard: ((text: string) => void) | NetworkGuard,
  options: Pick<GuardOptions, "allowEnv" | "hint"> = {},
): typeof fetch {
  const guard = typeof explainOrGuard === "function" ? createNetworkGuard(explainOrGuard, options) : explainOrGuard;
  return wrapFetch(passThrough, guard);
}

/**
 * Replaces `owner[key]` with a function that refuses when `targetsOf` names anywhere
 * off the machine and otherwise calls the original with the same receiver. Assigned
 * rather than redefined, because `Bun.connect` is writable but not configurable.
 * Returns a function that puts the original back, or null when there was nothing to wrap.
 */
export function guardMethod(
  owner: object,
  key: string,
  via: string,
  targetsOf: (args: readonly unknown[]) => string[],
  guard: NetworkGuard,
): (() => void) | null {
  const original: unknown = Reflect.get(owner, key);
  if (typeof original !== "function") return null;
  const installed = Reflect.set(owner, key, function guarded(this: unknown, ...args: unknown[]): unknown {
    const [target] = targetsOf(args);
    if (target !== undefined) throw guard.refuse(via, target);
    return Reflect.apply(original, this, args);
  });
  return installed ? () => void Reflect.set(owner, key, original) : null;
}

/** A `WebSocket` constructor that refuses a remote URL before opening it. */
export function createGuardedWebSocket(RealWebSocket: typeof WebSocket, guard: NetworkGuard): typeof WebSocket {
  return class GuardedWebSocket extends RealWebSocket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      const url = String(args[0]);
      if (!isLocalTarget(url)) throw guard.refuse("WebSocket", redactTarget(url));
      super(...args);
    }
  };
}

/** Every refusal the installed guard has not yet charged to a test, as one error. */
const chargeError = (refused: readonly string[], phase: string): Error =>
  new Error(
    `${LABEL} ${phase} tried to reach the network ${refused.length} time(s). The call was refused, but the code under test ` +
      "caught the error, so nothing else would have failed:\n" +
      refused.map((attempt) => `  - ${attempt}`).join("\n"),
  );

let mockedNodeModules = false;

/**
 * Bun's node:http client runs on its native fetch, not through net or tls, and a named
 * import is bound before any patch on the module object, so `import { request } from
 * "node:https"` would reach the network untouched. Replacing the module closes that.
 * The replacement delegates to the module object at call time, so restoring the object
 * restores named imports too; `mock.restore()` does not undo a module mock (Bun 1.3.14).
 */
const mockNodeHttpModules = () => {
  if (mockedNodeModules) return;
  mockedNodeModules = true;
  mock.module("node:http", () => ({
    ...httpModule,
    default: http,
    request: (...args: unknown[]): unknown => Reflect.apply(http.request, http, args),
    get: (...args: unknown[]): unknown => Reflect.apply(http.get, http, args),
  }));
  mock.module("node:https", () => ({
    ...httpsModule,
    default: https,
    request: (...args: unknown[]): unknown => Reflect.apply(https.request, https, args),
    get: (...args: unknown[]): unknown => Reflect.apply(https.get, https, args),
  }));
};

/**
 * Installs the guard over every way Bun opens a connection, and fails any test that
 * attempted a blocked one, unless the allow variable is set to `1`. Meant for a
 * `bunfig.toml` preload, where the `afterEach` it registers applies to every test.
 * Returns a function that restores every patched API and stops charging tests.
 *
 * Covered: `globalThis.fetch`, `WebSocket`, `node:http` and `node:https` `request` and
 * `get` (default, named and required), `node:net` and `node:tls` `connect` and
 * `createConnection`, `net.Socket.prototype.connect`, and `Bun.connect`.
 */
export function installNetworkGuard(options: GuardOptions = {}): () => void {
  const allowEnv = options.allowEnv ?? DEFAULT_ALLOW_ENV;
  if (process.env[allowEnv] === "1") return () => {};

  const explain = options.explain ?? ((text: string) => process.stderr.write(text));
  const guard = createNetworkGuard(explain, { allowEnv, hint: options.hint });
  const restores: Array<() => void> = [];

  const previousFetch = globalThis.fetch;
  globalThis.fetch = wrapFetch(previousFetch, guard);
  restores.push(() => {
    globalThis.fetch = previousFetch;
  });

  const PreviousWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = createGuardedWebSocket(PreviousWebSocket, guard);
  restores.push(() => {
    globalThis.WebSocket = PreviousWebSocket;
  });

  const patch = (owner: object, key: string, via: string, targetsOf: (args: readonly unknown[]) => string[]) => {
    const restore = guardMethod(owner, key, via, targetsOf, guard);
    if (restore) restores.push(restore);
  };
  for (const key of ["request", "get"]) {
    patch(http, key, `node:http ${key}`, (args) => nodeRequestTargets(args, "http:"));
    patch(https, key, `node:https ${key}`, (args) => nodeRequestTargets(args, "https:"));
  }
  for (const key of ["connect", "createConnection"]) {
    patch(net, key, `node:net ${key}`, socketConnectTargets);
    patch(tls, key, `node:tls ${key}`, socketConnectTargets);
  }
  patch(net.Socket.prototype, "connect", "node:net Socket#connect", socketConnectTargets);
  patch(Bun, "connect", "Bun.connect", bunConnectTargets);
  mockNodeHttpModules();

  let charging = true;
  const charge = (phase: string) => {
    if (!charging) return;
    const refused = guard.takeRefused();
    if (refused.length > 0) throw chargeError(refused, phase);
  };
  afterEach(() => charge("This test"));
  // An attempt after the last test's afterEach, such as a timer, is charged once, at the end.
  afterAll(() => charge("The suite, after its last test,"));

  return () => {
    charging = false;
    for (const restore of restores.reverse()) restore();
  };
}
