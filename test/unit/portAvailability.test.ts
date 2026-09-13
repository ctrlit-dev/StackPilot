import assert from "node:assert/strict";
import * as net from "node:net";
import test from "node:test";

import { NodePortChecker } from "../../src/execution/portAvailability";

function listenOnEphemeralPort(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected an AddressInfo from an ephemeral listener"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

void test("reports a free port as available", async () => {
  const { server, port } = await listenOnEphemeralPort();
  await closeServer(server);

  const checker = new NodePortChecker();
  assert.equal(await checker.isPortAvailable("127.0.0.1", port), true);
});

void test("reports a port already bound by another process as unavailable", async () => {
  const { server, port } = await listenOnEphemeralPort();

  const checker = new NodePortChecker();
  try {
    assert.equal(await checker.isPortAvailable("127.0.0.1", port), false);
  } finally {
    await closeServer(server);
  }
});

void test("releases the port after checking it, leaving it free for the real server to bind", async () => {
  const { server, port } = await listenOnEphemeralPort();
  await closeServer(server);

  const checker = new NodePortChecker();
  await checker.isPortAvailable("127.0.0.1", port);

  const realServer = net.createServer();
  await new Promise<void>((resolve, reject) => {
    realServer.once("error", reject);
    realServer.listen(port, "127.0.0.1", () => resolve());
  });
  await closeServer(realServer);
});
