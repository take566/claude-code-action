#!/usr/bin/env bun

/**
 * Branch name template parsing and variable substitution utilities
 */

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
): string {
  const variables = createBranchTemplateVariables(
    branchPrefix,
    entityType,
    entityNumber,
    sha,
    label,
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
