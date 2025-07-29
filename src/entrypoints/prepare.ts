#!/usr/bin/env bun

/**
 * Prepare the Claude action by checking trigger conditions, verifying human actor,
 * and creating the initial tracking comment
 */

import * as core from "@actions/core";
import { setupGitHubToken } from "../github/token";
import { checkWritePermissions } from "../github/validation/permissions";
import { createOctokit } from "../github/api/client";
import { parseGitHubContext } from "../github/context";
import { getMode } from "../modes/registry";
import { prepare } from "../prepare";

async function run() {
  try {
    // Step 1: Setup GitHub token
    const githubToken = await setupGitHubToken();
    const octokit = createOctokit(githubToken);

    // Step 2: Parse GitHub context (once for all operations)
    const context = parseGitHubContext();

    // Step 3: Check write permissions
    const hasWritePermissions = await checkWritePermissions(
      octokit.rest,
      context,
    );
    if (!hasWritePermissions) {
      throw new Error(
        "Actor does not have write permissions to the repository",
      );
    }

    // Step 4: Get mode and check trigger conditions
    const mode = getMode(context.inputs.mode, context);
    const containsTrigger = mode.shouldTrigger(context);

    // Set output for action.yml to check
    core.setOutput("contains_trigger", containsTrigger.toString());

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      return;
    }

    // Step 5: Use the new modular prepare function
    const result = await prepare({
      context,
      octokit,
      mode,
      githubToken,
    });

    // Set the MCP config output
    core.setOutput("mcp_config", result.mcpConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Prepare step failed with error: ${errorMessage}`);
    // Also output the clean error message for the action to capture
    core.setOutput("prepare_error", errorMessage);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}
