import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import { prepareMcpConfig } from "../../mcp/install-mcp-server";
import { exportToolEnvironmentVariables } from "../../tools/export";

/**
 * Agent mode implementation.
 *
 * This mode is designed for automation and workflow_dispatch scenarios.
 * It always triggers (no checking), allows highly flexible configurations,
 * and works well with override_prompt for custom workflows.
 *
 * In the future, this mode could restrict certain tools for safety in automation contexts,
 * e.g., disallowing WebSearch or limiting file system operations.
 */
export const agentMode: Mode = {
  name: "agent",
  description: "Automation mode that always runs without trigger checking",

  shouldTrigger() {
    return true;
  },

  prepareContext(context, data) {
    return {
      mode: "agent",
      githubContext: context,
      commentId: data?.commentId,
      baseBranch: data?.baseBranch,
      claudeBranch: data?.claudeBranch,
    };
  },

  getAllowedTools() {
    return [];
  },

  getDisallowedTools() {
    return [];
  },

  shouldCreateTrackingComment() {
    return false;
  },

  async prepare({ context, githubToken }: ModeOptions): Promise<ModeResult> {
    // Agent mode is designed for automation events (workflow_dispatch, schedule)
    // and potentially other events where we want full automation without tracking

    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });

    // Write the prompt - either override_prompt, direct_prompt, or a minimal default
    const promptContent =
      context.inputs.overridePrompt ||
      context.inputs.directPrompt ||
      `Repository: ${context.repository.owner}/${context.repository.repo}`;

    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );

    // Export tool environment variables
    exportToolEnvironmentVariables(agentMode, context);

    // Get MCP configuration
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    const mcpConfig = await prepareMcpConfig({
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: "", // No specific branch for agent mode
      baseBranch: "", // No base branch needed
      additionalMcpConfig,
      claudeCommentId: "",
      allowedTools: context.inputs.allowedTools,
      context,
    });

    core.setOutput("mcp_config", mcpConfig);

    return {
      commentId: undefined,
      branchInfo: {
        baseBranch: "",
        currentBranch: "",
        claudeBranch: undefined,
      },
      mcpConfig,
    };
  },
};
