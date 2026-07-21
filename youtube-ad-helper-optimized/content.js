// YouTube 广告位助手 - 页面执行逻辑
(() => {
  'use strict';

  const Core = globalThis.AdHelperCore;
  if (!Core) {
    console.error('[YouTube广告位助手] core.js 未加载');
    return;
  }

  const SELECTORS = {
    timestampBox: [
      'ytve-toolbar ytcp-media-timestamp-input',
      'ytcp-media-timestamp-input'
    ],
    insertButton: [
      '[test-id="insert-ad-slot"] button',
      '[test-id="insert-ad-slot"][role="button"]',
      'button[aria-label="插入广告位"]',
      'button[aria-label="Insert ad slot"]'
    ],
    slotItems: [
      '[test-id="ad-slot"]',
      '[test-id^="ad-slot-"]',
      'ytve-ad-break',
      'ytve-ad-slot'
    ]
  };

  const LIMITS = {
    durationWaitMs: 5000,
    playheadWaitMs: 1600,
    insertWaitMs: 1800,
    retryCount: 3,
    retryBaseMs: 300
  };

  const task = {
    running: false,
    runId: 0,
    startedAt: null,
    duration: null,
    interval: null,
    schedule: [],
    completed: 0,
    skipped: 0,
    failed: 0,
    currentTime: null,
    lastMessage: '尚未运行',
    lastStatus: 'info'
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.action !== 'string') return false;

    if (message.action === 'start') {
      startAutoInsert(message)
        .then(sendResponse)
        .catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          sendStatus(text, 'error');
          sendResponse({ ok: false, error: text });
        });
      return true;
    }

    if (message.action === 'stop') {
      const stopped = stopAutoInsert('用户已停止任务', 'info');
      sendResponse({ ok: true, stopped, state: snapshot() });
      return false;
    }

    if (message.action === 'checkStatus' || message.action === 'inspect') {
      sendResponse({
        ok: true,
        state: snapshot(),
        duration: getVideoDuration(),
        editorReady: Boolean(findPlayheadBox() && findInsertButton())
      });
      return false;
    }

    return false;
  });

  async function startAutoInsert(options) {
    if (task.running) {
      return { ok: false, error: '任务已经在运行中', state: snapshot() };
    }

    const config = Core.normalizeConfig(options);
    if (!config.ok) {
      return { ok: false, error: config.error };
    }

    const duration = await waitForVideoDuration(LIMITS.durationWaitMs);
    if (duration === null) {
      return { ok: false, error: '无法读取视频时长，请等待视频加载后重试' };
    }

    if (duration < Core.MIN_VIDEO_DURATION_SECONDS) {
      return { ok: false, error: '视频不足 8 分钟，不符合 YouTube 中贴片广告时长要求' };
    }

    if (!findPlayheadBox() || !findInsertButton()) {
      return { ok: false, error: '未找到广告位编辑器，请先打开“管理广告位”页面' };
    }

    const interval = Core.selectInterval(duration, config.value);
    const plan = Core.buildSchedule({
      duration,
      startTime: config.value.startTime,
      interval,
      endBuffer: config.value.endBuffer,
      maxSlots: Core.MAX_SLOTS
    });

    if (!plan.ok) {
      return { ok: false, error: plan.error };
    }

    const existing = collectExistingAdTimes();
    const schedule = plan.times.filter(
      (time) => !existing.some((known) => Math.abs(known - time) <= 1)
    );
    const preSkipped = plan.times.length - schedule.length;

    if (schedule.length === 0) {
      return {
        ok: false,
        error: preSkipped > 0 ? '计划中的广告位均已存在' : '当前设置没有可插入的时间点'
      };
    }

    task.running = true;
    task.runId += 1;
    task.startedAt = Date.now();
    task.duration = duration;
    task.interval = interval;
    task.schedule = schedule;
    task.completed = 0;
    task.skipped = preSkipped;
    task.failed = 0;
    task.currentTime = null;

    const runId = task.runId;
    sendStatus(
      `任务已启动：计划 ${schedule.length} 个，间隔 ${Core.formatClock(interval)}`,
      'success'
    );

    runSchedule(runId).catch((error) => {
      if (!isCurrentRun(runId)) return;
      task.failed += 1;
      finishRun(`任务异常终止：${error.message}`, 'error');
    });

    return {
      ok: true,
      duration,
      interval,
      planned: schedule.length,
      skippedExisting: preSkipped,
      state: snapshot()
    };
  }

  async function runSchedule(runId) {
    for (const targetTime of task.schedule) {
      if (!isCurrentRun(runId)) return;
      task.currentTime = targetTime;
      sendStatus(
        `正在处理 ${task.completed + task.failed + 1}/${task.schedule.length}：${Core.formatClock(targetTime)}`,
        'info'
      );

      const result = await insertWithRetry(targetTime, runId);
      if (!isCurrentRun(runId)) return;

      if (result.ok) {
        task.completed += 1;
        sendStatus(`已提交 ${Core.formatClock(result.actual)} 的广告位`, 'success');
      } else {
        task.failed += 1;
        finishRun(`在 ${Core.formatClock(targetTime)} 失败：${result.error}`, 'error');
        return;
      }
    }

    if (isCurrentRun(runId)) {
      finishRun(
        `处理完成：成功 ${task.completed}，跳过 ${task.skipped}。请在 YouTube Studio 中点击“继续/保存”`,
        'success'
      );
    }
  }

  async function insertWithRetry(targetTime, runId) {
    let lastError = '未知错误';

    for (let attempt = 1; attempt <= LIMITS.retryCount; attempt += 1) {
      if (!isCurrentRun(runId)) return { ok: false, error: '任务已取消' };

      try {
        const result = await insertAtTime(targetTime, runId);
        if (result.ok) return result;
        lastError = result.error;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < LIMITS.retryCount) {
        await delay(LIMITS.retryBaseMs * attempt, runId);
      }
    }

    return { ok: false, error: `${lastError}（已重试 ${LIMITS.retryCount} 次）` };
  }

  async function insertAtTime(targetTime, runId) {
    const found = findPlayheadBox();
    if (!found) return { ok: false, error: '未找到播放头时间输入框' };

    const { box, input } = found;
    const segments = detectSegments(box);
    setInputValue(input, Core.formatTime(targetTime, segments));

    const actual = await waitForPlayhead(box, targetTime, runId);
    if (actual === null) {
      return { ok: false, error: '播放头未到达目标时间' };
    }

    const button = findInsertButton();
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      return { ok: false, error: '插入广告位按钮不可用' };
    }

    const beforeCount = countKnownSlots();
    button.click();
    const confirmed = await waitForSlotChange(beforeCount, runId);

    if (!confirmed && !isCurrentRun(runId)) {
      return { ok: false, error: '任务已取消' };
    }

    // YouTube 的内部 DOM 可能没有暴露广告位列表；此时只能确认点击已提交。
    return { ok: true, actual, confirmed };
  }

  function stopAutoInsert(message = '任务已停止', status = 'info') {
    if (!task.running) return false;
    task.running = false;
    task.runId += 1;
    task.currentTime = null;
    sendStatus(message, status);
    notifyPopup({ type: 'stopped', state: snapshot() });
    return true;
  }

  function finishRun(message, status) {
    task.running = false;
    task.currentTime = null;
    sendStatus(message, status);
    notifyPopup({ type: 'stopped', state: snapshot() });
  }

  function snapshot() {
    return {
      running: task.running,
      startedAt: task.startedAt,
      duration: task.duration,
      interval: task.interval,
      planned: task.schedule.length,
      completed: task.completed,
      skipped: task.skipped,
      failed: task.failed,
      currentTime: task.currentTime,
      lastMessage: task.lastMessage,
      lastStatus: task.lastStatus
    };
  }

  function getVideoDuration() {
    const video = document.querySelector('ytcp-html5-video-source video, video#video, video');
    if (!video) return null;
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

    const source = video.currentSrc || video.src || '';
    const match = source.match(/[?&]dur=([\d.]+)/);
    if (!match) return null;
    const duration = Number.parseFloat(match[1]);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  async function waitForVideoDuration(timeoutMs) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const duration = getVideoDuration();
      if (duration !== null) return duration;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return getVideoDuration();
  }

  function findPlayheadBox() {
    const box = queryFirst(SELECTORS.timestampBox);
    if (!box) return null;
    const input = box.querySelector('input');
    return input ? { box, input } : null;
  }

  function findInsertButton() {
    const exact = queryFirst(SELECTORS.insertButton);
    if (exact) return exact;

    for (const element of document.querySelectorAll('button, [role="button"]')) {
      const text = (element.textContent || '').trim();
      if (text.includes('插入广告位') || text.includes('Insert ad slot')) return element;
    }
    return null;
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function detectSegments(box) {
    const display = box.querySelector('#display');
    const text = display ? (display.textContent || '').trim() : '';
    return text.split(':').length === 4 ? 4 : 3;
  }

  function readBoxTime(box) {
    const candidates = [
      box.querySelector('#display')?.textContent,
      box.querySelector('input')?.value,
      box.querySelector('#container')?.getAttribute('aria-label')
    ];

    for (const value of candidates) {
      const parsed = Core.parseAnyTime(value);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  async function waitForPlayhead(box, targetTime, runId) {
    const started = performance.now();
    while (performance.now() - started < LIMITS.playheadWaitMs) {
      if (!isCurrentRun(runId)) return null;
      const actual = readBoxTime(box);
      if (actual !== null && Math.abs(actual - targetTime) <= 1) return actual;
      await delay(50, runId);
    }
    return null;
  }

  function setInputValue(input, value) {
    input.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;

    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value
    }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true
    }));
  }

  function collectExistingAdTimes() {
    const times = [];
    for (const selector of SELECTORS.slotItems) {
      for (const element of document.querySelectorAll(selector)) {
        const candidates = [
          element.textContent,
          element.getAttribute('aria-label'),
          element.querySelector?.('[aria-label]')?.getAttribute('aria-label')
        ];
        for (const value of candidates) {
          const parsed = Core.parseAnyTime(value);
          if (parsed !== null && !times.some((time) => Math.abs(time - parsed) <= 1)) {
            times.push(parsed);
            break;
          }
        }
      }
    }
    return times;
  }

  function countKnownSlots() {
    const elements = new Set();
    for (const selector of SELECTORS.slotItems) {
      document.querySelectorAll(selector).forEach((element) => elements.add(element));
    }
    return elements.size;
  }

  async function waitForSlotChange(beforeCount, runId) {
    if (beforeCount === 0) {
      await delay(350, runId);
      return false;
    }

    const started = performance.now();
    while (performance.now() - started < LIMITS.insertWaitMs) {
      if (!isCurrentRun(runId)) return false;
      if (countKnownSlots() > beforeCount) return true;
      await delay(100, runId);
    }
    return false;
  }

  function delay(ms, runId) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(isCurrentRun(runId)), ms);
    });
  }

  function isCurrentRun(runId) {
    return task.running && task.runId === runId;
  }

  function sendStatus(text, status) {
    task.lastMessage = text;
    task.lastStatus = status;
    console.log(`[YouTube广告位助手][${status}] ${text}`);
    notifyPopup({ type: 'statusUpdate', text, status, state: snapshot() });
  }

  function notifyPopup(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (_error) {
      // popup 关闭时无需处理。
    }
  }
})();
