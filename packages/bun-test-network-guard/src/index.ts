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
 * Loopback stays open: a server the suite itself started is the suite owning its
 * upstream rather than reaching for someone else's.
 *
 * A test that assigns its own mock over `globalThis.fetch` still wins. The guard
 * only decides what an *unmocked* call does.
 */

export type FetchInput = Parameters<typeof fetch>[0];

/**
 * Anything callable like `fetch`. Bun's `typeof fetch` also carries `preconnect`,
 * which a test's stub fetcher has no reason to implement, so the pass-through is
 * accepted in the looser shape and `preconnect` is forwarded when present.
 */
export type FetchLike = ((input: FetchInput, init?: RequestInit) => Promise<Response>) & {
  preconnect?: (url: string | URL) => void;
};

/**
 * Loopback and relative URLs. Judged as an address, never as a string prefix:
 * `/^127\./` also accepts `127.0.0.1.example.com`, which is an ordinary remote
 * host anyone can register, so the check has to see four octets and nothing else.
 */
export const isLocalTarget = (url: string): boolean => {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true; // relative: never leaves the process
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // not a URL we can judge; let fetch report it
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  // RFC 6761 reserves .localhost for loopback.
  if (host.endsWith(".localhost")) return true;
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
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

export interface GuardOptions {
  /**
   * Printed to stderr once per process, the first time a request is blocked.
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

const defaultExplanation = (allowEnv: string, hint?: string) =>
  "[test-network-guard] This suite serves its own upstreams so a run means the same thing on every box.\n" +
  "  Serve one: pass a fixture fetcher into the code under test, or assign globalThis.fetch in the test and restore it after.\n" +
  (hint ? `  ${hint}\n` : "") +
  `  To exercise the real upstream on purpose: ${allowEnv}=1.\n`;

/**
 * Wraps `passThrough` so anything but a local target throws instead of leaving the box.
 * The thrown message is one line on purpose; see `GuardOptions.explain`.
 */
export function createGuardedFetch(
  passThrough: FetchLike,
  explain: (text: string) => void,
  options: Pick<GuardOptions, "allowEnv" | "hint"> = {},
): typeof fetch {
  let explained = false;
  const allowEnv = options.allowEnv ?? DEFAULT_ALLOW_ENV;

  const guard = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url = targetUrl(input);
    if (isLocalTarget(url)) return passThrough(input, init);

    if (!explained) {
      explained = true;
      explain(defaultExplanation(allowEnv, options.hint));
    }

    throw new Error(`[test-network-guard] blocked outbound fetch to ${redactTarget(url)}`);
  };

  // Typed by annotation rather than asserted: `preconnect` is a hint, and a hint to a
  // remote host is harmless, so it is forwarded unguarded.
  const guardedFetch: typeof fetch = Object.assign(guard, {
    preconnect: (url: string | URL) => passThrough.preconnect?.(url),
  });

  return guardedFetch;
}

/**
 * Installs the guard over `globalThis.fetch` unless the allow variable is set to `1`.
 * Returns a function that restores the previous `fetch`.
 */
export function installNetworkGuard(options: GuardOptions = {}): () => void {
  const allowEnv = options.allowEnv ?? DEFAULT_ALLOW_ENV;
  if (process.env[allowEnv] === "1") return () => {};

  const previous = globalThis.fetch;
  const explain = options.explain ?? ((text: string) => process.stderr.write(text));
  globalThis.fetch = createGuardedFetch(previous, explain, { allowEnv, hint: options.hint });
  return () => {
    globalThis.fetch = previous;
  };
}
