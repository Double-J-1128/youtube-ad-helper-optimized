// YouTube 广告位助手 - 任务期间锁定目标标签页与浏览器窗口
(() => {
  'use strict';

  const STORAGE_KEY = 'youtubeAdHelperFocusLock';
  const EMPTY_LOCK = Object.freeze({
    enabled: false,
    tabId: null,
    windowId: null
  });

  let focusLock = { ...EMPTY_LOCK };
  let restoring = false;
  let restoreTimer = null;
  const initialized = restoreSavedLock();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') return false;

    if (message.action === 'focusLock:start') {
      initialized
        .then(async () => {
          const tab = sender.tab;
          if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
            sendResponse({ ok: false, error: '无法识别目标标签页' });
            return;
          }

          focusLock = {
            enabled: true,
            tabId: tab.id,
            windowId: tab.windowId
          };
          await saveLock();
          scheduleRestore(0);
          sendResponse({ ok: true });
        })
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message.action === 'focusLock:stop') {
      initialized
        .then(async () => {
          if (!sender.tab?.id || sender.tab.id === focusLock.tabId) {
            await clearLock();
          }
          sendResponse({ ok: true });
        })
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message.action === 'focusLock:status') {
      initialized.then(() => sendResponse({ ok: true, focusLock: { ...focusLock } }));
      return true;
    }

    return false;
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    initialized.then(() => {
      if (!focusLock.enabled) return;
      if (activeInfo.tabId !== focusLock.tabId || activeInfo.windowId !== focusLock.windowId) {
        scheduleRestore(0);
      }
    });
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    initialized.then(() => {
      if (!focusLock.enabled) return;
      if (windowId !== chrome.windows.WINDOW_ID_NONE && windowId !== focusLock.windowId) {
        scheduleRestore(0);
      }
    });
  });

  chrome.windows.onCreated.addListener(() => {
    initialized.then(() => {
      if (focusLock.enabled) scheduleRestore(60);
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    initialized.then(() => {
      if (!focusLock.enabled || tabId !== focusLock.tabId) return;
      if (changeInfo.status === 'loading' || (changeInfo.url && !isStudioUrl(changeInfo.url))) {
        clearLock();
      }
    });
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    initialized.then(() => {
      if (focusLock.enabled && tabId === focusLock.tabId) clearLock();
    });
  });

  chrome.windows.onRemoved.addListener((windowId) => {
    initialized.then(() => {
      if (focusLock.enabled && windowId === focusLock.windowId) clearLock();
    });
  });

  function scheduleRestore(delayMs) {
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      restoreTargetFocus();
    }, delayMs);
  }

  async function restoreTargetFocus() {
    await initialized;
    if (!focusLock.enabled || restoring) return;

    restoring = true;
    try {
      const tab = await getTab(focusLock.tabId);
      if (!tab || !isStudioUrl(tab.url || '')) {
        await clearLock();
        return;
      }

      if (tab.windowId !== focusLock.windowId) {
        focusLock.windowId = tab.windowId;
        await saveLock();
      }

      await updateWindow(focusLock.windowId, { focused: true });
      await updateTab(focusLock.tabId, { active: true });
      try {
        chrome.tabs.sendMessage(focusLock.tabId, { action: 'ensurePageFocus' }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_error) {
        // 页面暂时不可通信时，标签页和窗口激活仍然有效。
      }
    } catch (_error) {
      await clearLock();
    } finally {
      restoring = false;
    }
  }

  async function restoreSavedLock() {
    const area = sessionStorageArea();
    if (!area) return;
    try {
      const data = await storageGet(area, STORAGE_KEY);
      const saved = data?.[STORAGE_KEY];
      if (saved?.enabled && Number.isInteger(saved.tabId) && Number.isInteger(saved.windowId)) {
        focusLock = {
          enabled: true,
          tabId: saved.tabId,
          windowId: saved.windowId
        };
      }
    } catch (_error) {
      focusLock = { ...EMPTY_LOCK };
    }
  }

  async function saveLock() {
    const area = sessionStorageArea();
    if (!area) return;
    await storageSet(area, { [STORAGE_KEY]: focusLock });
  }

  async function clearLock() {
    focusLock = { ...EMPTY_LOCK };
    if (restoreTimer !== null) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
    const area = sessionStorageArea();
    if (area) await storageRemove(area, STORAGE_KEY);
  }

  function sessionStorageArea() {
    return chrome.storage?.session || null;
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(tab);
      });
    });
  }

  function updateTab(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tab);
      });
    });
  }

  function updateWindow(windowId, updateInfo) {
    return new Promise((resolve, reject) => {
      chrome.windows.update(windowId, updateInfo, (window) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(window);
      });
    });
  }

  function storageGet(area, key) {
    return new Promise((resolve, reject) => {
      area.get(key, (data) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data);
      });
    });
  }

  function storageSet(area, value) {
    return new Promise((resolve, reject) => {
      area.set(value, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function storageRemove(area, key) {
    return new Promise((resolve, reject) => {
      area.remove(key, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function isStudioUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'studio.youtube.com';
    } catch (_error) {
      return false;
    }
  }
})();
