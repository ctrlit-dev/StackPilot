import * as path from "node:path";
import type { FrontendFrameworkDetection } from "./frontendFrameworkDetection";

/** Moved verbatim from the pre-2B.4 `frontendDetector.ts`, behavior byte-for-byte unchanged. */
const VITE_CONFIG_FILES = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"] as const;

export const viteFrontendDetection: FrontendFrameworkDetection = {
  frameworkId: "vite",

  async findFrameworkConfigPath(fs, rootPath) {
    for (const configFile of VITE_CONFIG_FILES) {
      const configPath = path.join(rootPath, configFile);
      if (await fs.fileExists(configPath)) {
        return configPath;
      }
    }

    return undefined;
  }
};
