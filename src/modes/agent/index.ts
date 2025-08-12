import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { Mode, ModeOptions, ModeResult } from "../types";
import type { PreparedContext } from "../../create-prompt/types";

/**
 * Agent mode implementation.
 *
 * This mode runs whenever an explicit prompt is provided in the workflow configuration.
 * It bypasses the standard @claude mention checking and comment tracking used by tag mode,
 * providing direct access to Claude Code for automation workflows.
 */
export const agentMode: Mode = {
  name: "agent",
  description: "Direct automation mode for explicit prompts",

  shouldTrigger(context) {
    // Only trigger when an explicit prompt is provided
    return !!context.inputs?.prompt;
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

  async prepare({ context, githubToken, octokit }: ModeOptions): Promise<ModeResult> {
    // Create prompt directory
    await mkdir(`${process.env.RUNNER_TEMP}/claude-prompts`, {
      recursive: true,
    });
    
    // Write the prompt file - use the user's prompt directly
    const promptContent = context.inputs.prompt || 
      `Repository: ${context.repository.owner}/${context.repository.repo}`;
    
    await writeFile(
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`,
      promptContent,
    );

    const mcpConfig: any = {
      mcpServers: {},
    };

    // Add user-provided additional MCP config if any
    const additionalMcpConfig = process.env.MCP_CONFIG || "";
    if (additionalMcpConfig.trim()) {
      try {
        const additional = JSON.parse(additionalMcpConfig);
        if (additional && typeof additional === "object") {
          // Merge mcpServers if both have them
          if (additional.mcpServers && mcpConfig.mcpServers) {
            Object.assign(mcpConfig.mcpServers, additional.mcpServers);
          } else {
            Object.assign(mcpConfig, additional);
          }
        }
      } catch (error) {
        core.warning(`Failed to parse additional MCP config: ${error}`);
      }
    }

    // Agent mode: pass through user's claude_args with MCP config
    const userClaudeArgs = process.env.CLAUDE_ARGS || "";
    const escapedMcpConfig = JSON.stringify(mcpConfig).replace(/'/g, "'\\''");
    const claudeArgs =
      `--mcp-config '${escapedMcpConfig}' ${userClaudeArgs}`.trim();
    core.setOutput("claude_args", claudeArgs);

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
