#!/usr/bin/env bun

import * as core from "@actions/core";
import { reportClaudeComplete } from "../modes/remote-agent/system-progress-handler";
import type { SystemProgressConfig } from "../modes/remote-agent/progress-types";
import type { StreamConfig } from "../types/stream-config";

async function run() {
  try {
    // Only run if we're in remote-agent mode
    const mode = process.env.MODE;
    if (mode !== "remote-agent") {
      console.log(
        "Not in remote-agent mode, skipping Claude completion reporting",
      );
      return;
    }

    // Check if we have stream config with system progress endpoint
    const streamConfigStr = process.env.STREAM_CONFIG;
    if (!streamConfigStr) {
      console.log(
        "No stream config available, skipping Claude completion reporting",
      );
      return;
    }

    let streamConfig: StreamConfig;
    try {
      streamConfig = JSON.parse(streamConfigStr);
    } catch (e) {
      console.error("Failed to parse stream config:", e);
      return;
    }

    if (!streamConfig.system_progress_endpoint) {
      console.log(
        "No system progress endpoint in stream config, skipping Claude completion reporting",
      );
      return;
    }

    // Extract the system progress config
    const systemProgressConfig: SystemProgressConfig = {
      endpoint: streamConfig.system_progress_endpoint,
      headers: streamConfig.headers || {},
    };

    // Get the OIDC token from Authorization header
    const authHeader = systemProgressConfig.headers?.["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("No valid Authorization header in stream config");
      return;
    }
    const oidcToken = authHeader.substring(7); // Remove "Bearer " prefix

    // Get Claude execution status
    const claudeConclusion = process.env.CLAUDE_CONCLUSION || "failure";
    const exitCode = claudeConclusion === "success" ? 0 : 1;

    // Calculate duration if possible
    const startTime = process.env.CLAUDE_START_TIME;
    let durationMs = 0;
    if (startTime) {
      durationMs = Date.now() - parseInt(startTime, 10);
    }

    // Report Claude completion
    console.log(
      `Reporting Claude completion: exitCode=${exitCode}, duration=${durationMs}ms`,
    );
    reportClaudeComplete(systemProgressConfig, oidcToken, exitCode, durationMs);
  } catch (error) {
    // Don't fail the action if reporting fails
    core.warning(`Failed to report Claude completion: ${error}`);
  }
}

if (import.meta.main) {
  run();
}
