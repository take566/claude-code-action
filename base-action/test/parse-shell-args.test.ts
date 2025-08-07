import { describe, expect, test } from "bun:test";

// Import the function directly from run-claude.ts for testing
// We'll need to export it first
function parseShellArgs(argsString?: string): string[] {
  if (!argsString || argsString.trim() === "") {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      if (inSingleQuote) {
        current += char;
      } else {
        escapeNext = true;
      }
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

describe("parseShellArgs", () => {
  test("should handle empty input", () => {
    expect(parseShellArgs("")).toEqual([]);
    expect(parseShellArgs(undefined)).toEqual([]);
    expect(parseShellArgs("   ")).toEqual([]);
  });

  test("should parse simple arguments", () => {
    expect(parseShellArgs("--max-turns 3")).toEqual(["--max-turns", "3"]);
    expect(parseShellArgs("-a -b -c")).toEqual(["-a", "-b", "-c"]);
  });

  test("should handle double quotes", () => {
    expect(parseShellArgs('--config "/path/to/config.json"')).toEqual([
      "--config",
      "/path/to/config.json",
    ]);
    expect(parseShellArgs('"arg with spaces"')).toEqual(["arg with spaces"]);
  });

  test("should handle single quotes", () => {
    expect(parseShellArgs("--config '/path/to/config.json'")).toEqual([
      "--config",
      "/path/to/config.json",
    ]);
    expect(parseShellArgs("'arg with spaces'")).toEqual(["arg with spaces"]);
  });

  test("should handle escaped characters", () => {
    expect(parseShellArgs("arg\\ with\\ spaces")).toEqual(["arg with spaces"]);
    expect(parseShellArgs('arg\\"with\\"quotes')).toEqual(['arg"with"quotes']);
  });

  test("should handle mixed quotes", () => {
    expect(parseShellArgs(`--msg "It's a test"`)).toEqual([
      "--msg",
      "It's a test",
    ]);
    expect(parseShellArgs(`--msg 'He said "hello"'`)).toEqual([
      "--msg",
      'He said "hello"',
    ]);
  });

  test("should handle complex real-world example", () => {
    const input = `--max-turns 3 --mcp-config "/Users/john/config.json" --model claude-3-5-sonnet-latest --system-prompt 'You are helpful'`;
    expect(parseShellArgs(input)).toEqual([
      "--max-turns",
      "3",
      "--mcp-config",
      "/Users/john/config.json",
      "--model",
      "claude-3-5-sonnet-latest",
      "--system-prompt",
      "You are helpful",
    ]);
  });
});