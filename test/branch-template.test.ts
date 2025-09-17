#!/usr/bin/env bun

import { describe, it, expect } from "bun:test";
import {
  applyBranchTemplate,
  createBranchTemplateVariables,
  generateBranchName,
} from "../src/utils/branch-template";

describe("branch template utilities", () => {
  describe("applyBranchTemplate", () => {
    it("should replace all template variables", () => {
      const template =
        "{{prefix}}{{entityType}}-{{entityNumber}}-{{timestamp}}";
      const variables = {
        prefix: "feat/",
        entityType: "issue",
        entityNumber: 123,
        timestamp: "20240301-1430",
        sha: "abcd1234",
      };

      const result = applyBranchTemplate(template, variables);
      expect(result).toBe("feat/issue-123-20240301-1430");
    });

    it("should handle custom templates with multiple variables", () => {
      const template =
        "{{prefix}}fix/{{entityType}}_{{entityNumber}}_{{timestamp}}_{{sha}}";
      const variables = {
        prefix: "claude-",
        entityType: "pr",
        entityNumber: 456,
        timestamp: "20240301-1430",
        sha: "abcd1234",
      };

      const result = applyBranchTemplate(template, variables);
      expect(result).toBe("claude-fix/pr_456_20240301-1430_abcd1234");
    });

    it("should handle templates with missing variables gracefully", () => {
      const template = "{{prefix}}{{entityType}}-{{missing}}-{{entityNumber}}";
      const variables = {
        prefix: "feat/",
        entityType: "issue",
        entityNumber: 123,
        timestamp: "20240301-1430",
      };

      const result = applyBranchTemplate(template, variables);
      expect(result).toBe("feat/issue-{{missing}}-123");
    });
  });

  describe("createBranchTemplateVariables", () => {
    it("should create all required variables", () => {
      const result = createBranchTemplateVariables(
        "claude/",
        "issue",
        123,
        "abcdef123456",
      );

      expect(result.prefix).toBe("claude/");
      expect(result.entityType).toBe("issue");
      expect(result.entityNumber).toBe(123);
      expect(result.sha).toBe("abcdef12");
      expect(result.label).toBe("issue"); // fallback to entityType
      expect(result.timestamp).toMatch(/^\d{8}-\d{4}$/);
    });

    it("should handle SHA truncation", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "pr",
        456,
        "abcdef123456789",
      );
      expect(result.sha).toBe("abcdef12");
    });

    it("should handle missing SHA", () => {
      const result = createBranchTemplateVariables("test/", "pr", 456);
      expect(result.sha).toBeUndefined();
    });

    it("should use provided label when available", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        123,
        undefined,
        "bug",
      );
      expect(result.label).toBe("bug");
    });

    it("should fallback to entityType when label is not provided", () => {
      const result = createBranchTemplateVariables("test/", "pr", 456);
      expect(result.label).toBe("pr");
    });

    it("should fallback to entityType when label is empty string", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        789,
        undefined,
        "",
      );
      expect(result.label).toBe("issue");
    });

    it("should extract description from title when provided", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        123,
        undefined,
        undefined,
        "Fix login bug with OAuth",
      );
      expect(result.description).toBe("fix-login-bug");
    });

    it("should handle title with special characters", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        456,
        undefined,
        undefined,
        "Add: User Registration & Email Validation",
      );
      expect(result.description).toBe("add-user-registration");
    });

    it("should handle title with fewer than 3 words", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        789,
        undefined,
        undefined,
        "Bug fix",
      );
      expect(result.description).toBe("bug-fix");
    });

    it("should handle single word title", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        101,
        undefined,
        undefined,
        "Refactoring",
      );
      expect(result.description).toBe("refactoring");
    });

    it("should handle empty title", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        202,
        undefined,
        undefined,
        "",
      );
      expect(result.description).toBe("");
    });

    it("should handle title with extra whitespace", () => {
      const result = createBranchTemplateVariables(
        "test/",
        "issue",
        303,
        undefined,
        undefined,
        "  Update   README   documentation  ",
      );
      expect(result.description).toBe("update-readme-documentation");
    });

    it("should not set description when title is not provided", () => {
      const result = createBranchTemplateVariables("test/", "issue", 404);
      expect(result.description).toBeUndefined();
    });
  });

  describe("generateBranchName", () => {
    it("should use custom template when provided", () => {
      const template = "{{prefix}}custom-{{entityType}}_{{entityNumber}}";
      const result = generateBranchName(template, "feature/", "issue", 123);

      expect(result).toBe("feature/custom-issue_123");
    });

    it("should use default format when template is empty", () => {
      const result = generateBranchName("", "claude/", "issue", 123);

      expect(result).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
    });

    it("should use default format when template is undefined", () => {
      const result = generateBranchName(undefined, "claude/", "pr", 456);

      expect(result).toMatch(/^claude\/pr-456-\d{8}-\d{4}$/);
    });

    it("should apply Kubernetes-compatible transformations", () => {
      const template = "{{prefix}}UPPERCASE_Branch-Name_{{entityNumber}}";
      const result = generateBranchName(template, "Feature/", "issue", 123);

      expect(result).toBe("feature/uppercase_branch-name_123");
    });

    it("should truncate long branch names to 50 characters", () => {
      const template =
        "{{prefix}}very-long-branch-name-that-exceeds-the-maximum-allowed-length-{{entityNumber}}";
      const result = generateBranchName(template, "feature/", "issue", 123);

      expect(result.length).toBe(50);
      expect(result).toBe("feature/very-long-branch-name-that-exceeds-the-max");
    });

    it("should handle SHA in template", () => {
      const template = "{{prefix}}{{entityType}}-{{entityNumber}}-{{sha}}";
      const result = generateBranchName(
        template,
        "fix/",
        "pr",
        789,
        "abcdef123456",
      );

      expect(result).toBe("fix/pr-789-abcdef12");
    });

    it("should use label in template when provided", () => {
      const template = "{{prefix}}{{label}}/{{entityNumber}}";
      const result = generateBranchName(
        template,
        "feature/",
        "issue",
        123,
        undefined,
        "bug",
      );

      expect(result).toBe("feature/bug/123");
    });

    it("should fallback to entityType when label template is used but no label provided", () => {
      const template = "{{prefix}}{{label}}-{{entityNumber}}";
      const result = generateBranchName(template, "fix/", "pr", 456);

      expect(result).toBe("fix/pr-456");
    });

    it("should handle template with both label and entityType", () => {
      const template = "{{prefix}}{{label}}-{{entityType}}_{{entityNumber}}";
      const result = generateBranchName(
        template,
        "dev/",
        "issue",
        789,
        undefined,
        "enhancement",
      );

      expect(result).toBe("dev/enhancement-issue_789");
    });

    it("should use description in template when provided", () => {
      const template = "{{prefix}}{{description}}/{{entityNumber}}";
      const result = generateBranchName(
        template,
        "feature/",
        "issue",
        123,
        undefined,
        undefined,
        "Fix login bug with OAuth",
      );

      expect(result).toBe("feature/fix-login-bug/123");
    });

    it("should handle template with multiple variables including description", () => {
      const template =
        "{{prefix}}{{label}}/{{description}}-{{entityType}}_{{entityNumber}}";
      const result = generateBranchName(
        template,
        "dev/",
        "issue",
        456,
        undefined,
        "bug",
        "User authentication fails completely",
      );

      expect(result).toBe("dev/bug/user-authentication-fails-issue_456");
    });

    it("should handle description with special characters in template", () => {
      const template = "{{prefix}}{{description}}-{{entityNumber}}";
      const result = generateBranchName(
        template,
        "fix/",
        "pr",
        789,
        undefined,
        undefined,
        "Add: User Registration & Email Validation",
      );

      expect(result).toBe("fix/add-user-registration-789");
    });

    it("should handle empty description in template", () => {
      const template = "{{prefix}}{{description}}-{{entityNumber}}";
      const result = generateBranchName(
        template,
        "test/",
        "issue",
        101,
        undefined,
        undefined,
        "",
      );

      expect(result).toBe("test/-101");
    });
  });
});
