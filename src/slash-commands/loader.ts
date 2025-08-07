import { readFile, readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";

export interface SlashCommandMetadata {
  tools?: string[];
  settings?: Record<string, any>;
  description?: string;
}

export interface SlashCommand {
  name: string;
  metadata: SlashCommandMetadata;
  content: string;
}

export interface ResolvedCommand {
  expandedPrompt: string;
  tools?: string[];
  settings?: Record<string, any>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, "../../slash-commands");

export async function resolveSlashCommand(
  prompt: string,
  variables?: Record<string, string | undefined>,
): Promise<ResolvedCommand> {
  if (!prompt.startsWith("/")) {
    return handleLegacyPrompts(prompt);
  }

  const parts = prompt.slice(1).split(" ");
  const commandPath = parts[0];
  const args = parts.slice(1);

  if (!commandPath) {
    return { expandedPrompt: prompt };
  }

  const commandParts = commandPath.split("/");

  try {
    const command = await loadCommand(commandParts);
    if (!command) {
      console.warn(`Slash command not found: ${commandPath}`);
      return { expandedPrompt: prompt };
    }

    let expandedContent = command.content;

    if (args.length > 0) {
      expandedContent = expandedContent.replace(/\{args\}/g, args.join(" "));
    }

    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        if (value !== undefined) {
          const regex = new RegExp(`\\{${key}\\}`, "g");
          expandedContent = expandedContent.replace(regex, value);
        }
      });
    }

    return {
      expandedPrompt: expandedContent,
      tools: command.metadata.tools,
      settings: command.metadata.settings,
    };
  } catch (error) {
    console.error(`Error loading slash command: ${error}`);
    return { expandedPrompt: prompt };
  }
}

async function loadCommand(
  commandParts: string[],
): Promise<SlashCommand | null> {
  const possiblePaths = [
    join(COMMANDS_DIR, ...commandParts) + ".md",
    join(COMMANDS_DIR, ...commandParts, "default.md"),
    join(COMMANDS_DIR, commandParts[0] + ".md"),
  ];

  for (const filePath of possiblePaths) {
    try {
      const fileContent = await readFile(filePath, "utf-8");
      return parseCommandFile(commandParts.join("/"), fileContent);
    } catch (error) {
      continue;
    }
  }

  return null;
}

function parseCommandFile(name: string, content: string): SlashCommand {
  let metadata: SlashCommandMetadata = {};
  let commandContent = content;

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch && frontmatterMatch[1]) {
    try {
      const parsedYaml = yaml.load(frontmatterMatch[1]);
      if (parsedYaml && typeof parsedYaml === "object") {
        metadata = parsedYaml as SlashCommandMetadata;
      }
      commandContent = frontmatterMatch[2]?.trim() || content;
    } catch (error) {
      console.warn(`Failed to parse frontmatter for command ${name}:`, error);
    }
  }

  return {
    name,
    metadata,
    content: commandContent,
  };
}

export async function listAvailableCommands(): Promise<string[]> {
  const commands: string[] = [];

  async function scanDirectory(dir: string, prefix = ""): Promise<void> {
    try {
      const entries = await readdir(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const entryStat = await stat(fullPath);

        if (entryStat.isDirectory()) {
          await scanDirectory(fullPath, prefix ? `${prefix}/${entry}` : entry);
        } else if (entry.endsWith(".md")) {
          const commandName = entry.replace(".md", "");
          if (commandName !== "default") {
            commands.push(prefix ? `${prefix}/${commandName}` : commandName);
          } else if (prefix) {
            commands.push(prefix);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  await scanDirectory(COMMANDS_DIR);
  return commands.sort();
}

function handleLegacyPrompts(prompt: string): ResolvedCommand {
  const legacyKeys = ["override_prompt", "direct_prompt"];
  for (const key of legacyKeys) {
    const envValue = process.env[key.toUpperCase()];
    if (envValue) {
      console.log(`Using legacy ${key} as prompt`);
      return { expandedPrompt: envValue };
    }
  }
  return { expandedPrompt: prompt };
}
