import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import { isAutomationContext } from "../../github/context";
import type { PreparedContext } from "../../create-prompt/types";

/**
 * Agent mode implementation.
 *
 * This mode is specifically designed for automation events (workflow_dispatch and schedule).
 * It bypasses the standard trigger checking and comment tracking used by tag mode,
 * making it ideal for scheduled tasks and manual workflow runs.
 */
export const agentMode: Mode = {
  name: "agent",
  description: "Automation mode for workflow_dispatch and schedule events",

  shouldTrigger(context) {
    // Only trigger for automation events
    return isAutomationContext(context);
  },

  prepareContext(context) {
    // Agent mode doesn't use comment tracking or branch management
    return {
      mode: "agent",
      githubContext: context,
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

  async prepare({ context }: ModeOptions): Promise<ModeResult> {
    // Agent mode handles automation events (workflow_dispatch, schedule) only

    // TODO: handle by createPrompt (similar to tag and review modes)
    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });
    // Write the prompt file - the base action requires a prompt_file parameter.
    // Use the unified prompt field from v1.0.
    const promptContent =
      context.inputs.prompt ||
      `Repository: ${context.repository.owner}/${context.repository.repo}`;
    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );

    // Agent mode: User has full control via claudeArgs or legacy inputs
    // No default tools are enforced - Claude Code's defaults will apply
    // Export user-specified tools only if provided
    if (context.inputs.allowedTools.length > 0) {
      core.exportVariable(
        "INPUT_ALLOWED_TOOLS",
        context.inputs.allowedTools.join(","),
      );
    }
    if (context.inputs.disallowedTools.length > 0) {
      core.exportVariable(
        "INPUT_DISALLOWED_TOOLS",
        context.inputs.disallowedTools.join(","),
      );
    }

    // Agent mode uses a minimal MCP configuration
    // We don't need comment servers or PR-specific tools for automation
    const mcpConfig: any = {
      mcpServers: {},
    };

    // Add user-provided additional MCP config if any
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    if (additionalMcpConfig.trim()) {
      try {
        const additional = JSON.parse(additionalMcpConfig);
        if (additional && typeof additional === "object") {
          Object.assign(mcpConfig, additional);
        }
      } catch (error) {
        core.warning(`Failed to parse additional MCP config: ${error}`);
      }
    }

    core.setOutput("mcp_config", JSON.stringify(mcpConfig));

    return {
      commentId: undefined,
      branchInfo: {
        baseBranch: "",
        currentBranch: "",
        claudeBranch: undefined,
      },
      mcpConfig: JSON.stringify(mcpConfig),
    };
  },

  generatePrompt(context: PreparedContext): string {
    // Agent mode uses prompt field
    if (context.prompt) {
      return context.prompt;
    }

    // Minimal fallback - repository is a string in PreparedContext
    return `Repository: ${context.repository}`;
  },

  getSystemPrompt() {
    // Agent mode doesn't need additional system prompts
    return undefined;
  },
};
