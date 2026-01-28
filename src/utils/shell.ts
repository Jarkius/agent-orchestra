/**
 * Shell Security Utilities
 * Provides safe escaping for shell command construction
 *
 * CRITICAL: These functions prevent command injection attacks when
 * constructing shell commands with user-controllable values.
 */

/**
 * Escape a string for safe use in shell single quotes.
 * Single quotes cannot contain single quotes directly, so we:
 * 1. Close the single quote
 * 2. Add an escaped single quote
 * 3. Re-open single quote
 *
 * Example: "it's" -> "it'\''s" (when wrapped: 'it'\''s')
 *
 * @param arg - The string to escape
 * @returns Escaped string safe for use inside single quotes
 */
export function escapeShellArg(arg: string): string {
  if (typeof arg !== 'string') {
    throw new TypeError('escapeShellArg requires a string argument');
  }
  // Replace ' with '\'' (end quote, escaped quote, start quote)
  return arg.replace(/'/g, "'\\''");
}

/**
 * Wrap a value in single quotes after escaping.
 *
 * @param arg - The string to quote
 * @returns Quoted and escaped string: 'escaped_value'
 */
export function quoteShellArg(arg: string): string {
  return `'${escapeShellArg(arg)}'`;
}

/**
 * Escape a path for shell use (handles spaces and special chars).
 * For paths, we use single quotes which handle most special chars.
 *
 * @param path - The path to escape
 * @returns Quoted path safe for shell use
 */
export function escapeShellPath(path: string): string {
  return quoteShellArg(path);
}

/**
 * Validate that an environment variable name is safe.
 * Only allows alphanumeric and underscores, must start with letter or underscore.
 *
 * @param name - The environment variable name to validate
 * @returns True if the name is valid for shell use
 */
export function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Build safe environment variable assignment for shell.
 *
 * @param name - The environment variable name (must be valid)
 * @param value - The value to assign (will be escaped)
 * @returns Shell assignment string: NAME='escaped_value'
 * @throws Error if name is not a valid environment variable name
 */
export function buildEnvAssignment(name: string, value: string): string {
  if (!isValidEnvVarName(name)) {
    throw new Error(`Invalid environment variable name: ${name}`);
  }
  return `${name}=${quoteShellArg(value)}`;
}
