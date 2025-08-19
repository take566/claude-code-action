// This file intentionally has TypeScript errors to trigger CI failure
const testFunction = (param: string): number => {
  // Type error: returning string instead of number
  return "this should be a number";
}

// Syntax error: missing closing brace
function brokenFunction() {
  console.log("missing closing brace"
}

export { testFunction, brokenFunction };