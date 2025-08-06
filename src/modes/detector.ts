import type { GitHubContext } from "../github/context";
import {
  isEntityContext,
  isAutomationContext,
  isPullRequestEvent,
  isIssueCommentEvent,
  isPullRequestReviewCommentEvent,
} from "../github/context";
import { checkContainsTrigger } from "../github/validation/trigger";

export type AutoDetectedMode = "review" | "tag" | "agent";

export function detectMode(context: GitHubContext): AutoDetectedMode {
  if (isPullRequestEvent(context)) {
    const allowedActions = ["opened", "synchronize", "reopened"];
    const action = context.payload.action;
    if (allowedActions.includes(action)) {
      return "review";
    }
  }

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

  if (isAutomationContext(context)) {
    return "agent";
  }

  return "agent";
}

export function getModeDescription(mode: AutoDetectedMode): string {
  switch (mode) {
    case "review":
      return "Automated code review mode for pull requests";
    case "tag":
      return "Interactive mode triggered by @claude mentions";
    case "agent":
      return "Automation mode for scheduled tasks and workflows";
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
    case "review":
      return "/review";
    case "tag":
      return undefined;
    case "agent":
      return context.inputs?.directPrompt || context.inputs?.overridePrompt;
    default:
      return undefined;
  }
}