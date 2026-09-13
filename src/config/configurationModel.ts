export const PACKAGE_MANAGERS = ["auto", "npm", "pnpm", "yarn", "bun"] as const;

export type PackageManagerPreference = (typeof PACKAGE_MANAGERS)[number];

export interface StackPilotConfiguration {
  backendDirectory: string;
  backendManagePy: string;
  pythonInterpreter: string;
  pythonVenvDirectory: string;
  frontendDirectory: string;
  frontendPackageManager: PackageManagerPreference;
  frontendDevScript: string;
  frontendBuildScript: string;
  frontendTestScript: string;
  backendHost: string;
  backendPort: number;
  frontendPort: number;
  openBrowserOnStart: boolean;
  backendAutoRestart: boolean;
  frontendAutoRestart: boolean;
}

export interface ConfigurationDiagnostic {
  readonly setting: string;
  readonly message: string;
}

export const DEFAULT_CONFIGURATION: StackPilotConfiguration = {
  backendDirectory: "backend",
  backendManagePy: "backend/manage.py",
  pythonInterpreter: "",
  pythonVenvDirectory: "backend/.venv",
  frontendDirectory: "frontend",
  frontendPackageManager: "auto",
  frontendDevScript: "dev",
  frontendBuildScript: "build",
  frontendTestScript: "test",
  backendHost: "127.0.0.1",
  backendPort: 8000,
  frontendPort: 5173,
  openBrowserOnStart: false,
  backendAutoRestart: false,
  frontendAutoRestart: false
};

const PATH_SETTINGS: ReadonlyArray<keyof Pick<
  StackPilotConfiguration,
  "backendDirectory" | "backendManagePy" | "pythonInterpreter" | "pythonVenvDirectory" | "frontendDirectory"
>> = ["backendDirectory", "backendManagePy", "pythonInterpreter", "pythonVenvDirectory", "frontendDirectory"];

const SCRIPT_SETTINGS: ReadonlyArray<keyof Pick<
  StackPilotConfiguration,
  "frontendDevScript" | "frontendBuildScript" | "frontendTestScript"
>> = ["frontendDevScript", "frontendBuildScript", "frontendTestScript"];

export function isPackageManagerPreference(value: string): value is PackageManagerPreference {
  return PACKAGE_MANAGERS.includes(value as PackageManagerPreference);
}

export function validateConfiguration(configuration: StackPilotConfiguration): ConfigurationDiagnostic[] {
  const diagnostics: ConfigurationDiagnostic[] = [];

  for (const setting of PATH_SETTINGS) {
    const value = configuration[setting];
    if (value.includes("\0")) {
      diagnostics.push({
        setting,
        message: "Path settings must not contain null bytes."
      });
    }
  }

  for (const setting of SCRIPT_SETTINGS) {
    const value = configuration[setting];
    if (value.trim().length === 0) {
      diagnostics.push({
        setting,
        message: "Script settings must not be empty."
      });
    }
  }

  if (!isPackageManagerPreference(configuration.frontendPackageManager)) {
    diagnostics.push({
      setting: "frontendPackageManager",
      message: `Package manager must be one of: ${PACKAGE_MANAGERS.join(", ")}.`
    });
  }

  diagnostics.push(...validatePort("backendPort", configuration.backendPort));
  diagnostics.push(...validatePort("frontendPort", configuration.frontendPort));

  if (configuration.backendHost.trim().length === 0) {
    diagnostics.push({
      setting: "backendHost",
      message: "Backend host must not be empty."
    });
  }

  return diagnostics;
}

function validatePort(setting: "backendPort" | "frontendPort", value: number): ConfigurationDiagnostic[] {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return [{
      setting,
      message: "Port must be an integer from 1 to 65535."
    }];
  }

  return [];
}
