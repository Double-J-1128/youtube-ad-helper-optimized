// YouTube 广告位助手 - popup 控制器
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const Core = globalThis.AdHelperCore;
  const elements = {
    interval: document.getElementById('interval'),
    startTime: document.getElementById('startTime'),
    endBuffer: document.getElementById('endBuffer'),
    tier1: document.getElementById('tier1'),
    tier2: document.getElementById('tier2'),
    tier3: document.getElementById('tier3'),
    start: document.getElementById('startBtn'),
    stop: document.getElementById('stopBtn'),
    status: document.getElementById('status'),
    preview: document.getElementById('preview'),
    progress: document.getElementById('progress'),
    autoMode: document.getElementById('autoModeBtn'),
    manualMode: document.getElementById('manualModeBtn'),
    autoPanel: document.getElementById('autoPanel'),
    manualPanel: document.getElementById('manualPanel')
  };

  let mode = 'auto';
  let activeTabId = null;
  let currentDuration = null;
  let statusTimer = null;

  initialize();

  async function initialize() {
    bindEvents();
    await loadSettings();
    await refreshPageState();
    updatePreview();
  }

  function bindEvents() {
    elements.autoMode.addEventListener('click', () => setMode('auto'));
    elements.manualMode.addEventListener('click', () => setMode('manual'));
    elements.start.addEventListener('click', handleStart);
    elements.stop.addEventListener('click', handleStop);

    for (const input of settingsInputs()) {
      input.addEventListener('input', updatePreview);
      input.addEventListener('change', saveSettings);
    }

    chrome.runtime.onMessage.addListener((message, sender) => {
      if (sender.tab?.id && activeTabId && sender.tab.id !== activeTabId) return;
      if (message.type === 'statusUpdate') {
        showStatus(message.text, message.status, false);
        renderProgress(message.state);
      } else if (message.type === 'stopped') {
        setRunning(false);
        renderProgress(message.state);
      }
    });
  }

  async function loadSettings() {
    const defaults = {
      interval: '300',
      startTime: '120',
      endBuffer: '60',
      tier1: '300',
      tier2: '480',
      tier3: '600',
      mode: 'auto'
    };
    const data = await storageGet(Object.keys(defaults));
    for (const [key, fallback] of Object.entries(defaults)) {
      if (key === 'mode') continue;
      elements[key].value = data[key] ?? fallback;
    }
    setMode(data.mode === 'manual' ? 'manual' : 'auto', false);
  }

  function saveSettings() {
    chrome.storage.sync.set({
      interval: elements.interval.value,
      startTime: elements.startTime.value,
      endBuffer: elements.endBuffer.value,
      tier1: elements.tier1.value,
      tier2: elements.tier2.value,
      tier3: elements.tier3.value,
      mode
    });
  }

  function setMode(nextMode, persist = true) {
    mode = nextMode === 'manual' ? 'manual' : 'auto';
    const auto = mode === 'auto';
    elements.autoMode.classList.toggle('active', auto);
    elements.manualMode.classList.toggle('active', !auto);
    elements.autoMode.setAttribute('aria-pressed', String(auto));
    elements.manualMode.setAttribute('aria-pressed', String(!auto));
    elements.autoPanel.classList.toggle('hidden', !auto);
    elements.manualPanel.classList.toggle('hidden', auto);
    if (persist) saveSettings();
    updatePreview();
  }

  async function refreshPageState() {
    try {
      const tab = await getActiveTab();
      activeTabId = tab?.id ?? null;
      if (!tab || !Core.isStudioUrl(tab.url)) {
        setRunning(false);
        showStatus('请先打开 YouTube Studio 的广告位编辑页面', 'error', false);
        return;
      }

      const response = await sendTabMessage(tab.id, { action: 'checkStatus' });
      currentDuration = response.duration;
      setRunning(Boolean(response.state?.running));
      renderProgress(response.state);

      if (!response.editorReady) {
        showStatus('尚未检测到广告位编辑器，请打开“管理广告位”', 'info', false);
      } else if (response.state?.lastMessage && response.state.lastMessage !== '尚未运行') {
        showStatus(response.state.lastMessage, response.state.lastStatus || 'info', false);
      }
    } catch (_error) {
      setRunning(false);
      showStatus('无法连接页面，请刷新 YouTube Studio 后重试', 'error', false);
    }
  }

  async function handleStart() {
    const config = readConfig();
    if (!config.ok) {
      showStatus(config.error, 'error');
      return;
    }

    elements.start.disabled = true;
    showStatus('正在检查页面…', 'info', false);

    try {
      const tab = await getActiveTab();
      if (!tab || !Core.isStudioUrl(tab.url)) throw new Error('请先打开 YouTube Studio');
      activeTabId = tab.id;

      const inspection = await sendTabMessage(tab.id, { action: 'inspect' });
      currentDuration = inspection.duration;
      if (!inspection.editorReady) throw new Error('请先打开“管理广告位”页面');
      if (!Number.isFinite(currentDuration)) throw new Error('视频尚未加载，请稍后重试');

      const interval = Core.selectInterval(currentDuration, config.value);
      const plan = Core.buildSchedule({
        duration: currentDuration,
        startTime: config.value.startTime,
        interval,
        endBuffer: config.value.endBuffer
      });
      if (!plan.ok) throw new Error(plan.error);

      if (plan.times.length > 20) {
        const confirmed = window.confirm(`将尝试添加 ${plan.times.length} 个广告位，是否继续？`);
        if (!confirmed) {
          setRunning(false);
          showStatus('已取消启动', 'info');
          return;
        }
      }

      saveSettings();
      const response = await sendTabMessage(tab.id, { action: 'start', ...config.value });
      if (!response?.ok) throw new Error(response?.error || '页面拒绝了启动请求');

      setRunning(true);
      renderProgress(response.state);
      showStatus(`已启动：计划 ${response.planned} 个广告位`, 'success', false);
    } catch (error) {
      setRunning(false);
      showStatus(error.message || String(error), 'error', false);
    }
  }

  async function handleStop() {
    elements.stop.disabled = true;
    try {
      const tab = await getActiveTab();
      if (tab?.id) await sendTabMessage(tab.id, { action: 'stop' });
      setRunning(false);
      showStatus('任务已停止', 'info');
    } catch (_error) {
      setRunning(false);
      showStatus('任务已停止，页面连接已断开', 'info');
    }
  }

  function readConfig() {
    return Core.normalizeConfig({
      mode,
      interval: elements.interval.value,
      startTime: elements.startTime.value,
      endBuffer: elements.endBuffer.value,
      tier1: elements.tier1.value,
      tier2: elements.tier2.value,
      tier3: elements.tier3.value
    });
  }

  function updatePreview() {
    if (!Core || !elements.preview) return;
    const config = readConfig();
    if (!config.ok) {
      elements.preview.textContent = config.error;
      return;
    }
    if (!Number.isFinite(currentDuration)) {
      elements.preview.textContent = '打开广告位编辑器后显示预计数量';
      return;
    }

    const interval = Core.selectInterval(currentDuration, config.value);
    const plan = Core.buildSchedule({
      duration: currentDuration,
      startTime: config.value.startTime,
      interval,
      endBuffer: config.value.endBuffer
    });
    elements.preview.textContent = plan.ok
      ? `视频 ${Core.formatClock(currentDuration)} · 预计 ${plan.times.length} 个 · 间隔 ${Core.formatClock(interval)}`
      : plan.error;
  }

  function renderProgress(state) {
    if (!state || (!state.running && !state.startedAt)) {
      elements.progress.textContent = '';
      return;
    }
    const current = state.currentTime === null || state.currentTime === undefined
      ? ''
      : ` · 当前 ${Core.formatClock(state.currentTime)}`;
    elements.progress.textContent = `成功 ${state.completed || 0}/${state.planned || 0} · 跳过 ${state.skipped || 0} · 失败 ${state.failed || 0}${current}`;
  }

  function setRunning(running) {
    elements.start.disabled = running;
    elements.stop.disabled = !running;
    for (const input of settingsInputs()) input.disabled = running;
    elements.autoMode.disabled = running;
    elements.manualMode.disabled = running;
  }

  function showStatus(text, type = 'info', autoHide = true) {
    if (statusTimer) clearTimeout(statusTimer);
    elements.status.textContent = text;
    elements.status.className = `status ${type}`;
    elements.status.hidden = false;
    if (autoHide) {
      statusTimer = setTimeout(() => {
        elements.status.hidden = true;
      }, type === 'error' ? 6000 : 4000);
    }
  }

  function settingsInputs() {
    return [elements.interval, elements.startTime, elements.endBuffer, elements.tier1, elements.tier2, elements.tier3];
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(tabs[0]);
      });
    });
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response) reject(new Error('页面没有返回响应'));
        else resolve(response);
      });
    });
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (data) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data);
      });
    });
  }
});
