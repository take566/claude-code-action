import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";
import { setupBranch, type BranchInfo } from "../branch";
import type { Octokits } from "../../api/client";
import type { FetchDataResult } from "../../data/fetcher";
import type { ParsedGitHubContext } from "../../context";
import type { GitHubPullRequest, GitHubIssue } from "../../types";

// Mock process.exit to prevent tests from actually exiting
const mockExit = mock(() => {});
const originalExit = process.exit;

describe("setupBranch", () => {
  let mockOctokits: Octokits;
  let mockContext: ParsedGitHubContext;
  let mockGithubData: FetchDataResult;

  beforeEach(() => {
    // Replace process.exit temporarily
    (process as any).exit = mockExit;
    mockExit.mockClear();

    // Simple mock objects
    mockOctokits = {
      rest: {
        repos: {
          get: mock(() => Promise.resolve({ data: { default_branch: "main" } })),
        },
        git: {
          getRef: mock(() => Promise.resolve({ 
            data: { object: { sha: "abc123def456" } } 
          })),
        },
      },
      graphql: mock(() => Promise.resolve({})),
    } as any;

    mockContext = {
      repository: {
        owner: "test-owner",
        repo: "test-repo",
        full_name: "test-owner/test-repo",
      },
      isPR: false,
      entityNumber: 123,
      inputs: {
        branchPrefix: "claude/",
        useCommitSigning: false,
      },
    } as ParsedGitHubContext;

    // Default mock data for issues
    mockGithubData = {
      contextData: {
        title: "Test Issue",
        body: "Test issue body",
        state: "OPEN",
      } as GitHubIssue,
      comments: [],
      changedFiles: [],
      changedFilesWithSHA: [],
      reviewData: null,
    };
  });

  afterEach(() => {
    // Restore original process.exit
    process.exit = originalExit;
  });

  describe("Issue branch creation", () => {
    test("should create new branch for issue using default branch as source", async () => {
      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("main");
      expect(result.claudeBranch).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
      expect(result.currentBranch).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
    });

    test("should use provided base branch as source", async () => {
      mockContext.inputs.baseBranch = "develop";
      
      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("develop");
      expect(result.claudeBranch).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
    });

    test("should handle commit signing mode", async () => {
      mockContext.inputs.useCommitSigning = true;

      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("main");
      expect(result.currentBranch).toBe("main"); // Should stay on source branch
      expect(result.claudeBranch).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
    });
  });

  describe("PR branch handling", () => {
    beforeEach(() => {
      mockContext.isPR = true;
      mockGithubData.contextData = {
        title: "Test PR",
        body: "Test PR body",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "feature/test",
        commits: { totalCount: 5 },
      } as GitHubPullRequest;
    });

    test("should checkout existing PR branch for open PR", async () => {
      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("main");
      expect(result.currentBranch).toBe("feature/test");
      expect(result.claudeBranch).toBeUndefined(); // No claude branch for open PRs
    });

    test("should create new branch for closed PR", async () => {
      const closedPR = mockGithubData.contextData as GitHubPullRequest;
      closedPR.state = "CLOSED";

      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("main");
      expect(result.claudeBranch).toMatch(/^claude\/pr-123-\d{8}-\d{4}$/);
      expect(result.currentBranch).toMatch(/^claude\/pr-123-\d{8}-\d{4}$/);
    });

    test("should create new branch for merged PR", async () => {
      const mergedPR = mockGithubData.contextData as GitHubPullRequest;
      mergedPR.state = "MERGED";

      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.baseBranch).toBe("main");
      expect(result.claudeBranch).toMatch(/^claude\/pr-123-\d{8}-\d{4}$/);
    });
  });

  describe("Error handling", () => {
    test("should exit with code 1 when source branch doesn't exist", async () => {
      mockOctokits.rest.git.getRef = mock(() => Promise.reject(new Error("Branch not found")));

      await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    test("should exit with code 1 when repository fetch fails", async () => {
      mockOctokits.rest.repos.get = mock(() => Promise.reject(new Error("Repository not found")));

      await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("Branch naming", () => {
    test("should generate kubernetes-compatible branch names", async () => {
      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      // Branch name should be lowercase, use hyphens, and include timestamp
      expect(result.claudeBranch).toMatch(/^claude\/issue-123-\d{8}-\d{4}$/);
      expect(result.claudeBranch?.length).toBeLessThanOrEqual(50);
    });

    test("should use custom branch prefix", async () => {
      mockContext.inputs.branchPrefix = "ai/";

      const result = await setupBranch(mockOctokits, mockGithubData, mockContext);

      expect(result.claudeBranch).toMatch(/^ai\/issue-123-\d{8}-\d{4}$/);
    });
  });
});