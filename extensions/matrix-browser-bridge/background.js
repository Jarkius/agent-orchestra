/**
 * Matrix Browser Bridge - Background Service Worker
 *
 * Minimal MQTT-to-Chrome bridge for browser automation.
 * Generic (not site-specific) - works with any website.
 *
 * Commands arrive via MQTT, execute via Chrome APIs, responses sent back.
 *
 * Uses chrome.alarms + chrome.storage keepalive to survive MV3 service worker shutdown.
 */

importScripts('mqtt.min.js');

const VERSION = '0.1.0';
const MQTT_URL = 'ws://localhost:9001';
const TOPICS = {
  command: 'matrix/browser/command',
  response: 'matrix/browser/response',
  status: 'matrix/browser/status',
};

let client = null;
let isConnected = false;
let connectedAt = 0;

// ============================================================================
// Keep-Alive (MV3 service workers die after ~30s of inactivity)
// ============================================================================

const KEEPALIVE_ALARM = 'matrix-keepalive';

// Create alarm that fires every 25 seconds to keep service worker alive
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 25 / 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Touch storage to keep service worker active
    chrome.storage.session.set({ keepalive: Date.now() });

    // Reconnect if disconnected
    if (!isConnected || !client) {
      console.log('[Matrix] Keep-alive: reconnecting...');
      connect();
    }
  }
});

// Also wake on any chrome event
chrome.tabs.onUpdated.addListener(() => {
  if (!isConnected || !client) connect();
});

chrome.tabs.onCreated.addListener(() => {
  if (!isConnected || !client) connect();
});

// ============================================================================
// MQTT Connection
// ============================================================================

function connect() {
  // Don't double-connect
  if (client && isConnected) return;

  // Clean up old client
  if (client) {
    try { client.end(true); } catch (_) {}
    client = null;
  }

  console.log('[Matrix] Connecting to', MQTT_URL);

  client = mqtt.connect(MQTT_URL, {
    clientId: 'matrix-bridge-' + Date.now(),
    keepalive: 15,
    reconnectPeriod: 5000,
    will: {
      topic: TOPICS.status,
      payload: JSON.stringify({ status: 'offline', version: VERSION, ts: Date.now() }),
      qos: 0,
      retain: true,
    },
  });

  client.on('connect', () => {
    console.log('[Matrix] Connected!');
    isConnected = true;
    connectedAt = Date.now();
    updateBadge(true);

    client.subscribe(TOPICS.command, (err) => {
      if (err) console.error('[Matrix] Subscribe error:', err);
    });

    client.publish(TOPICS.status, JSON.stringify({
      status: 'online', version: VERSION, ts: Date.now(),
    }), { retain: true });
  });

  client.on('message', (topic, message) => {
    try {
      const cmd = JSON.parse(message.toString());
      if (cmd.ts && cmd.ts < connectedAt) return; // Ignore stale
      handleCommand(cmd);
    } catch (e) {
      console.error('[Matrix] Parse error:', e);
    }
  });

  client.on('close', () => {
    isConnected = false;
    updateBadge(false);
  });

  client.on('error', (err) => console.error('[Matrix] Error:', err));
}

function publish(topic, data) {
  if (client && isConnected) {
    client.publish(topic, JSON.stringify(data), { qos: 0 });
  }
}

function updateBadge(connected) {
  chrome.action.setBadgeText({ text: VERSION });
  chrome.action.setBadgeBackgroundColor({
    color: connected ? '#22c55e' : '#ef4444',
  });
}

// ============================================================================
// Command Router
// ============================================================================

async function handleCommand(cmd) {
  console.log('[Matrix] Command:', cmd.action);
  let result;

  try {
    switch (cmd.action) {
      // --- Tab Management ---
      case 'create_tab': {
        const tab = await chrome.tabs.create({
          url: cmd.url || 'about:blank',
          active: cmd.active !== false,
        });
        result = { success: true, tabId: tab.id, url: tab.pendingUrl || tab.url };
        break;
      }

      case 'list_tabs': {
        const tabs = await chrome.tabs.query({});
        result = {
          success: true,
          count: tabs.length,
          tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
        };
        break;
      }

      case 'focus_tab': {
        await chrome.tabs.update(cmd.tabId, { active: true });
        const tab = await chrome.tabs.get(cmd.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        result = { success: true, tabId: cmd.tabId };
        break;
      }

      case 'close_tab': {
        await chrome.tabs.remove(cmd.tabId);
        result = { success: true, tabId: cmd.tabId };
        break;
      }

      case 'navigate': {
        await chrome.tabs.update(cmd.tabId, { url: cmd.url });
        result = { success: true, tabId: cmd.tabId, url: cmd.url };
        break;
      }

      // --- Page Content ---
      case 'get_url': {
        const tab = await getTab(cmd.tabId);
        result = { success: true, url: tab.url, title: tab.title, tabId: tab.id };
        break;
      }

      case 'get_text': {
        const tab = await getTab(cmd.tabId);
        const textResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.body.innerText,
        });
        result = { success: true, text: textResult[0]?.result || '', tabId: tab.id };
        break;
      }

      case 'get_html': {
        const tab = await getTab(cmd.tabId);
        const htmlResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.documentElement.outerHTML.substring(0, 50000),
        });
        result = { success: true, html: htmlResult[0]?.result || '', tabId: tab.id };
        break;
      }

      // --- DOM Interaction ---
      case 'click': {
        const tab = await getTab(cmd.tabId);
        const clickResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => {
            const el = document.querySelector(selector);
            if (!el) return { error: 'Element not found: ' + selector };
            el.click();
            return { success: true };
          },
          args: [cmd.selector],
        });
        result = clickResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'type': {
        const tab = await getTab(cmd.tabId);
        const typeResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, text) => {
            const el = selector ? document.querySelector(selector) : document.activeElement;
            if (!el) return { error: 'Element not found' };
            el.focus();
            if (el.contentEditable === 'true') {
              el.innerHTML = '<p>' + text + '</p>';
              el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
            } else {
              el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { success: true };
          },
          args: [cmd.selector || null, cmd.text],
        });
        result = typeResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'key': {
        const tab = await getTab(cmd.tabId);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (key) => {
            const el = document.activeElement || document.body;
            el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode: key === 'Enter' ? 13 : 0, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
          },
          args: [cmd.key],
        });
        result = { success: true, key: cmd.key, tabId: tab.id };
        break;
      }

      // --- JavaScript Execution ---
      case 'execute': {
        const tab = await getTab(cmd.tabId);
        const execResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: new Function('return (' + cmd.code + ')'),
        });
        result = { success: true, result: execResult[0]?.result, tabId: tab.id };
        break;
      }

      // --- Screenshot ---
      case 'screenshot': {
        const tab = await getTab(cmd.tabId);
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise(r => setTimeout(r, 200));
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        result = { success: true, screenshot: dataUrl, tabId: tab.id };
        break;
      }

      // --- Wait for Content ---
      case 'wait_for': {
        const tab = await getTab(cmd.tabId);
        const waitResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, timeout) => {
            return new Promise((resolve) => {
              const el = document.querySelector(selector);
              if (el) { resolve({ success: true, found: true }); return; }

              const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) { observer.disconnect(); resolve({ success: true, found: true }); }
              });
              observer.observe(document.body, { childList: true, subtree: true });

              setTimeout(() => {
                observer.disconnect();
                resolve({ success: false, error: 'Timeout waiting for: ' + selector });
              }, timeout || 10000);
            });
          },
          args: [cmd.selector, cmd.timeout || 10000],
        });
        result = waitResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      // --- Ping (health check) ---
      case 'ping': {
        result = { success: true, pong: true, uptime: Date.now() - connectedAt };
        break;
      }

      default:
        result = { error: 'Unknown action: ' + cmd.action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  // Publish response
  publish(TOPICS.response, {
    id: cmd.id,
    action: cmd.action,
    ...result,
    timestamp: Date.now(),
  });
}

// ============================================================================
// Helpers
// ============================================================================

async function getTab(tabId) {
  if (tabId) return chrome.tabs.get(tabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab;
}

// ============================================================================
// Init
// ============================================================================

connect();
