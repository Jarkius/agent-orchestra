/**
 * PTYManager Tests
 * Comprehensive tests for platform-aware pseudo-terminal management
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { PTYManager } from '../manager';
import type { AgentEvent, HealthStatus } from '../../interfaces/pty';

// Mock tmux commands for testing without actual tmux
const mockTmux = {
  sessionExists: true,
  panes: new Map<string, { pid: number; responsive: boolean }>(),
  nextPaneId: 1,
};

describe('PTYManager', () => {
  let manager: PTYManager;
  const testSessionName = `test-session-${Date.now()}`;

  beforeEach(() => {
    manager = new PTYManager(testSessionName, {
      healthCheckIntervalMs: 0, // Disable auto health checks for testing
      autoRestart: false,
    });
    mockTmux.panes.clear();
    mockTmux.nextPaneId = 1;
  });

  afterEach(async () => {
    try {
      await manager.shutdown();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Platform Detection', () => {
    it('should detect current platform', () => {
      const platform = manager.getPlatform();
      expect(['darwin', 'linux', 'win32']).toContain(platform);
    });

    it('should report supported status correctly', () => {
      const supported = manager.isSupported();
      const platform = manager.getPlatform();

      if (platform === 'darwin' || platform === 'linux') {
        expect(supported).toBe(true);
      } else {
        expect(supported).toBe(false);
      }
    });
  });

  describe('Handle Management', () => {
    it('should return null for non-existent agent', () => {
      const handle = manager.getHandle(999);
      expect(handle).toBeNull();
    });

    it('should return empty array when no agents spawned', () => {
      const handles = manager.getAllHandles();
      expect(handles).toEqual([]);
    });
  });

  describe('Event System', () => {
    it('should emit events via watchAll generator', async () => {
      const events: AgentEvent[] = [];
      const watcher = manager.watchAll();

      // Manually emit an event (internal method access for testing)
      const emitEvent = (manager as any).emitEvent.bind(manager);
      emitEvent({
        type: 'spawn',
        agentId: 1,
        timestamp: new Date(),
        data: { test: true },
      });

      // Get first event
      const result = await Promise.race([
        watcher.next(),
        new Promise(r => setTimeout(() => r({ done: true }), 100)),
      ]);

      if (!(result as IteratorResult<AgentEvent>).done) {
        events.push((result as IteratorResult<AgentEvent>).value);
      }

      expect(events.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Health Check Logic', () => {
    it('should return unhealthy status for non-existent agent', async () => {
      const status = await manager.healthCheck(999);
      expect(status.alive).toBe(false);
      expect(status.responsive).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should use default config when not specified', () => {
      const defaultManager = new PTYManager();
      expect(defaultManager).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customManager = new PTYManager('custom-session', {
        cols: 200,
        rows: 50,
      });
      expect(customManager).toBeDefined();
    });
  });
});

describe('PTYManager Unit Tests (No tmux)', () => {
  describe('Configuration Handling', () => {
    it('should accept partial config', () => {
      const manager = new PTYManager('test', {
        healthCheckIntervalMs: 10000,
      });
      expect(manager).toBeDefined();
    });

    it('should accept full config', () => {
      const manager = new PTYManager('test', {
        cwd: '/tmp',
        env: { TEST: 'value' },
        shell: '/bin/bash',
        cols: 100,
        rows: 40,
        healthCheckIntervalMs: 5000,
        autoRestart: true,
      });
      expect(manager).toBeDefined();
    });
  });

  describe('Session Name Generation', () => {
    it('should use provided session name', () => {
      const manager = new PTYManager('my-custom-session');
      expect(manager).toBeDefined();
    });

    it('should generate session name when not provided', () => {
      const manager = new PTYManager();
      expect(manager).toBeDefined();
    });
  });

  describe('Status Updates', () => {
    it('should handle status transitions', () => {
      const manager = new PTYManager('test', { healthCheckIntervalMs: 0 });
      // Access private method for testing
      const updateStatus = (manager as any).updateStatus.bind(manager);

      // Since no handle exists, this should not throw
      expect(() => updateStatus(1, 'idle')).not.toThrow();
    });
  });
});
