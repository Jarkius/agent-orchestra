/**
 * Matrix Browser Bridge - Background Service Worker v0.2.0
 *
 * MQTT-to-Chrome bridge for browser automation.
 * Generic commands + Gemini-specific research commands.
 *
 * Commands arrive via MQTT, execute via Chrome APIs, responses sent back.
 * Uses chrome.alarms keepalive to survive MV3 service worker shutdown.
 */

importScripts('mqtt.min.js');

const VERSION = '0.4.0';
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

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 25 / 60 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    chrome.storage.session.set({ keepalive: Date.now() });
    if (!isConnected || !client) {
      console.log('[Matrix] Keep-alive: reconnecting...');
      connect();
    }
  }
});

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
  if (client && isConnected) return;

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
      if (cmd.ts && cmd.ts < connectedAt) return;
      handleCommand(cmd);
    } catch (e) {
      console.error('[Matrix] Parse error:', e);
    }
  });

  client.on('close', () => { isConnected = false; updateBadge(false); });
  client.on('error', (err) => console.error('[Matrix] Error:', err));
}

function publish(topic, data) {
  if (client && isConnected) {
    client.publish(topic, JSON.stringify(data), { qos: 0 });
  }
}

function updateBadge(connected) {
  chrome.action.setBadgeText({ text: connected ? 'ON' : 'OFF' });
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

      // ---- Tab Management ----

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

      // ---- Page Content ----

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

      // ---- DOM Interaction ----

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

      // ---- Script Execution (fixed) ----

      case 'eval': {
        const tab = await getTab(cmd.tabId);
        const evalResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (code) => {
            try {
              return { success: true, result: eval(code) };
            } catch (e) {
              return { error: e.message };
            }
          },
          args: [cmd.code],
        });
        result = evalResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      // ---- Screenshot ----

      case 'screenshot': {
        const tab = await getTab(cmd.tabId);
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise(r => setTimeout(r, 200));
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        result = { success: true, screenshot: dataUrl, tabId: tab.id };
        break;
      }

      case 'extract_images': {
        // Extract all images from the page as base64 data URLs
        // Useful for grabbing Gemini-generated images
        const tab = await getTab(cmd.tabId);
        const imgResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (maxImages) => {
            const images = document.querySelectorAll('img');
            const results = [];
            for (const img of images) {
              if (results.length >= (maxImages || 5)) break;
              const rect = img.getBoundingClientRect();
              if (rect.width < 50 || rect.height < 50) continue; // skip tiny images
              // Try to extract via canvas
              try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || rect.width;
                canvas.height = img.naturalHeight || rect.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                results.push({
                  src: (img.src || '').substring(0, 200),
                  alt: img.alt || '',
                  width: canvas.width,
                  height: canvas.height,
                  dataUrl: dataUrl,
                });
              } catch (e) {
                // Cross-origin images can't be extracted via canvas
                results.push({
                  src: (img.src || '').substring(0, 200),
                  alt: img.alt || '',
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                  error: 'cross-origin: ' + e.message,
                });
              }
            }
            return { success: true, count: results.length, images: results };
          },
          args: [cmd.maxImages || 5],
        });
        result = imgResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      // ---- Wait for Selector ----

      case 'wait_for': {
        const tab = await getTab(cmd.tabId);
        const waitResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, timeout) => {
            return new Promise((resolve) => {
              const el = document.querySelector(selector);
              if (el) { resolve({ success: true, found: true }); return; }

              const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                  observer.disconnect();
                  resolve({ success: true, found: true });
                }
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

      // ---- Gemini-Specific Commands ----

      case 'gemini_inspect': {
        const tab = await getTab(cmd.tabId);
        const inspResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Find all input-like elements
            const inputs = document.querySelectorAll(
              'textarea, [contenteditable="true"], [role="textbox"], .ql-editor, rich-textarea, .input-area'
            );
            const inputInfo = Array.from(inputs).map(el => ({
              tag: el.tagName.toLowerCase(),
              class: el.className.toString().substring(0, 100),
              id: el.id,
              role: el.getAttribute('role'),
              contentEditable: el.contentEditable,
              ariaLabel: el.getAttribute('aria-label'),
              placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
            }));

            // Find send/submit buttons
            const buttons = document.querySelectorAll('button');
            const sendButtons = Array.from(buttons).filter(b => {
              const label = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.textContent || '').toLowerCase();
              return label.includes('send') || label.includes('submit') || text.includes('send');
            }).map(b => ({
              tag: 'button',
              class: b.className.toString().substring(0, 100),
              ariaLabel: b.getAttribute('aria-label'),
              text: (b.textContent || '').substring(0, 50).trim(),
              matIcon: b.querySelector('mat-icon')?.textContent,
            }));

            // Check if it looks like Gemini
            const isGemini = window.location.hostname.includes('gemini.google.com');

            return {
              success: true,
              isGemini,
              url: window.location.href,
              inputs: inputInfo,
              sendButtons,
              totalButtons: buttons.length,
            };
          },
        });
        result = inspResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'gemini_chat': {
        // Evolved from Soul-Brews-Studio/claude-browser-proxy tested selectors
        const tab = await getTab(cmd.tabId);

        // Count existing responses before sending (for wait detection)
        const preCount = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.querySelectorAll('MESSAGE-CONTENT, message-content, model-response').length,
        });

        const chatResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (text) => {
            // Priority order from battle-tested selectors:
            const selectors = [
              'div[aria-label="Enter a prompt here"]',        // Most stable Gemini selector
              'rich-textarea .ql-editor',                      // Gemini rich text editor
              'rich-textarea [contenteditable="true"]',        // Fallback rich-textarea
              '.ql-editor[contenteditable="true"]',            // Quill editor
              '[data-placeholder*="prompt"]',                  // Placeholder-based
              '[contenteditable="true"]',                      // Generic contenteditable
              'textarea',                                      // Fallback textarea
            ];

            let input = null;
            let method = '';
            for (const sel of selectors) {
              input = document.querySelector(sel);
              if (input) { method = sel; break; }
            }
            if (!input) return { error: 'No input element found' };

            input.focus();
            if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
              input.value = text;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              input.innerHTML = '<p>' + text + '</p>';
              input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
            }
            return { success: true, method };
          },
          args: [cmd.text],
        });

        const chatRes = chatResult[0]?.result || { error: 'Script failed' };

        if (chatRes.success) {
          await new Promise(r => setTimeout(r, 500));

          const sendResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // 1. aria-label Send button (most reliable)
              const sendBtn = document.querySelector(
                'button[aria-label*="Send"], button[data-test-id="send-button"], .send-button'
              );
              if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
                return { success: true, method: 'send-button', label: sendBtn.getAttribute('aria-label') };
              }

              // 2. mat-icon "send"
              for (const btn of document.querySelectorAll('button')) {
                const icon = btn.querySelector('mat-icon');
                if (icon && icon.textContent.trim() === 'send') {
                  btn.click();
                  return { success: true, method: 'mat-icon-send' };
                }
              }

              // 3. Button in input area container
              const inputArea = document.querySelector('.input-area, .chat-input, .prompt-container, rich-textarea');
              if (inputArea) {
                const parent = inputArea.closest('.input-area-container') || inputArea.parentElement;
                if (parent) {
                  const btns = parent.querySelectorAll('button:not([disabled])');
                  for (const btn of btns) {
                    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (label.includes('send') || label.includes('submit')) {
                      btn.click();
                      return { success: true, method: 'parent-send-btn' };
                    }
                  }
                }
              }

              // 4. Enter key on the editor
              const editor = document.querySelector('[contenteditable="true"], textarea');
              if (editor) {
                editor.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter', code: 'Enter', keyCode: 13,
                  bubbles: true, cancelable: true,
                }));
                return { success: true, method: 'enter-key' };
              }

              return { error: 'No send mechanism found' };
            },
          });
          const sendRes = sendResult[0]?.result || { error: 'Send script failed' };
          result = {
            success: chatRes.success && sendRes.success,
            typing: chatRes,
            sending: sendRes,
            preResponseCount: preCount[0]?.result || 0,
            tabId: tab.id,
          };
        } else {
          result = chatRes;
          result.tabId = tab.id;
        }
        break;
      }

      case 'gemini_read': {
        // Evolved: Soul-Brews proven selectors (MESSAGE-CONTENT uppercase first)
        const tab = await getTab(cmd.tabId);
        const readResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (maxLen) => {
            const getResponses = () =>
              document.querySelectorAll('MESSAGE-CONTENT, message-content, [data-message-id], .model-response-text, model-response');

            const responses = getResponses();
            if (responses.length > 0) {
              const last = responses[responses.length - 1];
              const text = (last.textContent || last.innerText || '').trim();
              return {
                success: true,
                text: text.substring(0, maxLen || 5000),
                selector: last.tagName,
                responseCount: responses.length,
              };
            }

            // Fallback: body text
            return {
              success: true,
              text: document.body.innerText.substring(0, maxLen || 5000),
              selector: 'body-fallback',
              responseCount: 0,
            };
          },
          args: [cmd.maxLength || 30000],
        });
        result = readResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'gemini_wait': {
        // Evolved: Soul-Brews core pattern — snapshot baseline, detect new content, 3x stability at 500ms
        const tab = await getTab(cmd.tabId);
        const timeout = cmd.timeout || 60000;
        const startTime = Date.now();

        // Snapshot baseline: capture current last response text BEFORE waiting
        const baseline = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const responses = document.querySelectorAll('MESSAGE-CONTENT, message-content, [data-message-id], .model-response-text');
            const count = responses.length;
            let text = '';
            if (count > 0) {
              text = (responses[count - 1].textContent || responses[count - 1].innerText || '').trim();
            }
            return { count, text: text.substring(0, 8000) };
          },
        });
        const baselineData = baseline[0]?.result || { count: 0, text: '' };

        let lastText = '';
        let stableCount = 0;
        let finalText = '';
        let sawGeneration = false;

        while (Date.now() - startTime < timeout) {
          await new Promise(r => setTimeout(r, 500));

          const pollResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (baseCount, baseText) => {
              // 1. Spinner detection
              const spinner = document.querySelector('mat-mdc-progress-spinner.mdc-circular-progress--indeterminate');
              let spinnerActive = false;
              if (spinner) {
                const rect = spinner.getBoundingClientRect();
                spinnerActive = rect.top > 100 && rect.top < window.innerHeight && rect.bottom > 0;
              }

              // 2. Stop button
              const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[aria-label*="Stop"]');

              // 3. Streaming indicator
              const streaming = document.querySelector('.streaming-indicator, [data-streaming="true"]');

              const isGenerating = spinnerActive || !!stopBtn || !!streaming;

              // 4. Get latest response
              const responses = document.querySelectorAll('MESSAGE-CONTENT, message-content, [data-message-id], .model-response-text');
              const count = responses.length;
              let text = '';
              if (count > 0) {
                text = (responses[count - 1].textContent || responses[count - 1].innerText || '').trim();
              }

              // Detect new content: either more responses, or last response text changed from baseline
              const hasNewContent = count > baseCount || (text.length > 20 && text !== baseText);

              return {
                isGenerating,
                text: text.substring(0, 8000),
                textLen: text.length,
                count,
                hasNewContent,
              };
            },
            args: [baselineData.count, baselineData.text],
          });

          const poll = pollResult[0]?.result || {};
          const currentText = poll.text || '';

          // Track if we ever saw generation (spinner/stop button)
          if (poll.isGenerating) sawGeneration = true;

          // Only check stability if we see new content
          if (poll.hasNewContent && currentText.length > 20) {
            if (currentText === lastText && !poll.isGenerating) {
              stableCount++;
              if (stableCount >= 3) {
                finalText = currentText;
                break;
              }
            } else {
              stableCount = 0;
              lastText = currentText;
            }
          }
        }

        result = {
          success: finalText.length > 0,
          text: finalText,
          elapsed: Date.now() - startTime,
          sawGeneration,
          tabId: tab.id,
        };
        if (!finalText) {
          result.error = 'Timeout waiting for Gemini response';
        }
        break;
      }

      // ---- Gemini Model & Mode Selection ----

      case 'gemini_select_model': {
        // Select Fast / Thinking / Pro model (Soul-Brews evolved pattern)
        const tab = await getTab(cmd.tabId);
        const model = cmd.model; // 'Fast', 'Thinking', 'Pro'
        if (!model) { result = { error: 'model required (Fast, Thinking, Pro)' }; break; }

        const selectResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (targetModel) => {
            return new Promise((resolve) => {
              // 1. Find the model dropdown button
              let dropdownBtn = null;

              // Strategy A: button with class containing 'input-area-switch'
              dropdownBtn = Array.from(document.querySelectorAll('button')).find(b =>
                b.className.includes('input-area-switch')
              );

              // Strategy B: button text matches a model name
              if (!dropdownBtn) {
                dropdownBtn = Array.from(document.querySelectorAll('button')).find(b => {
                  const text = b.textContent.trim();
                  return text === 'Fast' || text === 'Thinking' || text === 'Pro';
                });
              }

              // Strategy C: button in pill-ui container
              if (!dropdownBtn) {
                dropdownBtn = Array.from(document.querySelectorAll('button')).find(b =>
                  b.parentElement && b.parentElement.className && b.parentElement.className.includes('pill-ui')
                );
              }

              if (!dropdownBtn) {
                resolve({ error: 'Model dropdown button not found' });
                return;
              }

              // Click dropdown
              dropdownBtn.click();

              // Wait for dropdown to appear, then select model
              setTimeout(() => {
                const options = document.querySelectorAll(
                  '[role="option"], [role="menuitem"], [role="listbox"] button, .mdc-list-item, mat-option'
                );

                let found = false;
                for (const opt of options) {
                  const text = (opt.textContent || '').trim();
                  if (text.includes(targetModel)) {
                    opt.click();
                    found = true;
                    break;
                  }
                }

                if (!found) {
                  // Try clicking any element that contains the model name
                  const allEls = document.querySelectorAll('*');
                  for (const el of allEls) {
                    if (el.children.length === 0 && el.textContent.trim() === targetModel) {
                      el.click();
                      found = true;
                      break;
                    }
                  }
                }

                resolve({
                  success: found,
                  model: targetModel,
                  method: found ? 'dropdown-select' : 'not-found',
                });
              }, 600);
            });
          },
          args: [model],
        });
        result = selectResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'gemini_deep_research': {
        // Activate Deep Research or other Gemini tool from the tools drawer
        const tab = await getTab(cmd.tabId);

        const drResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (targetTool) => {
            return new Promise((resolve) => {
              // 1. Find the tools drawer toggle button
              // It's in the input area, has a mat-icon (typically "tune" or similar)
              const inputArea = document.querySelector('.input-area');
              if (!inputArea) { resolve({ error: 'No .input-area found' }); return; }

              const allButtons = Array.from(inputArea.querySelectorAll('button'));
              const debug = allButtons.map((b, i) => ({
                i,
                aria: b.getAttribute('aria-label'),
                text: (b.textContent || '').trim().substring(0, 30),
                classes: b.className.substring(0, 60),
              }));

              // The drawer toggle is NOT the + button, NOT send, NOT mic
              // Look for a button that isn't those
              let drawerBtn = null;
              for (const b of allButtons) {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const cls = b.className.toLowerCase();
                // Skip known buttons
                if (aria.includes('send') || cls.includes('send')) continue;
                if (aria.includes('mic') || aria.includes('voice')) continue;
                if (aria.includes('upload') || aria.includes('attach') || aria.includes('add file')) continue;
                if (cls.includes('add-button') || cls.includes('upload')) continue;
                // This might be the drawer toggle
                if (cls.includes('toolbox') || cls.includes('drawer') || cls.includes('tool')
                    || aria.includes('tool') || aria.includes('option') || aria.includes('more')) {
                  drawerBtn = b;
                  break;
                }
              }

              // If not found by name, try: button with mat-icon that's not +, send, mic
              if (!drawerBtn) {
                for (const b of allButtons) {
                  const icon = b.querySelector('mat-icon, .mat-icon');
                  if (!icon) continue;
                  const iconText = (icon.textContent || '').trim().toLowerCase();
                  if (iconText === 'send' || iconText === 'mic' || iconText === 'add' || iconText === 'attach_file') continue;
                  drawerBtn = b;
                  break;
                }
              }

              if (!drawerBtn) {
                resolve({ error: 'Drawer toggle not found', buttons: debug });
                return;
              }

              drawerBtn.click();

              // 2. Wait for drawer to render, then find and click target tool
              setTimeout(() => {
                // Scan page for the target tool text
                const allElements = document.querySelectorAll('*');
                let found = false;
                let availableTools = [];

                for (const el of allElements) {
                  const text = (el.textContent || '').trim();
                  // Collect visible tool names from the drawer
                  if (el.children.length === 0 && text.length > 2 && text.length < 50) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && rect.top > 0) {
                      if (text === 'Deep Research' || text === 'Canvas' || text.includes('Create')
                          || text === 'Guided Learning' || text === 'Tools') {
                        availableTools.push(text);
                      }
                    }
                  }

                  if (text === targetTool && el.children.length === 0 && !found) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      const x = rect.left + rect.width / 2;
                      const y = rect.top + rect.height / 2;
                      const target = document.elementFromPoint(x, y);
                      if (target) {
                        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
                      } else {
                        el.click();
                      }
                      found = true;
                    }
                  }
                }

                resolve({
                  success: found,
                  tool: targetTool,
                  availableTools,
                  drawerButtonAria: drawerBtn.getAttribute('aria-label'),
                });
              }, 1200);
            });
          },
          args: [cmd.tool || 'Deep Research'],
        });
        result = drResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'gemini_inspect_dr': {
        // Inspect Deep Research UI state: plan, buttons (Start research, Edit plan), status
        const tab = await getTab(cmd.tabId);
        const drInspResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Scan for all buttons
            const allButtons = Array.from(document.querySelectorAll('button'));
            const relevantButtons = allButtons.filter(b => {
              const text = (b.textContent || '').trim().toLowerCase();
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              return text.includes('research') || text.includes('plan') || text.includes('start')
                || text.includes('edit') || text.includes('cancel')
                || aria.includes('research') || aria.includes('plan') || aria.includes('start');
            }).map(b => ({
              text: (b.textContent || '').trim().substring(0, 80),
              aria: b.getAttribute('aria-label'),
              classes: b.className.substring(0, 80),
              visible: b.getBoundingClientRect().width > 0,
              disabled: b.disabled,
            }));

            // Look for Deep Research plan content, status indicators
            const allLeafElements = [];
            document.querySelectorAll('*').forEach(el => {
              if (el.children.length > 0) return;
              const text = (el.textContent || '').trim();
              if (text.length < 2 || text.length > 200) return;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return;
              const lower = text.toLowerCase();
              if (lower.includes('research') || lower.includes('plan') || lower.includes('step')
                  || lower.includes('searching') || lower.includes('thinking') || lower.includes('deep')) {
                allLeafElements.push({
                  text: text.substring(0, 120),
                  tag: el.tagName,
                  classes: (el.className || '').toString().substring(0, 60),
                });
              }
            });

            // Check for active spinner (Deep Research in progress)
            const spinner = document.querySelector('mat-mdc-progress-spinner.mdc-circular-progress--indeterminate');
            const hasSpinner = !!spinner;

            return {
              success: true,
              buttons: relevantButtons,
              elements: allLeafElements,
              hasSpinner,
              url: window.location.href,
            };
          },
        });
        result = drInspResult[0]?.result || { error: 'Script failed' };
        result.tabId = tab.id;
        break;
      }

      case 'gemini_dr_action': {
        // Click Deep Research action buttons using Chrome Debugger (trusted events).
        // Synthetic dispatchEvent won't work for Angular Material MDC buttons (isTrusted check).
        const tab = await getTab(cmd.tabId);
        const targetAction = cmd.button || 'Start research';

        // Step 1: Find button coordinates via scripting
        const findResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (target) => {
            const targetLower = target.toLowerCase();
            // Find button by text
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
            for (const b of allButtons) {
              const text = (b.textContent || '').trim();
              if (text.toLowerCase().includes(targetLower)) {
                const rect = b.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && !b.disabled) {
                  return {
                    found: true, text, disabled: b.disabled,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                  };
                }
              }
            }
            // List available for debug
            return {
              found: false,
              available: allButtons
                .filter(b => b.getBoundingClientRect().width > 0)
                .map(b => ({ text: (b.textContent || '').trim().substring(0, 60), disabled: b.disabled })),
            };
          },
          args: [targetAction],
        });

        const found = findResult[0]?.result;
        if (!found?.found) {
          result = { error: 'Button not found: ' + targetAction, available: found?.available };
          result.tabId = tab.id;
          break;
        }

        // Step 2: Click using MAIN world execution (Angular Zone.js needs MAIN world)
        // Then fallback to debugger if MAIN world fails
        const clickResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: (targetText) => {
            const buttons = document.querySelectorAll('button, [role="button"]');
            for (const b of buttons) {
              const text = (b.textContent || '').trim();
              if (text.toLowerCase().includes(targetText.toLowerCase()) && !b.disabled) {
                const rect = b.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  b.scrollIntoView({ block: 'center' });
                  b.focus();
                  b.click();
                  return { clicked: true, text, method: 'main-world-click' };
                }
              }
            }
            return { clicked: false };
          },
          args: [targetAction],
        });

        const cr = clickResult[0]?.result;
        if (cr?.clicked) {
          result = { success: true, clicked: cr.text, method: cr.method, x: Math.round(found.x), y: Math.round(found.y) };
        } else {
          // Fallback: chrome.debugger trusted events
          try {
            await chrome.debugger.attach({ tabId: tab.id }, '1.3');
            const x = Math.round(found.x);
            const y = Math.round(found.y);
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
              type: 'mousePressed', x, y, button: 'left', clickCount: 1,
            });
            await new Promise(r => setTimeout(r, 50));
            await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
              type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
            });
            await new Promise(r => setTimeout(r, 100));
            await chrome.debugger.detach({ tabId: tab.id });
            result = { success: true, clicked: found.text, method: 'debugger-trusted', x, y };
          } catch (dbgErr) {
            try { await chrome.debugger.detach({ tabId: tab.id }); } catch (_) {}
            result = { success: false, clicked: found.text, method: 'all-failed', debugError: dbgErr.message };
          }
        }
        result.tabId = tab.id;
        break;
      }

      case 'gemini_research': {
        // Compound command: open tab → set model → send query → wait → return response
        // Designed for Morpheus agent orchestration
        const url = 'https://gemini.google.com/app';
        const text = cmd.text || cmd.query;
        const model = cmd.model; // optional: 'Fast', 'Thinking', 'Pro'
        const useDeepResearch = cmd.deepResearch || false;
        const timeout = cmd.timeout || 120000;

        if (!text) { result = { error: 'text or query required' }; break; }

        // 1. Create tab
        const rTab = await chrome.tabs.create({ url, active: false });
        const rTabId = rTab.id;

        // 2. Wait for page to load
        await new Promise(r => setTimeout(r, 5000));

        // 3. Select model if specified
        if (model) {
          await handleCommand({ action: 'gemini_select_model', tabId: rTabId, model, id: cmd.id + '-model', ts: Date.now() });
          await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Activate Deep Research if requested
        if (useDeepResearch) {
          await handleCommand({ action: 'gemini_deep_research', tabId: rTabId, id: cmd.id + '-dr', ts: Date.now() });
          await new Promise(r => setTimeout(r, 1500));
        }

        // 5. Snapshot baseline
        const rBaseline = await chrome.scripting.executeScript({
          target: { tabId: rTabId },
          func: () => {
            const responses = document.querySelectorAll('MESSAGE-CONTENT, message-content, [data-message-id], .model-response-text');
            const count = responses.length;
            let bText = '';
            if (count > 0) bText = (responses[count - 1].textContent || '').trim();
            return { count, text: bText.substring(0, 8000) };
          },
        });
        const rBaseData = rBaseline[0]?.result || { count: 0, text: '' };

        // 6. Send query
        const rChatResult = await chrome.scripting.executeScript({
          target: { tabId: rTabId },
          func: (queryText) => {
            const input = document.querySelector(
              'div[aria-label="Enter a prompt here"], rich-textarea .ql-editor, [contenteditable="true"]'
            );
            if (!input) return { error: 'No input element' };
            input.focus();
            input.innerHTML = '<p>' + queryText + '</p>';
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: queryText }));
            return { success: true };
          },
          args: [text],
        });

        if (rChatResult[0]?.result?.error) {
          result = { error: rChatResult[0].result.error, tabId: rTabId };
          break;
        }

        await new Promise(r => setTimeout(r, 500));

        // Click send
        await chrome.scripting.executeScript({
          target: { tabId: rTabId },
          func: () => {
            const sendBtn = document.querySelector('button[aria-label*="Send"], button[data-test-id="send-button"]');
            if (sendBtn) sendBtn.click();
          },
        });

        // 7. If Deep Research, wait for plan then click "Start research"
        let drPlanText = '';
        if (useDeepResearch) {
          // Deep Research shows a plan first with "Start research" / "Edit plan" buttons
          // Wait up to 45s for the plan + button to appear, then click with debugger (trusted events)
          const planStart = Date.now();
          let startClicked = false;
          while (Date.now() - planStart < 45000 && !startClicked) {
            await new Promise(r => setTimeout(r, 2000));
            // Find "Start research" button coordinates
            const planPoll = await chrome.scripting.executeScript({
              target: { tabId: rTabId },
              func: () => {
                const allButtons = Array.from(document.querySelectorAll('button'));
                const startBtn = allButtons.find(b => {
                  const text = (b.textContent || '').trim().toLowerCase();
                  return text.includes('start research')
                    && b.getBoundingClientRect().width > 0 && !b.disabled;
                });
                const planElements = [];
                document.querySelectorAll('*').forEach(el => {
                  if (el.children.length > 0) return;
                  const text = (el.textContent || '').trim();
                  if (text.length < 3 || text.length > 300) return;
                  const lower = text.toLowerCase();
                  if (lower.includes('step') || lower.includes('search') || lower.includes('plan')
                      || lower.includes('research')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) planElements.push(text.substring(0, 150));
                  }
                });
                if (startBtn) {
                  const rect = startBtn.getBoundingClientRect();
                  return {
                    found: true,
                    x: rect.left + rect.width / 2,
                    y: rect.top + rect.height / 2,
                    plan: planElements,
                  };
                }
                return { found: false, plan: planElements };
              },
            });
            const pr = planPoll[0]?.result || {};
            if (pr.found) {
              // Click using MAIN world execution (Angular Zone.js needs MAIN world)
              const clickRes = await chrome.scripting.executeScript({
                target: { tabId: rTabId },
                world: 'MAIN',
                func: () => {
                  const buttons = document.querySelectorAll('button');
                  for (const b of buttons) {
                    if (b.textContent.trim().toLowerCase().includes('start research') && !b.disabled) {
                      b.scrollIntoView({ block: 'center' });
                      b.focus();
                      b.click();
                      return true;
                    }
                  }
                  return false;
                },
              });
              if (clickRes[0]?.result) {
                startClicked = true;
                drPlanText = (pr.plan || []).join(' | ');
                console.log('[Matrix] Deep Research: clicked Start research via MAIN world');
              } else {
                // Fallback: debugger
                try {
                  await chrome.debugger.attach({ tabId: rTabId }, '1.3');
                  const x = Math.round(pr.x);
                  const y = Math.round(pr.y);
                  await chrome.debugger.sendCommand({ tabId: rTabId }, 'Input.dispatchMouseEvent', {
                    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
                  });
                  await new Promise(r => setTimeout(r, 50));
                  await chrome.debugger.sendCommand({ tabId: rTabId }, 'Input.dispatchMouseEvent', {
                    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
                  });
                  await new Promise(r => setTimeout(r, 100));
                  await chrome.debugger.detach({ tabId: rTabId });
                  startClicked = true;
                  drPlanText = (pr.plan || []).join(' | ');
                  console.log('[Matrix] Deep Research: clicked Start research via debugger at', Math.round(pr.x), Math.round(pr.y));
                } catch (dbgErr) {
                  try { await chrome.debugger.detach({ tabId: rTabId }); } catch (_) {}
                  console.log('[Matrix] Deep Research: debugger click failed:', dbgErr.message);
                }
              }
            }
          }
          if (!startClicked) {
            console.log('[Matrix] Deep Research: no Start research button found, proceeding with wait...');
          }
          // Give DR time to begin after clicking start
          await new Promise(r => setTimeout(r, 3000));
        }

        // 8. Wait for response (reuse gemini_wait logic inline)
        // Deep Research can take much longer, so use the full timeout
        const rStart = Date.now();
        let rLastText = '';
        let rStable = 0;
        let rFinal = '';
        let rSawGen = false;

        while (Date.now() - rStart < timeout) {
          await new Promise(r => setTimeout(r, useDeepResearch ? 2000 : 500));
          const rPoll = await chrome.scripting.executeScript({
            target: { tabId: rTabId },
            func: (bc, bt, isDR) => {
              const spinner = document.querySelector('mat-mdc-progress-spinner.mdc-circular-progress--indeterminate');
              let spinnerActive = false;
              if (spinner) {
                const rect = spinner.getBoundingClientRect();
                spinnerActive = rect.top > 100 && rect.top < window.innerHeight && rect.bottom > 0;
              }
              const stopBtn = document.querySelector('button[aria-label="Stop generating"], button[aria-label*="Stop"]');
              const streaming = document.querySelector('.streaming-indicator, [data-streaming="true"]');
              const isGenerating = spinnerActive || !!stopBtn || !!streaming;

              // For Deep Research, check for active progress indicators
              let drActive = false;
              if (isDR) {
                // DR progress shows specific patterns: "Researched N websites", "Analyzing results..."
                // Look for progress elements with specific patterns
                const progressEls = document.querySelectorAll('[class*="progress"], [class*="status"], [class*="research"]');
                for (const el of progressEls) {
                  const t = (el.textContent || '').trim();
                  if (t.match(/Researched?\s+\d+\s+websites?/i) || t.includes('Analyzing results')
                      || t.includes('Create your report') || t.includes('Searching')) {
                    drActive = true;
                    break;
                  }
                }
                // Also check for any visible spinner/loading animations
                if (!drActive) {
                  const animations = document.querySelectorAll('[class*="spinner"], [class*="loading"], [class*="progress-bar"]');
                  for (const el of animations) {
                    if (el.getBoundingClientRect().width > 0) { drActive = true; break; }
                  }
                }
              }

              const responses = document.querySelectorAll('MESSAGE-CONTENT, message-content, [data-message-id], .model-response-text');
              const count = responses.length;
              let text = '';
              if (count > 0) text = (responses[count - 1].textContent || responses[count - 1].innerText || '').trim();
              const hasNew = count > bc || (text.length > 20 && text !== bt);
              return {
                isGenerating: isGenerating || drActive,
                text: text.substring(0, 30000),
                textLen: text.length,
                hasNew,
                drActive,
              };
            },
            args: [rBaseData.count, rBaseData.text, useDeepResearch],
          });

          const p = rPoll[0]?.result || {};
          if (p.isGenerating) rSawGen = true;
          const ct = p.text || '';
          if (p.hasNew && ct.length > 20) {
            if (ct === rLastText && !p.isGenerating) {
              rStable++;
              if (rStable >= (useDeepResearch ? 5 : 3)) { rFinal = ct; break; }
            } else { rStable = 0; rLastText = ct; }
          }
        }

        result = {
          success: rFinal.length > 0,
          text: rFinal,
          tabId: rTabId,
          model: model || 'default',
          deepResearch: useDeepResearch,
          elapsed: Date.now() - rStart,
        };
        if (drPlanText) result.plan = drPlanText;
        if (!rFinal) result.error = 'Timeout waiting for Gemini response';
        break;
      }

      // ---- Ping / Health ----

      case 'ping': {
        result = { success: true, pong: true, version: VERSION, uptime: Date.now() - connectedAt };
        break;
      }

      default:
        result = { error: 'Unknown action: ' + cmd.action };
    }
  } catch (err) {
    result = { error: err.message };
  }

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
