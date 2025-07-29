import { describe, test, expect, beforeEach } from "bun:test";
import { agentMode } from "../../src/modes/agent";
import type { ParsedGitHubContext } from "../../src/github/context";
import { createMockContext } from "../mockContext";

describe("Agent Mode", () => {
  let mockContext: ParsedGitHubContext;

  beforeEach(() => {
    mockContext = createMockContext({
      eventName: "workflow_dispatch",
      isPR: false,
    });
  });

  test("agent mode has correct properties", () => {
    expect(agentMode.name).toBe("agent");
    expect(agentMode.description).toBe(
      "Automation mode for workflow_dispatch and schedule events",
    );
    expect(agentMode.shouldCreateTrackingComment()).toBe(false);
    expect(agentMode.getAllowedTools()).toEqual([]);
    expect(agentMode.getDisallowedTools()).toEqual([]);
  });

  test("prepareContext returns minimal data", () => {
    const context = agentMode.prepareContext(mockContext);

    expect(context.mode).toBe("agent");
    expect(context.githubContext).toBe(mockContext);
    // Agent mode doesn't use comment tracking or branch management
    expect(Object.keys(context)).toEqual(["mode", "githubContext"]);
  });

  test("agent mode only triggers for workflow_dispatch and schedule events", () => {
    // Should trigger for automation events
    const workflowDispatchContext = createMockContext({
      eventName: "workflow_dispatch",
      isPR: false,
    });
    expect(agentMode.shouldTrigger(workflowDispatchContext)).toBe(true);

    const scheduleContext = createMockContext({
      eventName: "schedule",
      isPR: false,
    });
    expect(agentMode.shouldTrigger(scheduleContext)).toBe(true);

    // Should NOT trigger for other events
    const otherEvents = [
      "push",
      "repository_dispatch",
      "issue_comment",
      "pull_request",
      "pull_request_review",
      "issues",
    ];

    otherEvents.forEach((eventName) => {
      const context = createMockContext({ eventName, isPR: false });
      expect(agentMode.shouldTrigger(context)).toBe(false);
    });
  });
});
