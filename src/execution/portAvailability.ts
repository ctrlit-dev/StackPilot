import * as net from "node:net";

/**
 * Detects common port conflicts before launch (spec §39). Deliberately does
 * not kill or otherwise touch whatever is occupying the port - it only
 * reports availability so the caller can explain the conflict and offer an
 * alternative port.
 */
export interface PortChecker {
  isPortAvailable(host: string, port: number): Promise<boolean>;
}

export class NodePortChecker implements PortChecker {
  public isPortAvailable(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => {
        resolve(false);
      });
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, host);
    });
  }
}
