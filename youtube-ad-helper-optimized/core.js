// YouTube 广告位助手 - 可测试的纯逻辑
((root, factory) => {
  const api = factory();
  root.AdHelperCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis, () => {
  'use strict';

  const MIN_VIDEO_DURATION_SECONDS = 8 * 60;
  const DEFAULT_END_BUFFER_SECONDS = 60;
  const MAX_SLOTS = 100;

  function toInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function normalizeConfig(input = {}) {
    const mode = input.mode === 'manual' ? 'manual' : 'auto';
    const startTime = toInteger(input.startTime);
    if (startTime === null || startTime < 0) {
      return { ok: false, error: '开始时间必须是非负整数' };
    }

    const endBufferCandidate = input.endBuffer ?? DEFAULT_END_BUFFER_SECONDS;
    const endBuffer = toInteger(endBufferCandidate);
    if (endBuffer === null || endBuffer < 0) {
      return { ok: false, error: '结尾安全距离必须是非负整数' };
    }

    const value = { mode, startTime, endBuffer };
    const keys = mode === 'auto' ? ['tier1', 'tier2', 'tier3'] : ['interval'];
    for (const key of keys) {
      const parsed = toInteger(input[key]);
      if (parsed === null || parsed <= 0) {
        return { ok: false, error: '间隔时间必须是正整数' };
      }
      value[key] = parsed;
    }
    return { ok: true, value };
  }

  function selectInterval(duration, config) {
    if (config.mode === 'manual') return config.interval;
    if (duration <= 1800) return config.tier1;
    if (duration < 3600) return config.tier2;
    return config.tier3;
  }

  function buildSchedule({ duration, startTime, interval, endBuffer = DEFAULT_END_BUFFER_SECONDS, maxSlots = MAX_SLOTS }) {
    if (![duration, startTime, interval, endBuffer, maxSlots].every(Number.isFinite)) {
      return { ok: false, error: '生成计划所需的参数无效', times: [] };
    }
    if (duration < MIN_VIDEO_DURATION_SECONDS) {
      return { ok: false, error: '视频不足 8 分钟', times: [] };
    }
    if (startTime < 0 || interval <= 0 || endBuffer < 0 || maxSlots <= 0) {
      return { ok: false, error: '时间参数超出允许范围', times: [] };
    }

    const lastAllowed = Math.floor(duration - endBuffer);
    if (startTime > lastAllowed) {
      return { ok: false, error: '开始时间已进入视频结尾安全区', times: [] };
    }

    const times = [];
    for (let time = startTime; time <= lastAllowed; time += interval) {
      if (times.length >= maxSlots) {
        return { ok: false, error: `计划超过 ${maxSlots} 个广告位，请增大间隔`, times };
      }
      times.push(time);
    }

    return times.length > 0
      ? { ok: true, times, lastAllowed }
      : { ok: false, error: '当前设置没有可插入的时间点', times: [] };
  }

  function parseDisplayTime(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{1,4}):(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;

    const parts = match.slice(1).filter((part) => part !== undefined).map(Number);
    if (parts.some((part) => !Number.isInteger(part))) return null;

    if (parts.length === 4) {
      const [hours, minutes, seconds] = parts;
      if (minutes > 59 || seconds > 59) return null;
      return hours * 3600 + minutes * 60 + seconds;
    }

    const [minutes, seconds] = parts;
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  function parseLabelTime(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const hours = matchUnit(value, /(?:小时|hours?|hrs?)/i);
    const minutes = matchUnit(value, /(?:分钟|minutes?|mins?)/i);
    const seconds = matchUnit(value, /(?:秒|seconds?|secs?)/i);
    if (hours === null && minutes === null && seconds === null) return null;
    return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
  }

  function matchUnit(value, unitPattern) {
    const match = value.match(new RegExp(`(\\d+)\\s*${unitPattern.source}`, unitPattern.flags));
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function parseAnyTime(value) {
    if (typeof value !== 'string') return null;
    const clock = value.match(/\d{1,4}:\d{2}:\d{2}(?::\d{2})?/);
    if (clock) {
      const parsed = parseDisplayTime(clock[0]);
      if (parsed !== null) return parsed;
    }
    return parseLabelTime(value);
  }

  function formatTime(totalSeconds, segments = 3) {
    const total = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (segments === 4) return `${hours}:${pad(minutes)}:${pad(seconds)}:00`;
    return `${pad(Math.floor(total / 60))}:${pad(seconds)}:00`;
  }

  function formatClock(totalSeconds) {
    const total = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function isStudioUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'studio.youtube.com';
    } catch (_error) {
      return false;
    }
  }

  return Object.freeze({
    MIN_VIDEO_DURATION_SECONDS,
    DEFAULT_END_BUFFER_SECONDS,
    MAX_SLOTS,
    normalizeConfig,
    selectInterval,
    buildSchedule,
    parseDisplayTime,
    parseLabelTime,
    parseAnyTime,
    formatTime,
    formatClock,
    isStudioUrl
  });
});
