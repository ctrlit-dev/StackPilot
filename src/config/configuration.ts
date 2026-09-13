import * as vscode from "vscode";
import {
  DEFAULT_CONFIGURATION,
  type PackageManagerPreference,
  type StackPilotConfiguration,
  isPackageManagerPreference,
  validateConfiguration
} from "./configurationModel";

export interface ConfigurationReadResult {
  readonly value: StackPilotConfiguration;
  readonly diagnostics: ReturnType<typeof validateConfiguration>;
}

export function readStackPilotConfiguration(scope?: vscode.ConfigurationScope): ConfigurationReadResult {
  const config = vscode.workspace.getConfiguration("stackPilot", scope);
  const value: StackPilotConfiguration = {
    backendDirectory: config.get("backend.directory", DEFAULT_CONFIGURATION.backendDirectory),
    backendManagePy: config.get("backend.managePy", DEFAULT_CONFIGURATION.backendManagePy),
    pythonInterpreter: config.get("python.interpreter", DEFAULT_CONFIGURATION.pythonInterpreter),
    pythonVenvDirectory: config.get("python.venvDirectory", DEFAULT_CONFIGURATION.pythonVenvDirectory),
    frontendDirectory: config.get("frontend.directory", DEFAULT_CONFIGURATION.frontendDirectory),
    frontendPackageManager: readPackageManager(config.get("frontend.packageManager", DEFAULT_CONFIGURATION.frontendPackageManager)),
    frontendDevScript: config.get("frontend.devScript", DEFAULT_CONFIGURATION.frontendDevScript),
    frontendBuildScript: config.get("frontend.buildScript", DEFAULT_CONFIGURATION.frontendBuildScript),
    frontendTestScript: config.get("frontend.testScript", DEFAULT_CONFIGURATION.frontendTestScript),
    backendHost: config.get("backend.host", DEFAULT_CONFIGURATION.backendHost),
    backendPort: config.get("backend.port", DEFAULT_CONFIGURATION.backendPort),
    frontendPort: config.get("frontend.port", DEFAULT_CONFIGURATION.frontendPort),
    openBrowserOnStart: config.get("openBrowserOnStart", DEFAULT_CONFIGURATION.openBrowserOnStart),
    backendAutoRestart: config.get("backend.autoRestartOnCrash", DEFAULT_CONFIGURATION.backendAutoRestart),
    frontendAutoRestart: config.get("frontend.autoRestartOnCrash", DEFAULT_CONFIGURATION.frontendAutoRestart)
  };

  return {
    value,
    diagnostics: validateConfiguration(value)
  };
}

function readPackageManager(value: string): PackageManagerPreference {
  return isPackageManagerPreference(value) ? value : DEFAULT_CONFIGURATION.frontendPackageManager;
}
