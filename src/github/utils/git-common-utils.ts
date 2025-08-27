/**
 * Git Common Utilities
 *
 * This module provides utilities for Git operations using both GitHub API and CLI.
 *
 * ## When to use API vs CLI:
 *
 * ### GitHub API (for signed commits):
 * - When commit signing is enabled (`useCommitSigning: true`)
 * - Required for signed commits as GitHub Apps can't sign commits locally
 * - Functions with "API" in the name use the GitHub REST API
 *
 * ### Git CLI (for unsigned commits):
 * - When commit signing is disabled (`useCommitSigning: false`)
 * - Faster for simple operations when signing isn't required
 * - Uses local git commands (`git add`, `git commit`, `git push`)
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { $ } from "bun";
import { GITHUB_API_URL } from "../api/config";
import { retryWithBackoff } from "../../utils/retry";
import fetch from "node-fetch";

interface FileEntry {
  path: string;
  content?: string;
  deleted?: boolean;
}

interface CommitResult {
  sha: string;
  message: string;
}

interface GitHubRef {
  object: {
    sha: string;
  };
}

interface GitHubCommit {
  tree: {
    sha: string;
  };
}

interface GitHubTree {
  sha: string;
}

interface GitHubNewCommit {
  sha: string;
  message: string;
  author: {
    name: string;
    date: string;
  };
}

async function getUncommittedFiles(): Promise<FileEntry[]> {
  try {
    console.log("Getting uncommitted files...");
    const gitStatus = await $`git status --porcelain`.quiet();
    const statusOutput = gitStatus.stdout.toString().trim();

    if (!statusOutput) {
      console.log("No uncommitted files found (git status output is empty)");
      return [];
    }

    console.log("Git status output:");
    console.log(statusOutput);

    const files: FileEntry[] = [];
    const lines = statusOutput.split("\n");
    console.log(`Found ${lines.length} lines in git status output`);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      // Parse git status output
      // Format: XY filename (e.g., "M  file.txt", "A  new.txt", "?? untracked.txt", "D  deleted.txt")
      const statusCode = trimmedLine.substring(0, 1);
      const filePath = trimmedLine.substring(2).trim();
      console.log(`Processing: status='${statusCode}' path='${filePath}'`);

      // Skip files we shouldn't auto-commit
      if (filePath === "output.txt" || filePath.endsWith("/output.txt")) {
        console.log(`Skipping temporary file: ${filePath}`);
        continue;
      }

      const isDeleted = statusCode.includes("D");
      console.log(`File ${filePath}: deleted=${isDeleted}`);

      files.push({
        path: filePath,
        deleted: isDeleted,
      });
    }

    console.log(`Returning ${files.length} files to commit`);
    return files;
  } catch (error) {
    // If git status fails (e.g., not in a git repo), return empty array
    console.error("Error running git status:", error);
    return [];
  }
}

/**
 * Helper function to get or create branch reference via GitHub API
 * Used when we need to ensure a branch exists before committing via API
 */
async function getOrCreateBranchRefViaAPI(
  owner: string,
  repo: string,
  branch: string,
  githubToken: string,
): Promise<string> {
  // Try to get the branch reference
  const refUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;
  const refResponse = await fetch(refUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (refResponse.ok) {
    const refData = (await refResponse.json()) as GitHubRef;
    return refData.object.sha;
  }

  if (refResponse.status !== 404) {
    throw new Error(`Failed to get branch reference: ${refResponse.status}`);
  }

  const baseBranch = process.env.BASE_BRANCH!;

  // Get the SHA of the base branch
  const baseRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`;
  const baseRefResponse = await fetch(baseRefUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  let baseSha: string;

  if (!baseRefResponse.ok) {
    // If base branch doesn't exist, try default branch
    const repoUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}`;
    const repoResponse = await fetch(repoUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!repoResponse.ok) {
      throw new Error(`Failed to get repository info: ${repoResponse.status}`);
    }

    const repoData = (await repoResponse.json()) as {
      default_branch: string;
    };
    const defaultBranch = repoData.default_branch;

    // Try default branch
    const defaultRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`;
    const defaultRefResponse = await fetch(defaultRefUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!defaultRefResponse.ok) {
      throw new Error(
        `Failed to get default branch reference: ${defaultRefResponse.status}`,
      );
    }

    const defaultRefData = (await defaultRefResponse.json()) as GitHubRef;
    baseSha = defaultRefData.object.sha;
  } else {
    const baseRefData = (await baseRefResponse.json()) as GitHubRef;
    baseSha = baseRefData.object.sha;
  }

  // Create the new branch using the same pattern as octokit
  const createRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs`;
  const createRefResponse = await fetch(createRefUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    }),
  });

  if (!createRefResponse.ok) {
    const errorText = await createRefResponse.text();
    throw new Error(
      `Failed to create branch: ${createRefResponse.status} - ${errorText}`,
    );
  }

  console.log(`Successfully created branch ${branch}`);
  return baseSha;
}

/**
 * Create a commit via GitHub API with the given files (for signed commits)
 * Handles both file updates and deletions
 * Used when commit signing is enabled - GitHub Apps can create signed commits via API
 */
async function createCommitViaAPI(
  owner: string,
  repo: string,
  branch: string,
  files: Array<string | FileEntry>,
  message: string,
  REPO_DIR: string = process.cwd(),
): Promise<CommitResult> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  // Normalize file entries
  const fileEntries: FileEntry[] = files.map((f) => {
    if (typeof f === "string") {
      // Legacy string path format
      const path = f.startsWith("/") ? f.slice(1) : f;
      return { path, deleted: false };
    }
    // Already a FileEntry
    const path = f.path.startsWith("/") ? f.path.slice(1) : f.path;
    return { ...f, path };
  });

  // 1. Get the branch reference (create if doesn't exist)
  const baseSha = await getOrCreateBranchRefViaAPI(
    owner,
    repo,
    branch,
    githubToken,
  );

  // 2. Get the base commit
  const commitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${baseSha}`;
  const commitResponse = await fetch(commitUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!commitResponse.ok) {
    throw new Error(`Failed to get base commit: ${commitResponse.status}`);
  }

  const commitData = (await commitResponse.json()) as GitHubCommit;
  const baseTreeSha = commitData.tree.sha;

  // 3. Create tree entries for all files
  const treeEntries = await Promise.all(
    fileEntries.map(async (fileEntry) => {
      const { path: filePath, deleted } = fileEntry;

      // Handle deleted files by setting SHA to null
      if (deleted) {
        return {
          path: filePath,
          mode: "100644",
          type: "blob" as const,
          sha: null,
        };
      }

      const fullPath = filePath.startsWith("/")
        ? filePath
        : join(REPO_DIR, filePath);

      // Check if file is binary (images, etc.)
      const isBinaryFile =
        /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|exe|bin|woff|woff2|ttf|eot)$/i.test(
          filePath,
        );

      if (isBinaryFile) {
        // For binary files, create a blob first using the Blobs API
        const binaryContent = await readFile(fullPath);

        // Create blob using Blobs API (supports encoding parameter)
        const blobUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs`;
        const blobResponse = await fetch(blobUrl, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: binaryContent.toString("base64"),
            encoding: "base64",
          }),
        });

        if (!blobResponse.ok) {
          const errorText = await blobResponse.text();
          throw new Error(
            `Failed to create blob for ${filePath}: ${blobResponse.status} - ${errorText}`,
          );
        }

        const blobData = (await blobResponse.json()) as { sha: string };

        // Return tree entry with blob SHA
        return {
          path: filePath,
          mode: "100644",
          type: "blob" as const,
          sha: blobData.sha,
        };
      } else {
        // For text files, include content directly in tree
        const content = await readFile(fullPath, "utf-8");
        return {
          path: filePath,
          mode: "100644",
          type: "blob" as const,
          content: content,
        };
      }
    }),
  );

  // 4. Create a new tree
  const treeUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`;
  const treeResponse = await fetch(treeUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });

  if (!treeResponse.ok) {
    const errorText = await treeResponse.text();
    throw new Error(
      `Failed to create tree: ${treeResponse.status} - ${errorText}`,
    );
  }

  const treeData = (await treeResponse.json()) as GitHubTree;

  // 5. Create a new commit
  const newCommitUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`;
  const newCommitResponse = await fetch(newCommitUrl, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: message,
      tree: treeData.sha,
      parents: [baseSha],
    }),
  });

  if (!newCommitResponse.ok) {
    const errorText = await newCommitResponse.text();
    throw new Error(
      `Failed to create commit: ${newCommitResponse.status} - ${errorText}`,
    );
  }

  const newCommitData = (await newCommitResponse.json()) as GitHubNewCommit;

  // 6. Update the reference to point to the new commit
  const updateRefUrl = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`;

  // We're seeing intermittent 403 "Resource not accessible by integration" errors
  // on certain repos when updating git references. These appear to be transient
  // GitHub API issues that succeed on retry.
  await retryWithBackoff(
    async () => {
      const updateRefResponse = await fetch(updateRefUrl, {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false,
        }),
      });

      if (!updateRefResponse.ok) {
        const errorText = await updateRefResponse.text();
        const error = new Error(
          `Failed to update reference: ${updateRefResponse.status} - ${errorText}`,
        );

        // Only retry on 403 errors - these are the intermittent failures we're targeting
        if (updateRefResponse.status === 403) {
          throw error;
        }

        // For non-403 errors, fail immediately without retry
        console.error("Non-retryable error:", updateRefResponse.status);
        throw error;
      }
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000, // Start with 1 second delay
      maxDelayMs: 5000, // Max 5 seconds delay
      backoffFactor: 2, // Double the delay each time
    },
  );

  return {
    sha: newCommitData.sha,
    message: newCommitData.message,
  };
}

/**
 * Commit uncommitted changes - automatically chooses API or CLI based on signing requirement
 *
 * @param useCommitSigning - If true, uses GitHub API for signed commits. If false, uses git CLI.
 */
export async function commitUncommittedChanges(
  owner: string,
  repo: string,
  branch: string,
  useCommitSigning: boolean,
): Promise<CommitResult | null> {
  try {
    // Check for uncommitted changes
    const gitStatus = await $`git status --porcelain`.quiet();
    const hasUncommittedChanges = gitStatus.stdout.toString().trim().length > 0;

    if (!hasUncommittedChanges) {
      console.log("No uncommitted changes found");
      return null;
    }

    console.log("Found uncommitted changes, committing them...");

    const runId = process.env.GITHUB_RUN_ID || "unknown";
    const commitMessage = `Auto-commit: Save uncommitted changes from Claude\n\nRun ID: ${runId}`;

    if (useCommitSigning) {
      // Use GitHub API when commit signing is required
      console.log("Using GitHub API for signed commit...");

      const files = await getUncommittedFiles();

      if (files.length === 0) {
        console.log("No files to commit");
        return null;
      }

      return await createCommitViaAPI(
        owner,
        repo,
        branch,
        files,
        commitMessage,
      );
    } else {
      // Use git CLI when commit signing is not required
      console.log("Using git CLI for unsigned commit...");

      // Add all changes
      await $`git add -A`;

      // Commit with a descriptive message
      await $`git commit -m ${commitMessage}`;

      // Push the changes
      await $`git push origin ${branch}`;

      console.log("✅ Successfully committed and pushed uncommitted changes");

      // Get the commit SHA
      const commitSha = await $`git rev-parse HEAD`.quiet();

      return {
        sha: commitSha.stdout.toString().trim(),
        message: commitMessage,
      };
    }
  } catch (error) {
    // If we can't check git status (e.g., not in a git repo during tests), return null
    console.error("Error checking/committing changes:", error);
    return null;
  }
}
