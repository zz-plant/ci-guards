/**
 * Run by test/install.test.ts in a child `bun test` with preload.ts. Every test but the
 * last two reaches for a remote host and swallows the refusal, the way code that
 * degrades gracefully does, so each of them must fail.
 */
import { it } from "bun:test";
import https, { request as namedHttpsRequest } from "node:https";
import net, { Socket } from "node:net";
import { connect as namedTlsConnect } from "node:tls";

const REMOTE = "api.example.invalid";

/** Runs a call the way degrading code would: any error, sync or async, is swallowed. */
const swallow = async (call: () => unknown) => {
  try {
    const result = await call();
    if (typeof result === "object" && result !== null && "on" in result && typeof result.on === "function") {
      result.on("error", () => {});
    }
  } catch {
    // degraded gracefully
  }
};

it("swallows a fetch", () => swallow(() => fetch(`https://${REMOTE}/v1?token=secret`)));
it("swallows a named node:https request", () => swallow(() => namedHttpsRequest(`https://${REMOTE}/`)));
it("swallows a default node:https get", () => swallow(() => https.get({ hostname: REMOTE, port: 443 })));
it("swallows a net connect", () => swallow(() => net.connect(443, REMOTE)));
it("swallows a Socket#connect", () => swallow(() => new Socket().connect(443, REMOTE)));
it("swallows a named tls connect", () => swallow(() => namedTlsConnect(443, REMOTE)));
it("swallows a Bun.connect", () => swallow(() => Bun.connect({ hostname: REMOTE, port: 443, socket: { data() {} } })));
it("swallows a WebSocket", () => swallow(() => new WebSocket(`wss://${REMOTE}/`)));

it("reaches a loopback server through every API", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  try {
    const { port } = server;
    if (port === undefined) throw new Error("the server has no port");
    if ((await (await fetch(`http://127.0.0.1:${port}/`)).text()) !== "ok") throw new Error("fetch did not reach the server");
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end();
        resolve();
      });
      socket.on("error", reject);
    });
    const bunSocket = await Bun.connect({ hostname: "localhost", port, socket: { data() {} } });
    bunSocket.end();
  } finally {
    server.stop(true);
  }
});

it("makes no attempt at all", () => {});
