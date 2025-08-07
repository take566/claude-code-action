import { describe, test, expect } from "bun:test";
import { getMode, isValidMode } from "../../src/modes/registry";
import { agentMode } from "../../src/modes/agent";
import { reviewMode } from "../../src/modes/review";
import { createMockContext, createMockAutomationContext } from "../mockContext";

describe("Mode Registry", () => {
  const mockContext = createMockContext({
    eventName: "issue_comment",
    payload: {
      action: "created",
      comment: {
        body: "Test comment without trigger",
      },
    } as any,
  });

  const mockWorkflowDispatchContext = createMockAutomationContext({
    eventName: "workflow_dispatch",
  });

  const mockScheduleContext = createMockAutomationContext({
    eventName: "schedule",
  });

  test("getMode auto-detects agent mode for issue_comment without trigger", () => {
    const mode = getMode(mockContext);
    // Agent mode is the default when no trigger is found
    expect(mode).toBe(agentMode);
    expect(mode.name).toBe("agent");
  });

  test("getMode auto-detects agent mode for workflow_dispatch", () => {
    const mode = getMode(mockWorkflowDispatchContext);
    expect(mode).toBe(agentMode);
    expect(mode.name).toBe("agent");
  });

  test("getMode can use explicit mode override for review", () => {
    const mode = getMode(mockContext, "review");
    expect(mode).toBe(reviewMode);
    expect(mode.name).toBe("experimental-review");
  });

  test("getMode auto-detects agent for workflow_dispatch", () => {
    const mode = getMode(mockWorkflowDispatchContext);
    expect(mode).toBe(agentMode);
    expect(mode.name).toBe("agent");
  });

  test("getMode auto-detects agent for schedule event", () => {
    const mode = getMode(mockScheduleContext);
    expect(mode).toBe(agentMode);
    expect(mode.name).toBe("agent");
  });

  test("getMode supports legacy experimental-review mode name", () => {
    const mode = getMode(mockContext, "experimental-review");
    expect(mode).toBe(reviewMode);
    expect(mode.name).toBe("experimental-review");
  });

  test("getMode auto-detects review mode for PR opened", () => {
    const prContext = createMockContext({
      eventName: "pull_request",
      payload: { action: "opened" } as any,
      isPR: true,
    });
    const mode = getMode(prContext);
    expect(mode).toBe(reviewMode);
    expect(mode.name).toBe("experimental-review");
  });

  test("getMode falls back to auto-detection for invalid mode override", () => {
    const mode = getMode(mockContext, "invalid");
    // Should fall back to auto-detection, which returns agent for issue_comment without trigger
    expect(mode).toBe(agentMode);
    expect(mode.name).toBe("agent");
  });

  test("isValidMode returns true for all valid modes", () => {
    expect(isValidMode("tag")).toBe(true);
    expect(isValidMode("agent")).toBe(true);
    expect(isValidMode("experimental-review")).toBe(true);
  });

  test("isValidMode returns false for invalid mode", () => {
    expect(isValidMode("invalid")).toBe(false);
  });
});
