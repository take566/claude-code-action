/**
 * Prepare logic for entity-based events (issues, PRs, comments)
 * These events have associated GitHub entities that need to be fetched and managed
 */

import * as core from "@actions/core";
import { checkHumanActor } from "../github/validation/actor";
import { createInitialComment } from "../github/operations/comments/create-initial";
import { setupBranch } from "../github/operations/branch";
import { configureGitAuth } from "../github/operations/git-config";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { fetchGitHubData } from "../github/data/fetcher";
import { createPrompt } from "../create-prompt";
import type { PrepareOptions, PrepareResult } from "./types";

export async function prepareEntityEvent({
  context,
  octokit,
  mode,
  githubToken,
}: PrepareOptions): Promise<PrepareResult> {
  // Check if actor is human
  await checkHumanActor(octokit.rest, context);

  // Create initial tracking comment (mode-aware)
  let commentId: number | undefined;
  let commentData: Awaited<ReturnType<typeof createInitialComment>> | undefined;
  if (mode.shouldCreateTrackingComment()) {
    commentData = await createInitialComment(octokit.rest, context);
    commentId = commentData.id;
  }

  // Fetch GitHub data - entity events always have entityNumber and isPR
  if (!context.entityNumber || context.isPR === undefined) {
    throw new Error("Entity events must have entityNumber and isPR defined");
  }

  const githubData = await fetchGitHubData({
    octokits: octokit,
    repository: `${context.repository.owner}/${context.repository.repo}`,
    prNumber: context.entityNumber.toString(),
    isPR: context.isPR,
    triggerUsername: context.actor,
  });

  // Setup branch
  const branchInfo = await setupBranch(octokit, githubData, context);

  // Configure git authentication if not using commit signing
  if (!context.inputs.useCommitSigning) {
    try {
      await configureGitAuth(githubToken, context, commentData?.user || null);
    } catch (error) {
      console.error("Failed to configure git authentication:", error);
      throw error;
    }
  }

  // Create prompt file
  const modeContext = mode.prepareContext(context, {
    commentId,
    baseBranch: branchInfo.baseBranch,
    claudeBranch: branchInfo.claudeBranch,
  });

  await createPrompt(mode, modeContext, githubData, context);

  // Get MCP configuration
  const additionalMcpConfig = process.env.MCP_CONFIG || "";
  const mcpConfig = await prepareMcpConfig({
    githubToken,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: branchInfo.claudeBranch || branchInfo.currentBranch,
    baseBranch: branchInfo.baseBranch,
    additionalMcpConfig,
    claudeCommentId: commentId?.toString() || "",
    allowedTools: context.inputs.allowedTools,
    context,
  });

  core.setOutput("mcp_config", mcpConfig);

  return {
    commentId,
    branchInfo,
    mcpConfig,
  };
}
