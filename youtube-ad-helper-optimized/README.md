# YouTube 广告位助手（优化版）

这是一个 Chrome/Edge Manifest V3 扩展，用于在 YouTube Studio 的“管理广告位”页面按时间计划批量添加中贴片广告位。

## 安装

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录。
5. 如果 YouTube Studio 已经打开，请刷新该标签页，让 content script 生效。

## 使用

1. 在桌面端 YouTube Studio 打开视频的获利设置。
2. 进入“管理广告位”页面，等待视频和编辑器加载完成。
3. 打开扩展，选择分档等间隔或固定间隔。
4. 检查预计广告位数量、首个时间点和结尾安全距离。
5. 点击“开始插入”，等待进度完成。
6. 回到 YouTube Studio 检查广告位，并点击“继续/保存”。

广告位只是允许 YouTube 在该位置投放广告，不保证每个广告位都会实际展示广告。建议结合自然停顿、画面转换和 YouTube Studio 的质量反馈调整位置。

## 相比原版的主要改进

- popup 等待页面确认后才显示任务已启动。
- 使用目标时间的双向误差验证，避免在错误播放头位置插入。
- 预先生成有限计划，不再通过无限递归运行。
- 每个时间点最多重试三次，并逐条显示进度。
- 设置 8 分钟门槛、结尾安全区和最多 100 个广告位的限制。
- 尝试识别已有广告位并跳过重复时间点。
- 使用更可靠的 input value setter，移除 `execCommand`。
- 减少对中文文案的依赖，兼容部分英文按钮和时间标签。
- 移除全页面 MutationObserver 和高频 `innerText` 扫描。
- 默认间隔调整为 5/8/10 分钟，并增加预计数量预览。
- 改进错误处理、状态恢复和可访问性。

## 已知限制

- YouTube Studio 没有为这个编辑流程提供稳定的公开 DOM 接口，页面更新后选择器仍可能需要调整。
- 某些页面版本不会公开广告位列表节点，此时扩展只能确认点击已提交，无法百分之百确认列表数量已经增加。
- 扩展不会自动点击 YouTube Studio 的“继续/保存”。
- 固定间隔不等于自然断点分析，插入完成后仍应人工复核。

## 本地测试

需要 Node.js 18 或更高版本：

```powershell
node .\tests\core.test.js
node .\tests\package.test.js
node --check .\core.js
node --check .\content.js
node --check .\popup.js
```

扩展不发送网络请求，只在 `chrome.storage.sync` 中保存间隔、开始时间和模式等非敏感设置。
