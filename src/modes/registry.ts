/**
 * Mode Registry for claude-code-action v1.0
 *
 * This module provides access to all available execution modes and handles
 * automatic mode detection based on GitHub event types.
 */

import type { Mode, ModeName } from "./types";
import { tagMode } from "./tag";
import { agentMode } from "./agent";
import { reviewMode } from "./review";
import type { GitHubContext } from "../github/context";
import { detectMode, type AutoDetectedMode } from "./detector";

export const VALID_MODES = ["tag", "agent", "review"] as const;

/**
 * All available modes in v1.0
 */
const modes = {
  tag: tagMode,
  agent: agentMode,
  review: reviewMode,
} as const satisfies Record<AutoDetectedMode, Mode>;

/**
 * Automatically detects and retrieves the appropriate mode based on the GitHub context.
 * In v1.0, modes are auto-selected based on event type.
 * @param context The GitHub context
 * @param explicitMode Optional explicit mode override (for backward compatibility)
 * @returns The appropriate mode for the context
 */
export function getMode(context: GitHubContext, explicitMode?: string): Mode {
  let modeName: AutoDetectedMode;

  if (explicitMode && isValidModeV1(explicitMode)) {
    console.log(`Using explicit mode: ${explicitMode}`);
    modeName = mapLegacyMode(explicitMode);
  } else {
    modeName = detectMode(context);
    console.log(
      `Auto-detected mode: ${modeName} for event: ${context.eventName}`,
    );
  }

  const mode = modes[modeName];
  if (!mode) {
    throw new Error(
      `Mode '${modeName}' not found. This should not happen. Please report this issue.`,
    );
  }

  return mode;
}

/**
 * Maps legacy mode names to v1.0 mode names
 */
function mapLegacyMode(name: string): AutoDetectedMode {
  if (name === "experimental-review") {
    return "review";
  }
  return name as AutoDetectedMode;
}

/**
 * Type guard to check if a string is a valid v1.0 mode name.
 * @param name The string to check
 * @returns True if the name is a valid mode name
 */
export function isValidModeV1(name: string): boolean {
  const v1Modes = ["tag", "agent", "review", "experimental-review"];
  return v1Modes.includes(name);
}

/**
 * Legacy type guard for backward compatibility
 * @deprecated Use auto-detection instead
 */
export function isValidMode(name: string): name is ModeName {
  return isValidModeV1(name);
}
