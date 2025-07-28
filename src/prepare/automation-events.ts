/**
 * Prepare logic for automation events (workflow_dispatch, schedule)
 * These events don't have associated GitHub entities and require minimal setup
 */

import * as core from "@actions/core";
import { prepareMcpConfig } from "../mcp/install-mcp-server";
import { createPrompt } from "../create-prompt";
import { getDefaultBranch } from "../github/operations/default-branch";
import type { PrepareOptions, PrepareResult } from "./types";

export async function prepareAutomationEvent({
  context,
  octokit,
  mode,
  githubToken,
}: PrepareOptions): Promise<PrepareResult> {
  // For automation events, we skip:
  // - Human actor check (it's automation)
  // - Tracking comment (no issue/PR to comment on)
  // - GitHub data fetching (no entity to fetch)
  // - Branch setup (use default branch or current branch)

  // Get the default branch or use the one specified in inputs
  const baseBranch =
    context.inputs.baseBranch ||
    (await getDefaultBranch(
      octokit.rest,
      context.repository.owner,
      context.repository.repo,
    ));

  // For automation events, we stay on the current branch (typically main/master)
  const branchInfo = {
    baseBranch,
    currentBranch: baseBranch,
    claudeBranch: undefined,
  };

  // Create prompt file with minimal context
  const modeContext = mode.prepareContext(context, {
    baseBranch: branchInfo.baseBranch,
    claudeBranch: branchInfo.claudeBranch,
  });

  // Pass null for githubData since automation events don't have associated entities
  await createPrompt(mode, modeContext, null, context);

  // Get MCP configuration
  const additionalMcpConfig = process.env.MCP_CONFIG || "";
  const mcpConfig = await prepareMcpConfig({
    githubToken,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: branchInfo.currentBranch,
    baseBranch: branchInfo.baseBranch,
    additionalMcpConfig,
    claudeCommentId: "",
    allowedTools: context.inputs.allowedTools,
    context,
  });

  core.setOutput("mcp_config", mcpConfig);

  return {
    commentId: undefined,
    branchInfo,
    mcpConfig,
  };
}
