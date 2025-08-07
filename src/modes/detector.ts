import type { GitHubContext } from "../github/context";
import {
  isEntityContext,
  isIssueCommentEvent,
  isPullRequestReviewCommentEvent,
} from "../github/context";
import { checkContainsTrigger } from "../github/validation/trigger";

export type AutoDetectedMode = "tag" | "agent";

export function detectMode(context: GitHubContext): AutoDetectedMode {
  // If prompt is provided, always use agent mode
  // Reasoning: When users provide explicit instructions via the prompt parameter,
  // they want Claude to execute those instructions immediately without waiting for
  // @claude mentions or other triggers. This aligns with the v1.0 philosophy where
  // Claude Code handles everything - the GitHub Action is just a thin wrapper that
  // passes through prompts directly to Claude Code for native handling (including
  // slash commands). This provides the most direct and flexible interaction model.
  if (context.inputs?.prompt) {
    return "agent";
  }

  // Check for @claude mentions (tag mode)
  if (isEntityContext(context)) {
    if (
      isIssueCommentEvent(context) ||
      isPullRequestReviewCommentEvent(context)
    ) {
      if (checkContainsTrigger(context)) {
        return "tag";
      }
    }

    if (context.eventName === "issues") {
      if (checkContainsTrigger(context)) {
        return "tag";
      }
    }
  }

  // Default to agent mode for everything else
  return "agent";
}

export function getModeDescription(mode: AutoDetectedMode): string {
  switch (mode) {
    case "tag":
      return "Interactive mode triggered by @claude mentions";
    case "agent":
      return "General automation mode for all events";
    default:
      return "Unknown mode";
  }
}

export function shouldUseTrackingComment(mode: AutoDetectedMode): boolean {
  return mode === "tag";
}

export function getDefaultPromptForMode(
  mode: AutoDetectedMode,
  context: GitHubContext,
): string | undefined {
  switch (mode) {
    case "tag":
      return undefined;
    case "agent":
      return context.inputs?.prompt;
    default:
      return undefined;
  }
}
