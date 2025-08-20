#!/usr/bin/env node
// GitHub File Operations MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { join } from "path";
import { constants } from "fs";
import fetch from "node-fetch";
import { GITHUB_API_URL } from "../github/api/config";
import { retryWithBackoff } from "../utils/retry";

type GitHubRef = {
  object: {
    sha: string;
  };
};

type GitHubCommit = {
  tree: {
    sha: string;
  };
};

type GitHubTree = {
  sha: string;
};

type GitHubNewCommit = {
  sha: string;
  message: string;
  author: {
    name: string;
    date: string;
  };
};

// Get repository information from environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const BRANCH_NAME = process.env.BRANCH_NAME;
const REPO_DIR = process.env.REPO_DIR || process.cwd();

if (!REPO_OWNER || !REPO_NAME || !BRANCH_NAME) {
  console.error(
    "Error: REPO_OWNER, REPO_NAME, and BRANCH_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitHub File Operations Server",
  version: "0.0.1",
});

// Helper function to get or create branch reference
async function getOrCreateBranchRef(
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

// Get the appropriate Git file mode for a file
async function getFileMode(filePath: string): Promise<string> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) {
      // Check if execute bit is set for user
      if (fileStat.mode & constants.S_IXUSR) {
        return "100755"; // Executable file
      } else {
        return "100644"; // Regular file
      }
    } else if (fileStat.isDirectory()) {
      return "040000"; // Directory (tree)
    } else if (fileStat.isSymbolicLink()) {
      return "120000"; // Symbolic link
    } else {
      // Fallback for unknown file types
      return "100644";
    }
  } catch (error) {
    // If we can't stat the file, default to regular file
    console.warn(
      `Could not determine file mode for ${filePath}, using default: ${error}`,
    );
    return "100644";
  }
}

// Commit files tool
server.tool(
  "commit_files",
  "Commit one or more files to a repository in a single commit (this will commit them atomically in the remote repository)",
  {
    files: z
      .array(z.string())
      .describe(
        'Array of file paths relative to repository root (e.g. ["src/main.js", "README.md"]). All files must exist locally.',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ files, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      const processedFiles = files.map((filePath) => {
        if (filePath.startsWith("/")) {
          return filePath.slice(1);
        }
        return filePath;
      });

      // 1. Get the branch reference (create if doesn't exist)
      const baseSha = await getOrCreateBranchRef(
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
        processedFiles.map(async (filePath) => {
          const fullPath = filePath.startsWith("/")
            ? filePath
            : join(REPO_DIR, filePath);

          // Get the proper file mode based on file permissions
          const fileMode = await getFileMode(fullPath);

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
              mode: fileMode,
              type: "blob",
              sha: blobData.sha,
            };
          } else {
            // For text files, include content directly in tree
            const content = await readFile(fullPath, "utf-8");
            return {
              path: filePath,
              mode: fileMode,
              type: "blob",
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
      let lastErrorDetails: any = null;
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
            let errorJson: any = {};
            try {
              errorJson = JSON.parse(errorText);
            } catch {
              // If not JSON, use the text as-is
            }

            // Collect debugging information
            const debugInfo = {
              status: updateRefResponse.status,
              statusText: updateRefResponse.statusText,
              headers: Object.fromEntries(updateRefResponse.headers.entries()),
              errorBody: errorJson || errorText,
              context: {
                repository: `${owner}/${repo}`,
                branch: branch,
                baseBranch: process.env.BASE_BRANCH,
                targetSha: newCommitData.sha,
                parentSha: baseSha,
                isGitHubAction: !!process.env.GITHUB_ACTIONS,
                eventName: process.env.GITHUB_EVENT_NAME,
                isPR: process.env.IS_PR,
                tokenLength: githubToken?.length || 0,
                tokenPrefix: githubToken?.substring(0, 10) + "...",
                apiUrl: updateRefUrl,
              },
            };

            lastErrorDetails = debugInfo;

            const error = new Error(
              `Failed to update reference: ${updateRefResponse.status} - ${errorText}\n\nDebug Info: ${JSON.stringify(debugInfo, null, 2)}`,
            );

            // Only retry on 403 errors - these are the intermittent failures we're targeting
            if (updateRefResponse.status === 403) {
              console.error("403 Error encountered (will retry):", debugInfo);
              throw error;
            }

            // For non-403 errors, fail immediately without retry
            console.error("Non-retryable error:", debugInfo);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000, // Start with 1 second delay
          maxDelayMs: 5000, // Max 5 seconds delay
          backoffFactor: 2, // Double the delay each time
        },
      ).catch((error) => {
        // If all retries failed, enhance the error message with collected details
        if (lastErrorDetails) {
          throw new Error(
            `All retry attempts failed for ref update.\n\n` +
              `Final error: ${error.message}\n\n` +
              `Debugging hints:\n` +
              `- Check if branch '${branch}' is protected and the GitHub App has bypass permissions\n` +
              `- Verify the token has 'contents:write' permission for ${owner}/${repo}\n` +
              `- Check for concurrent operations updating the same branch\n` +
              `- Token appears to be: ${lastErrorDetails.context.tokenPrefix}\n` +
              `- This may be a transient GitHub API issue if it works on retry\n\n` +
              `Full debug details: ${JSON.stringify(lastErrorDetails, null, 2)}`,
          );
        }
        throw error;
      });

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        files: processedFiles.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

// Delete files tool
server.tool(
  "delete_files",
  "Delete one or more files from a repository in a single commit",
  {
    paths: z
      .array(z.string())
      .describe(
        'Array of file paths to delete relative to repository root (e.g. ["src/old-file.js", "docs/deprecated.md"])',
      ),
    message: z.string().describe("Commit message"),
  },
  async ({ paths, message }) => {
    const owner = REPO_OWNER;
    const repo = REPO_NAME;
    const branch = BRANCH_NAME;
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }

      // Convert absolute paths to relative if they match CWD
      const cwd = process.cwd();
      const processedPaths = paths.map((filePath) => {
        if (filePath.startsWith("/")) {
          if (filePath.startsWith(cwd)) {
            // Strip CWD from absolute path
            return filePath.slice(cwd.length + 1);
          } else {
            throw new Error(
              `Path '${filePath}' must be relative to repository root or within current working directory`,
            );
          }
        }
        return filePath;
      });

      // 1. Get the branch reference (create if doesn't exist)
      const baseSha = await getOrCreateBranchRef(
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

      // 3. Create tree entries for file deletions (setting SHA to null)
      const treeEntries = processedPaths.map((path) => ({
        path: path,
        mode: "100644",
        type: "blob" as const,
        sha: null,
      }));

      // 4. Create a new tree with deletions
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
      let lastErrorDetails: any = null;
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
            let errorJson: any = {};
            try {
              errorJson = JSON.parse(errorText);
            } catch {
              // If not JSON, use the text as-is
            }

            // Collect debugging information
            const debugInfo = {
              status: updateRefResponse.status,
              statusText: updateRefResponse.statusText,
              headers: Object.fromEntries(updateRefResponse.headers.entries()),
              errorBody: errorJson || errorText,
              context: {
                operation: "delete_files",
                repository: `${owner}/${repo}`,
                branch: branch,
                baseBranch: process.env.BASE_BRANCH,
                targetSha: newCommitData.sha,
                parentSha: baseSha,
                isGitHubAction: !!process.env.GITHUB_ACTIONS,
                eventName: process.env.GITHUB_EVENT_NAME,
                isPR: process.env.IS_PR,
                tokenLength: githubToken?.length || 0,
                tokenPrefix: githubToken?.substring(0, 10) + "...",
                apiUrl: updateRefUrl,
              },
            };

            lastErrorDetails = debugInfo;

            const error = new Error(
              `Failed to update reference: ${updateRefResponse.status} - ${errorText}\n\nDebug Info: ${JSON.stringify(debugInfo, null, 2)}`,
            );

            // Only retry on 403 errors - these are the intermittent failures we're targeting
            if (updateRefResponse.status === 403) {
              console.error(
                "403 Error encountered during delete (will retry):",
                debugInfo,
              );
              throw error;
            }

            // For non-403 errors, fail immediately without retry
            console.error("Non-retryable error during delete:", debugInfo);
            throw error;
          }
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1000, // Start with 1 second delay
          maxDelayMs: 5000, // Max 5 seconds delay
          backoffFactor: 2, // Double the delay each time
        },
      ).catch((error) => {
        // If all retries failed, enhance the error message with collected details
        if (lastErrorDetails) {
          throw new Error(
            `All retry attempts failed for ref update during file deletion.\n\n` +
              `Final error: ${error.message}\n\n` +
              `Debugging hints:\n` +
              `- Check if branch '${branch}' is protected and the GitHub App has bypass permissions\n` +
              `- Verify the token has 'contents:write' permission for ${owner}/${repo}\n` +
              `- Check for concurrent operations updating the same branch\n` +
              `- Token appears to be: ${lastErrorDetails.context.tokenPrefix}\n` +
              `- This may be a transient GitHub API issue if it works on retry\n\n` +
              `Full debug details: ${JSON.stringify(lastErrorDetails, null, 2)}`,
          );
        }
        throw error;
      });

      const simplifiedResult = {
        commit: {
          sha: newCommitData.sha,
          message: newCommitData.message,
          author: newCommitData.author.name,
          date: newCommitData.author.date,
        },
        deletedFiles: processedPaths.map((path) => ({ path })),
        tree: {
          sha: treeData.sha,
        },
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(simplifiedResult, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
