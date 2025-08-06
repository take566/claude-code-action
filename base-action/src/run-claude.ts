import * as core from "@actions/core";
import { exec } from "child_process";
import { promisify } from "util";
import { unlink, writeFile, stat } from "fs/promises";
import { createWriteStream } from "fs";
import { spawn } from "child_process";
import { StreamHandler } from "./stream-handler";

const execAsync = promisify(exec);

const PIPE_PATH = `${process.env.RUNNER_TEMP}/claude_prompt_pipe`;
const EXECUTION_FILE = `${process.env.RUNNER_TEMP}/claude-execution-output.json`;
const BASE_ARGS = ["-p", "--verbose", "--output-format", "stream-json"];

export type ClaudeOptions = {
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  mcpConfig?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  claudeEnv?: string;
  fallbackModel?: string;
  timeoutMinutes?: string;
  streamConfig?: string;
};

export type StreamConfig = {
  progress_endpoint?: string;
  headers?: Record<string, string>;
  resume_endpoint?: string;
  session_id?: string;
};

type PreparedConfig = {
  claudeArgs: string[];
  promptPath: string;
  env: Record<string, string>;
};

function parseCustomEnvVars(claudeEnv?: string): Record<string, string> {
  if (!claudeEnv || claudeEnv.trim() === "") {
    return {};
  }

  const customEnv: Record<string, string> = {};

  // Split by lines and parse each line as KEY: VALUE
  const lines = claudeEnv.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("#")) {
      continue; // Skip empty lines and comments
    }

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) {
      continue; // Skip lines without colons
    }

    const key = trimmedLine.substring(0, colonIndex).trim();
    const value = trimmedLine.substring(colonIndex + 1).trim();

    if (key) {
      customEnv[key] = value;
    }
  }

  return customEnv;
}

export function prepareRunConfig(
  promptPath: string,
  options: ClaudeOptions,
): PreparedConfig {
  const claudeArgs = [...BASE_ARGS];

  if (options.allowedTools) {
    claudeArgs.push("--allowedTools", options.allowedTools);
  }
  if (options.disallowedTools) {
    claudeArgs.push("--disallowedTools", options.disallowedTools);
  }
  if (options.maxTurns) {
    const maxTurnsNum = parseInt(options.maxTurns, 10);
    if (isNaN(maxTurnsNum) || maxTurnsNum <= 0) {
      throw new Error(
        `maxTurns must be a positive number, got: ${options.maxTurns}`,
      );
    }
    claudeArgs.push("--max-turns", options.maxTurns);
  }
  if (options.mcpConfig) {
    claudeArgs.push("--mcp-config", options.mcpConfig);
  }
  if (options.systemPrompt) {
    claudeArgs.push("--system-prompt", options.systemPrompt);
  }
  if (options.appendSystemPrompt) {
    claudeArgs.push("--append-system-prompt", options.appendSystemPrompt);
  }
  if (options.fallbackModel) {
    claudeArgs.push("--fallback-model", options.fallbackModel);
  }
  if (options.timeoutMinutes) {
    const timeoutMinutesNum = parseInt(options.timeoutMinutes, 10);
    if (isNaN(timeoutMinutesNum) || timeoutMinutesNum <= 0) {
      throw new Error(
        `timeoutMinutes must be a positive number, got: ${options.timeoutMinutes}`,
      );
    }
  }
  // Parse stream config for session_id and resume_endpoint
  if (options.streamConfig) {
    try {
      const streamConfig: StreamConfig = JSON.parse(options.streamConfig);
      // Add --session-id if session_id is provided
      if (streamConfig.session_id) {
        claudeArgs.push("--session-id", streamConfig.session_id);
      }
      // Only add --teleport if we have both session_id AND resume_endpoint
      if (streamConfig.session_id && streamConfig.resume_endpoint) {
        claudeArgs.push("--teleport", streamConfig.session_id);
      }
    } catch (e) {
      console.error("Failed to parse stream_config JSON:", e);
    }
  }

  // Parse custom environment variables
  const customEnv = parseCustomEnvVars(options.claudeEnv);

  return {
    claudeArgs,
    promptPath,
    env: customEnv,
  };
}

export async function runClaude(promptPath: string, options: ClaudeOptions) {
  const config = prepareRunConfig(promptPath, options);

  // Set up streaming if endpoint is provided in stream config
  let streamHandler: StreamHandler | null = null;
  let streamConfig: StreamConfig | null = null;
  if (options.streamConfig) {
    try {
      streamConfig = JSON.parse(options.streamConfig);
      if (streamConfig?.progress_endpoint) {
        const customHeaders = streamConfig.headers || {};
        console.log("parsed headers", customHeaders);
        Object.keys(customHeaders).forEach((key) => {
          console.log(`Custom header: ${key} = ${customHeaders[key]}`);
        });
        streamHandler = new StreamHandler(
          streamConfig.progress_endpoint,
          customHeaders,
        );
        console.log(`Streaming output to: ${streamConfig.progress_endpoint}`);
        if (Object.keys(customHeaders).length > 0) {
          console.log(
            `Custom streaming headers: ${Object.keys(customHeaders).join(", ")}`,
          );
        }
      }
    } catch (e) {
      console.error("Failed to parse stream_config JSON:", e);
    }
  }

  // Create a named pipe
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore if file doesn't exist
  }

  // Create the named pipe
  await execAsync(`mkfifo "${PIPE_PATH}"`);

  // Log prompt file size
  let promptSize = "unknown";
  try {
    const stats = await stat(config.promptPath);
    promptSize = stats.size.toString();
  } catch (e) {
    // Ignore error
  }

  console.log(`Prompt file size: ${promptSize} bytes`);

  // Log custom environment variables if any
  if (Object.keys(config.env).length > 0) {
    const envKeys = Object.keys(config.env).join(", ");
    console.log(`Custom environment variables: ${envKeys}`);
  }

  // Output to console
  console.log(`Running Claude with prompt from file: ${config.promptPath}`);

  // Start sending prompt to pipe in background
  const catProcess = spawn("cat", [config.promptPath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pipeStream = createWriteStream(PIPE_PATH);
  catProcess.stdout.pipe(pipeStream);

  catProcess.on("error", (error) => {
    console.error("Error reading prompt file:", error);
    pipeStream.destroy();
  });

  // Prepare environment variables
  const processEnv = {
    ...process.env,
    ...config.env,
  };

  // If both session_id and resume_endpoint are provided, set environment variables
  if (streamConfig?.session_id && streamConfig?.resume_endpoint) {
    processEnv.TELEPORT_RESUME_URL = streamConfig.resume_endpoint;
    console.log(
      `Setting TELEPORT_RESUME_URL to: ${streamConfig.resume_endpoint}`,
    );

    if (streamConfig.headers && Object.keys(streamConfig.headers).length > 0) {
      processEnv.TELEPORT_HEADERS = JSON.stringify(streamConfig.headers);
      console.log(`Setting TELEPORT_HEADERS for resume endpoint`);
    }
  }

  // Log the full Claude command being executed
  console.log(`Running Claude with args: ${config.claudeArgs.join(" ")}`);

  const claudeProcess = spawn("claude", config.claudeArgs, {
    stdio: ["pipe", "pipe", "inherit"],
    env: processEnv,
  });

  // Handle Claude process errors
  claudeProcess.on("error", (error) => {
    console.error("Error spawning Claude process:", error);
    pipeStream.destroy();
  });

  // Capture output for parsing execution metrics
  let output = "";
  let lineBuffer = ""; // Buffer for incomplete lines

  claudeProcess.stdout.on("data", async (data) => {
    const text = data.toString();
    output += text;

    // Add new data to line buffer
    lineBuffer += text;

    // Split into lines - the last element might be incomplete
    const lines = lineBuffer.split("\n");

    // The last element is either empty (if text ended with \n) or incomplete
    lineBuffer = lines.pop() || "";

    // Process complete lines
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line || line.trim() === "") continue;

      // Try to parse as JSON and pretty print if it's on a single line
      try {
        // Check if this line is a JSON object
        const parsed = JSON.parse(line);
        const prettyJson = JSON.stringify(parsed, null, 2);
        process.stdout.write(prettyJson);
        process.stdout.write("\n");

        // Send valid JSON to stream handler if available
        if (streamHandler) {
          try {
            // Send the original line (which is valid JSON) with newline for proper splitting
            const dataToSend = line + "\n";
            await streamHandler.addOutput(dataToSend);
          } catch (error) {
            core.warning(`Failed to stream output: ${error}`);
          }
        }
      } catch (e) {
        // Not a JSON object, print as is
        process.stdout.write(line);
        process.stdout.write("\n");
        // Don't send non-JSON lines to stream handler
      }
    }
  });

  // Handle stdout errors
  claudeProcess.stdout.on("error", (error) => {
    console.error("Error reading Claude stdout:", error);
  });

  // Pipe from named pipe to Claude
  const pipeProcess = spawn("cat", [PIPE_PATH]);
  pipeProcess.stdout.pipe(claudeProcess.stdin);

  // Handle pipe process errors
  pipeProcess.on("error", (error) => {
    console.error("Error reading from named pipe:", error);
    claudeProcess.kill("SIGTERM");
  });

  // Wait for Claude to finish with timeout
  let timeoutMs = 10 * 60 * 1000; // Default 10 minutes
  if (options.timeoutMinutes) {
    timeoutMs = parseInt(options.timeoutMinutes, 10) * 60 * 1000;
  } else if (process.env.INPUT_TIMEOUT_MINUTES) {
    const envTimeout = parseInt(process.env.INPUT_TIMEOUT_MINUTES, 10);
    if (isNaN(envTimeout) || envTimeout <= 0) {
      throw new Error(
        `INPUT_TIMEOUT_MINUTES must be a positive number, got: ${process.env.INPUT_TIMEOUT_MINUTES}`,
      );
    }
    timeoutMs = envTimeout * 60 * 1000;
  }
  const exitCode = await new Promise<number>((resolve) => {
    let resolved = false;

    // Set a timeout for the process
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        console.error(
          `Claude process timed out after ${timeoutMs / 1000} seconds`,
        );
        claudeProcess.kill("SIGTERM");
        // Give it 5 seconds to terminate gracefully, then force kill
        setTimeout(() => {
          try {
            claudeProcess.kill("SIGKILL");
          } catch (e) {
            // Process may already be dead
          }
        }, 5000);
        resolved = true;
        resolve(124); // Standard timeout exit code
      }
    }, timeoutMs);

    claudeProcess.on("close", async (code) => {
      if (!resolved) {
        // Process any remaining data in the line buffer
        if (lineBuffer.trim()) {
          // Try to parse and print the remaining line
          try {
            const parsed = JSON.parse(lineBuffer);
            const prettyJson = JSON.stringify(parsed, null, 2);
            process.stdout.write(prettyJson);
            process.stdout.write("\n");

            // Send valid JSON to stream handler if available
            if (streamHandler) {
              try {
                const dataToSend = lineBuffer + "\n";
                await streamHandler.addOutput(dataToSend);
              } catch (error) {
                core.warning(`Failed to stream final output: ${error}`);
              }
            }
          } catch (e) {
            process.stdout.write(lineBuffer);
            process.stdout.write("\n");
            // Don't send non-JSON lines to stream handler
          }
        }

        clearTimeout(timeoutId);
        resolved = true;
        resolve(code || 0);
      }
    });

    claudeProcess.on("error", (error) => {
      if (!resolved) {
        console.error("Claude process error:", error);
        clearTimeout(timeoutId);
        resolved = true;
        resolve(1);
      }
    });
  });

  // Clean up streaming
  if (streamHandler) {
    try {
      await streamHandler.close();
    } catch (error) {
      core.warning(`Failed to close stream handler: ${error}`);
    }
  }

  // Clean up processes
  try {
    catProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }
  try {
    pipeProcess.kill("SIGTERM");
  } catch (e) {
    // Process may already be dead
  }

  // Clean up pipe file
  try {
    await unlink(PIPE_PATH);
  } catch (e) {
    // Ignore errors during cleanup
  }

  // Set conclusion based on exit code
  if (exitCode === 0) {
    // Try to process the output and save execution metrics
    try {
      await writeFile("output.txt", output);

      // Process output.txt into JSON and save to execution file
      const { stdout: jsonOutput } = await execAsync("jq -s '.' output.txt");
      await writeFile(EXECUTION_FILE, jsonOutput);

      console.log(`Log saved to ${EXECUTION_FILE}`);
    } catch (e) {
      core.warning(`Failed to process output for execution metrics: ${e}`);
    }

    core.setOutput("conclusion", "success");
    core.setOutput("execution_file", EXECUTION_FILE);
  } else {
    core.setOutput("conclusion", "failure");

    // Still try to save execution file if we have output
    if (output) {
      try {
        await writeFile("output.txt", output);
        const { stdout: jsonOutput } = await execAsync("jq -s '.' output.txt");
        await writeFile(EXECUTION_FILE, jsonOutput);
        core.setOutput("execution_file", EXECUTION_FILE);
      } catch (e) {
        // Ignore errors when processing output during failure
      }
    }

    process.exit(exitCode);
  }
}
