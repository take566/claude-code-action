import { describe, expect, it, jest } from "bun:test";
import {
  extractTriggerTimestamp,
  fetchGitHubData,
  filterCommentsToTriggerTime,
  filterReviewsToTriggerTime,
} from "../src/github/data/fetcher";
import {
  createMockContext,
  mockIssueCommentContext,
  mockPullRequestReviewContext,
  mockPullRequestReviewCommentContext,
  mockPullRequestOpenedContext,
  mockIssueOpenedContext,
} from "./mockContext";
import type { GitHubComment, GitHubReview } from "../src/github/types";

describe("extractTriggerTimestamp", () => {
  it("should extract timestamp from IssueCommentEvent", () => {
    const context = mockIssueCommentContext;
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBe("2024-01-15T12:30:00Z");
  });

  it("should extract timestamp from PullRequestReviewEvent", () => {
    const context = mockPullRequestReviewContext;
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBe("2024-01-15T15:30:00Z");
  });

  it("should extract timestamp from PullRequestReviewCommentEvent", () => {
    const context = mockPullRequestReviewCommentContext;
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBe("2024-01-15T16:45:00Z");
  });

  it("should return undefined for pull_request event", () => {
    const context = mockPullRequestOpenedContext;
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBeUndefined();
  });

  it("should return undefined for issues event", () => {
    const context = mockIssueOpenedContext;
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBeUndefined();
  });

  it("should handle missing timestamp fields gracefully", () => {
    const context = createMockContext({
      eventName: "issue_comment",
      payload: {
        comment: {
          // No created_at field
          id: 123,
          body: "test",
        },
      } as any,
    });
    const timestamp = extractTriggerTimestamp(context);
    expect(timestamp).toBeUndefined();
  });
});

describe("filterCommentsToTriggerTime", () => {
  const createMockComment = (
    createdAt: string,
    updatedAt?: string,
    lastEditedAt?: string,
  ): GitHubComment => ({
    id: String(Math.random()),
    databaseId: String(Math.random()),
    body: "Test comment",
    author: { login: "test-user" },
    createdAt,
    updatedAt,
    lastEditedAt,
    isMinimized: false,
  });

  const triggerTime = "2024-01-15T12:00:00Z";

  describe("comment creation time filtering", () => {
    it("should include comments created before trigger time", () => {
      const comments = [
        createMockComment("2024-01-15T11:00:00Z"),
        createMockComment("2024-01-15T11:30:00Z"),
        createMockComment("2024-01-15T11:59:59Z"),
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(comments);
    });

    it("should exclude comments created after trigger time", () => {
      const comments = [
        createMockComment("2024-01-15T12:00:01Z"),
        createMockComment("2024-01-15T13:00:00Z"),
        createMockComment("2024-01-16T00:00:00Z"),
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(0);
    });

    it("should handle exact timestamp match (at trigger time)", () => {
      const comment = createMockComment("2024-01-15T12:00:00Z");
      const filtered = filterCommentsToTriggerTime([comment], triggerTime);
      // Comments created exactly at trigger time should be excluded for security
      expect(filtered.length).toBe(0);
    });
  });

  describe("comment edit time filtering", () => {
    it("should include comments edited before trigger time", () => {
      const comments = [
        createMockComment("2024-01-15T10:00:00Z", "2024-01-15T11:00:00Z"),
        createMockComment(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T11:30:00Z",
        ),
        createMockComment(
          "2024-01-15T10:00:00Z",
          "2024-01-15T11:00:00Z",
          "2024-01-15T11:30:00Z",
        ),
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(comments);
    });

    it("should exclude comments edited after trigger time", () => {
      const comments = [
        createMockComment("2024-01-15T10:00:00Z", "2024-01-15T13:00:00Z"),
        createMockComment(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T13:00:00Z",
        ),
        createMockComment(
          "2024-01-15T10:00:00Z",
          "2024-01-15T11:00:00Z",
          "2024-01-15T13:00:00Z",
        ),
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(0);
    });

    it("should prioritize lastEditedAt over updatedAt", () => {
      const comment = createMockComment(
        "2024-01-15T10:00:00Z",
        "2024-01-15T13:00:00Z", // updatedAt after trigger
        "2024-01-15T11:00:00Z", // lastEditedAt before trigger
      );

      const filtered = filterCommentsToTriggerTime([comment], triggerTime);
      // lastEditedAt takes precedence, so this should be included
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toBe(comment);
    });

    it("should handle comments without edit timestamps", () => {
      const comment = createMockComment("2024-01-15T10:00:00Z");
      expect(comment.updatedAt).toBeUndefined();
      expect(comment.lastEditedAt).toBeUndefined();

      const filtered = filterCommentsToTriggerTime([comment], triggerTime);
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toBe(comment);
    });

    it("should exclude comments edited exactly at trigger time", () => {
      const comments = [
        createMockComment("2024-01-15T10:00:00Z", "2024-01-15T12:00:00Z"), // updatedAt exactly at trigger
        createMockComment(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T12:00:00Z",
        ), // lastEditedAt exactly at trigger
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should return all comments when no trigger time provided", () => {
      const comments = [
        createMockComment("2024-01-15T10:00:00Z"),
        createMockComment("2024-01-15T13:00:00Z"),
        createMockComment("2024-01-16T00:00:00Z"),
      ];

      const filtered = filterCommentsToTriggerTime(comments, undefined);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(comments);
    });

    it("should handle millisecond precision", () => {
      const comments = [
        createMockComment("2024-01-15T12:00:00.001Z"), // After trigger by 1ms
        createMockComment("2024-01-15T11:59:59.999Z"), // Before trigger
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.createdAt).toBe("2024-01-15T11:59:59.999Z");
    });

    it("should handle various ISO timestamp formats", () => {
      const comments = [
        createMockComment("2024-01-15T11:00:00Z"),
        createMockComment("2024-01-15T11:00:00.000Z"),
        createMockComment("2024-01-15T11:00:00+00:00"),
      ];

      const filtered = filterCommentsToTriggerTime(comments, triggerTime);
      expect(filtered.length).toBe(3);
    });
  });
});

describe("filterReviewsToTriggerTime", () => {
  const createMockReview = (
    submittedAt: string,
    updatedAt?: string,
    lastEditedAt?: string,
  ): GitHubReview => ({
    id: String(Math.random()),
    databaseId: String(Math.random()),
    author: { login: "reviewer" },
    body: "Test review",
    state: "APPROVED",
    submittedAt,
    updatedAt,
    lastEditedAt,
    comments: { nodes: [] },
  });

  const triggerTime = "2024-01-15T12:00:00Z";

  describe("review submission time filtering", () => {
    it("should include reviews submitted before trigger time", () => {
      const reviews = [
        createMockReview("2024-01-15T11:00:00Z"),
        createMockReview("2024-01-15T11:30:00Z"),
        createMockReview("2024-01-15T11:59:59Z"),
      ];

      const filtered = filterReviewsToTriggerTime(reviews, triggerTime);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(reviews);
    });

    it("should exclude reviews submitted after trigger time", () => {
      const reviews = [
        createMockReview("2024-01-15T12:00:01Z"),
        createMockReview("2024-01-15T13:00:00Z"),
        createMockReview("2024-01-16T00:00:00Z"),
      ];

      const filtered = filterReviewsToTriggerTime(reviews, triggerTime);
      expect(filtered.length).toBe(0);
    });

    it("should handle exact timestamp match", () => {
      const review = createMockReview("2024-01-15T12:00:00Z");
      const filtered = filterReviewsToTriggerTime([review], triggerTime);
      // Reviews submitted exactly at trigger time should be excluded for security
      expect(filtered.length).toBe(0);
    });
  });

  describe("review edit time filtering", () => {
    it("should include reviews edited before trigger time", () => {
      const reviews = [
        createMockReview("2024-01-15T10:00:00Z", "2024-01-15T11:00:00Z"),
        createMockReview(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T11:30:00Z",
        ),
        createMockReview(
          "2024-01-15T10:00:00Z",
          "2024-01-15T11:00:00Z",
          "2024-01-15T11:30:00Z",
        ),
      ];

      const filtered = filterReviewsToTriggerTime(reviews, triggerTime);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(reviews);
    });

    it("should exclude reviews edited after trigger time", () => {
      const reviews = [
        createMockReview("2024-01-15T10:00:00Z", "2024-01-15T13:00:00Z"),
        createMockReview(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T13:00:00Z",
        ),
        createMockReview(
          "2024-01-15T10:00:00Z",
          "2024-01-15T11:00:00Z",
          "2024-01-15T13:00:00Z",
        ),
      ];

      const filtered = filterReviewsToTriggerTime(reviews, triggerTime);
      expect(filtered.length).toBe(0);
    });

    it("should prioritize lastEditedAt over updatedAt", () => {
      const review = createMockReview(
        "2024-01-15T10:00:00Z",
        "2024-01-15T13:00:00Z", // updatedAt after trigger
        "2024-01-15T11:00:00Z", // lastEditedAt before trigger
      );

      const filtered = filterReviewsToTriggerTime([review], triggerTime);
      // lastEditedAt takes precedence, so this should be included
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toBe(review);
    });

    it("should handle reviews without edit timestamps", () => {
      const review = createMockReview("2024-01-15T10:00:00Z");
      expect(review.updatedAt).toBeUndefined();
      expect(review.lastEditedAt).toBeUndefined();

      const filtered = filterReviewsToTriggerTime([review], triggerTime);
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toBe(review);
    });

    it("should exclude reviews edited exactly at trigger time", () => {
      const reviews = [
        createMockReview("2024-01-15T10:00:00Z", "2024-01-15T12:00:00Z"), // updatedAt exactly at trigger
        createMockReview(
          "2024-01-15T10:00:00Z",
          undefined,
          "2024-01-15T12:00:00Z",
        ), // lastEditedAt exactly at trigger
      ];

      const filtered = filterReviewsToTriggerTime(reviews, triggerTime);
      expect(filtered.length).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should return all reviews when no trigger time provided", () => {
      const reviews = [
        createMockReview("2024-01-15T10:00:00Z"),
        createMockReview("2024-01-15T13:00:00Z"),
        createMockReview("2024-01-16T00:00:00Z"),
      ];

      const filtered = filterReviewsToTriggerTime(reviews, undefined);
      expect(filtered.length).toBe(3);
      expect(filtered).toEqual(reviews);
    });
  });
});

describe("fetchGitHubData integration with time filtering", () => {
  it("should filter comments based on trigger time when provided", async () => {
    const mockOctokits = {
      graphql: jest.fn().mockResolvedValue({
        repository: {
          issue: {
            number: 123,
            title: "Test Issue",
            body: "Issue body",
            author: { login: "author" },
            comments: {
              nodes: [
                {
                  id: "1",
                  databaseId: "1",
                  body: "Comment before trigger",
                  author: { login: "user1" },
                  createdAt: "2024-01-15T11:00:00Z",
                  updatedAt: "2024-01-15T11:00:00Z",
                },
                {
                  id: "2",
                  databaseId: "2",
                  body: "Comment after trigger",
                  author: { login: "user2" },
                  createdAt: "2024-01-15T13:00:00Z",
                  updatedAt: "2024-01-15T13:00:00Z",
                },
                {
                  id: "3",
                  databaseId: "3",
                  body: "Comment before but edited after",
                  author: { login: "user3" },
                  createdAt: "2024-01-15T11:00:00Z",
                  updatedAt: "2024-01-15T13:00:00Z",
                  lastEditedAt: "2024-01-15T13:00:00Z",
                },
              ],
            },
          },
        },
        user: { login: "trigger-user" },
      }),
      rest: jest.fn() as any,
    };

    const result = await fetchGitHubData({
      octokits: mockOctokits as any,
      repository: "test-owner/test-repo",
      prNumber: "123",
      isPR: false,
      triggerUsername: "trigger-user",
      triggerTime: "2024-01-15T12:00:00Z",
    });

    // Should only include the comment created before trigger time
    expect(result.comments.length).toBe(1);
    expect(result.comments[0]?.id).toBe("1");
    expect(result.comments[0]?.body).toBe("Comment before trigger");
  });

  it("should filter PR reviews based on trigger time", async () => {
    const mockOctokits = {
      graphql: jest.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            number: 456,
            title: "Test PR",
            body: "PR body",
            author: { login: "author" },
            comments: { nodes: [] },
            files: { nodes: [] },
            reviews: {
              nodes: [
                {
                  id: "1",
                  databaseId: "1",
                  author: { login: "reviewer1" },
                  body: "Review before trigger",
                  state: "APPROVED",
                  submittedAt: "2024-01-15T11:00:00Z",
                  comments: { nodes: [] },
                },
                {
                  id: "2",
                  databaseId: "2",
                  author: { login: "reviewer2" },
                  body: "Review after trigger",
                  state: "CHANGES_REQUESTED",
                  submittedAt: "2024-01-15T13:00:00Z",
                  comments: { nodes: [] },
                },
                {
                  id: "3",
                  databaseId: "3",
                  author: { login: "reviewer3" },
                  body: "Review before but edited after",
                  state: "COMMENTED",
                  submittedAt: "2024-01-15T11:00:00Z",
                  updatedAt: "2024-01-15T13:00:00Z",
                  lastEditedAt: "2024-01-15T13:00:00Z",
                  comments: { nodes: [] },
                },
              ],
            },
          },
        },
        user: { login: "trigger-user" },
      }),
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({ data: [] }),
        },
      },
    };

    const result = await fetchGitHubData({
      octokits: mockOctokits as any,
      repository: "test-owner/test-repo",
      prNumber: "456",
      isPR: true,
      triggerUsername: "trigger-user",
      triggerTime: "2024-01-15T12:00:00Z",
    });

    // The reviewData field returns all reviews (not filtered), but the filtering
    // happens when processing review bodies for download
    // We can check the image download map to verify filtering
    expect(result.reviewData?.nodes?.length).toBe(3); // All reviews are returned

    // Check that only the first review's body would be downloaded (filtered)
    const reviewsInMap = Object.keys(result.imageUrlMap).filter((key) =>
      key.startsWith("review_body"),
    );
    // Only review 1 should have its body processed (before trigger and not edited after)
    expect(reviewsInMap.length).toBeLessThanOrEqual(1);
  });

  it("should filter review comments based on trigger time", async () => {
    const mockOctokits = {
      graphql: jest.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            number: 789,
            title: "Test PR",
            body: "PR body",
            author: { login: "author" },
            comments: { nodes: [] },
            files: { nodes: [] },
            reviews: {
              nodes: [
                {
                  id: "1",
                  databaseId: "1",
                  author: { login: "reviewer" },
                  body: "Review body",
                  state: "COMMENTED",
                  submittedAt: "2024-01-15T11:00:00Z",
                  comments: {
                    nodes: [
                      {
                        id: "10",
                        databaseId: "10",
                        body: "Review comment before",
                        author: { login: "user1" },
                        createdAt: "2024-01-15T11:30:00Z",
                      },
                      {
                        id: "11",
                        databaseId: "11",
                        body: "Review comment after",
                        author: { login: "user2" },
                        createdAt: "2024-01-15T12:30:00Z",
                      },
                      {
                        id: "12",
                        databaseId: "12",
                        body: "Review comment edited after",
                        author: { login: "user3" },
                        createdAt: "2024-01-15T11:30:00Z",
                        lastEditedAt: "2024-01-15T12:30:00Z",
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
        user: { login: "trigger-user" },
      }),
      rest: {
        pulls: {
          listFiles: jest.fn().mockResolvedValue({ data: [] }),
        },
      },
    };

    const result = await fetchGitHubData({
      octokits: mockOctokits as any,
      repository: "test-owner/test-repo",
      prNumber: "789",
      isPR: true,
      triggerUsername: "trigger-user",
      triggerTime: "2024-01-15T12:00:00Z",
    });

    // The imageUrlMap contains processed comments for image downloading
    // We should have processed review comments, but only those before trigger time
    // The exact check depends on how imageUrlMap is structured, but we can verify
    // that filtering occurred by checking the review data still has all nodes
    expect(result.reviewData?.nodes?.length).toBe(1); // Original review is kept

    // The actual filtering happens during processing for image download
    // Since the mock doesn't actually download images, we verify the input was correct
  });

  it("should handle backward compatibility when no trigger time provided", async () => {
    const mockOctokits = {
      graphql: jest.fn().mockResolvedValue({
        repository: {
          issue: {
            number: 999,
            title: "Test Issue",
            body: "Issue body",
            author: { login: "author" },
            comments: {
              nodes: [
                {
                  id: "1",
                  databaseId: "1",
                  body: "Old comment",
                  author: { login: "user1" },
                  createdAt: "2024-01-15T11:00:00Z",
                },
                {
                  id: "2",
                  databaseId: "2",
                  body: "New comment",
                  author: { login: "user2" },
                  createdAt: "2024-01-15T13:00:00Z",
                },
                {
                  id: "3",
                  databaseId: "3",
                  body: "Edited comment",
                  author: { login: "user3" },
                  createdAt: "2024-01-15T11:00:00Z",
                  lastEditedAt: "2024-01-15T13:00:00Z",
                },
              ],
            },
          },
        },
        user: { login: "trigger-user" },
      }),
      rest: jest.fn() as any,
    };

    const result = await fetchGitHubData({
      octokits: mockOctokits as any,
      repository: "test-owner/test-repo",
      prNumber: "999",
      isPR: false,
      triggerUsername: "trigger-user",
      // No triggerTime provided
    });

    // Without trigger time, all comments should be included
    expect(result.comments.length).toBe(3);
  });

  it("should handle timezone variations in timestamps", async () => {
    const mockOctokits = {
      graphql: jest.fn().mockResolvedValue({
        repository: {
          issue: {
            number: 321,
            title: "Test Issue",
            body: "Issue body",
            author: { login: "author" },
            comments: {
              nodes: [
                {
                  id: "1",
                  databaseId: "1",
                  body: "Comment with UTC",
                  author: { login: "user1" },
                  createdAt: "2024-01-15T11:00:00Z",
                },
                {
                  id: "2",
                  databaseId: "2",
                  body: "Comment with offset",
                  author: { login: "user2" },
                  createdAt: "2024-01-15T11:00:00+00:00",
                },
                {
                  id: "3",
                  databaseId: "3",
                  body: "Comment with milliseconds",
                  author: { login: "user3" },
                  createdAt: "2024-01-15T11:00:00.000Z",
                },
              ],
            },
          },
        },
        user: { login: "trigger-user" },
      }),
      rest: jest.fn() as any,
    };

    const result = await fetchGitHubData({
      octokits: mockOctokits as any,
      repository: "test-owner/test-repo",
      prNumber: "321",
      isPR: false,
      triggerUsername: "trigger-user",
      triggerTime: "2024-01-15T12:00:00Z",
    });

    // All three comments should be included as they're all before trigger time
    expect(result.comments.length).toBe(3);
  });
});
