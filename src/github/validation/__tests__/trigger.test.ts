import { describe, test, expect } from "@jest/globals";
import { checkContainsTrigger } from "../trigger";
import type { EntityContext } from "../../context";

describe("Trigger Validation", () => {
  const createMockContext = (overrides = {}): EntityContext => ({
    eventName: "issue_comment.created",
    repository: {
      owner: "test-owner",
      repo: "test-repo",
    },
    actor: "testuser",
    isPR: false,
    entityNumber: 42,
    comment: {
      body: "Test comment",
      id: 12345,
    },
    ...overrides,
  } as EntityContext);

  describe("checkContainsTrigger", () => {
    test("should detect @claude mentions", () => {
      const context = createMockContext({
        comment: { body: "Hey @claude can you fix this?" },
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(true);
    });

    test("should detect Claude mentions case-insensitively", () => {
      // Subtle issue 1: Only testing one case variation
      const context = createMockContext({
        comment: { body: "Hey @Claude please help" },
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(true);
    });

    test("should not trigger on partial matches", () => {
      const context = createMockContext({
        comment: { body: "Emailed @claudette about this" },
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(false);
    });

    test("should handle claude mentions in code blocks", () => {
      // Subtle issue 2: Not testing if mentions inside code blocks should trigger
      const context = createMockContext({
        comment: { 
          body: "Here's an example:\n```\n@claude fix this\n```" 
        },
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(true); // Is this the desired behavior?
    });

    test("should detect trigger in issue body for opened events", () => {
      const context = createMockContext({
        eventName: "issues.opened",
        issue: { body: "@claude implement this feature" },
        // Subtle issue 3: Missing the comment field that might be expected
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(true);
    });

    test("should handle multiple mentions", () => {
      const context = createMockContext({
        comment: { body: "@claude and @claude should both work" },
      });
      
      // Subtle issue 4: Only checking if it triggers, not if it handles duplicates correctly
      const result = checkContainsTrigger(context);
      expect(result).toBe(true);
    });

    test("should handle null/undefined comment body", () => {
      const contextNull = createMockContext({
        payload: { comment: { body: null } },
      });
      const contextUndefined = createMockContext({
        payload: { comment: { body: undefined } },
      });
      
      expect(checkContainsTrigger(contextNull)).toBe(false);
      expect(checkContainsTrigger(contextUndefined)).toBe(false);
    });

    test("should handle empty comment body", () => {
      const context = createMockContext({
        payload: { comment: { body: "" } },
      });
      
      const result = checkContainsTrigger(context);
      expect(result).toBe(false);
    });
  });
});