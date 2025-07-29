/**
 * Handles exporting tool-related environment variables
 */

import * as core from "@actions/core";
import type { Mode } from "../modes/types";
import type { ParsedGitHubContext } from "../github/context";
import {
  buildAllowedToolsString,
  buildDisallowedToolsString,
} from "../create-prompt/index";

export function exportToolEnvironmentVariables(
  mode: Mode,
  context: ParsedGitHubContext,
): void {
  const hasActionsReadPermission =
    context.inputs.additionalPermissions.get("actions") === "read" &&
    context.isPR;

  const modeAllowedTools = mode.getAllowedTools();
  const modeDisallowedTools = mode.getDisallowedTools();

  // Combine with existing allowed tools
  const combinedAllowedTools = [
    ...context.inputs.allowedTools,
    ...modeAllowedTools,
  ];
  const combinedDisallowedTools = [
    ...context.inputs.disallowedTools,
    ...modeDisallowedTools,
  ];

  const allAllowedTools = buildAllowedToolsString(
    combinedAllowedTools,
    hasActionsReadPermission,
    context.inputs.useCommitSigning,
  );
  const allDisallowedTools = buildDisallowedToolsString(
    combinedDisallowedTools,
    combinedAllowedTools,
  );

  console.log(`Allowed tools: ${allAllowedTools}`);
  console.log(`Disallowed tools: ${allDisallowedTools}`);

  core.exportVariable("ALLOWED_TOOLS", allAllowedTools);
  core.exportVariable("DISALLOWED_TOOLS", allDisallowedTools);
}
