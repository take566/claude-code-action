#!/usr/bin/env bun

/**
 * Branch name template parsing and variable substitution utilities
 */

/**
 * Extracts the first three words from a title and converts them to kebab-case
 */
function extractDescription(title: string): string {
  if (!title || title.trim() === "") {
    return "";
  }

  return title
    .trim() // Remove leading/trailing whitespace
    .split(/\s+/) // Split on whitespace
    .slice(0, 3) // Take first 3 words
    .join("-") // Join with hyphens
    .toLowerCase() // Convert to lowercase
    .replace(/[^a-z0-9-]/g, "") // Remove non-alphanumeric except hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
}

export interface BranchTemplateVariables {
  prefix: string;
  entityType: string;
  entityNumber: number;
  timestamp: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  sha?: string;
  label?: string;
  description?: string;
}

/**
 * Replaces template variables in a branch name template
 * Template format: {{variableName}}
 */
export function applyBranchTemplate(
  template: string,
  variables: BranchTemplateVariables,
): string {
  let result = template;

  // Replace each variable
  Object.entries(variables).forEach(([key, value]) => {
    if (value !== undefined) {
      const placeholder = `{{${key}}}`;
      result = result.replaceAll(placeholder, String(value));
    }
  });

  return result;
}

/**
 * Generates template variables from current context
 */
export function createBranchTemplateVariables(
  branchPrefix: string,
  entityType: string,
  entityNumber: number,
  sha?: string,
  label?: string,
  title?: string,
): BranchTemplateVariables {
  const now = new Date();

  return {
    prefix: branchPrefix,
    entityType,
    entityNumber,
    timestamp: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`,
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, "0"),
    day: String(now.getDate()).padStart(2, "0"),
    hour: String(now.getHours()).padStart(2, "0"),
    minute: String(now.getMinutes()).padStart(2, "0"),
    sha: sha?.substring(0, 8), // First 8 characters of SHA
    label: label || entityType, // Fall back to entityType if no label
    description: title !== undefined ? extractDescription(title) : undefined,
  };
}

/**
 * Generates a branch name using template or falls back to default format
 */
export function generateBranchName(
  template: string | undefined,
  branchPrefix: string,
  entityType: string,
  entityNumber: number,
  sha?: string,
  label?: string,
  title?: string,
): string {
  const variables = createBranchTemplateVariables(
    branchPrefix,
    entityType,
    entityNumber,
    sha,
    label,
    title,
  );

  let branchName: string;

  if (template && template.trim()) {
    // Use custom template
    branchName = applyBranchTemplate(template, variables);
  } else {
    // Use default format (backward compatibility)
    branchName = `${branchPrefix}${entityType}-${entityNumber}-${variables.timestamp}`;
  }

  // Ensure branch name is Kubernetes-compatible:
  // - Lowercase only
  // - Alphanumeric with hyphens
  // - No underscores
  // - Max 50 chars (to allow for prefixes)
  return branchName.toLowerCase().substring(0, 50);
}
