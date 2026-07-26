# 弹幕性能：桌面卡顿分析与优化

> 日期：2026-07-26  
> 相关代码：`apps/web/src/player/media/canvas-danmaku.ts`  
> 前置：Canvas 媒体时间引擎已替换 `@ironkinoko/danmaku` DOM（见 commit `18397a7`）

## 1. 现象

- **桌面**：弹幕一多明显卡顿（掉帧 / 主线程忙）
- **移动端**：同引擎下反而流畅

两端共用 `CanvasDanmaku`，**不是两套实现**。

## 2. 根因（像素预算差异）

| 因素 | 桌面 | 移动 |
|------|------|------|
| 画布面积 | 常 1280×720+，DPR 2 → 每帧 clear 数百万像素 | 小屏，像素少 |
| 字号 | 按容器宽度缩放，接近 25px 基线 | 高度曲线，约 11–18px（全屏更小） |
| 同屏上限（优化前） | 固定 **80** | 全屏 **48** |
| 每帧绘制（优化前） | 最多 80×(`strokeText` + `fillText`) | 更少、更小字 |

优化前热路径：每条在屏弹幕每帧做矢量描边+填充。桌面「大画布 × 大字 × 高并发」乘积远高于手机。

### 播放器叠层（自下而上）

1. `<video class="kz-native-video">` — MSE/HLS；音视频时间轴始终在此
2. `<canvas class="kz-sr-canvas">` — Anime4K **WebGPU**（`z-index: 1`）
3. `.kz-danmaku-layer` → `.kz-danmaku-canvas` — 弹幕 **Canvas2D**（`z-index: 2`，透明）
4. 状态层 / 控制条

弹幕与 Anime4K **不共享** GPU context；开超分时桌面是「解码 + WebGPU + 2D 弹幕」。

## 3. 已落地的优化（本轮）

文件：`apps/web/src/player/media/canvas-danmaku.ts`

### 3.1 字形缓存（核心）

- Key：`` `${fontPx}|${color}|${text}` ``
- 同文案只 `strokeText`/`fillText` **一次** 到 offscreen（或 `OffscreenCanvas`）
- 热路径每帧改为 **`drawImage(glyph)`**
- 缓存上限 256，Map 插入序近似 LRU；字号 / 有效 DPR 变化时整表清空

### 3.2 懒测量

- `reload` 不再对全列表 `measureText`
- spawn / seek 可见项时再量（独立 1×1 `measureCtx`，少污染主 ctx）

### 3.3 原地 prune

- 去掉每帧 `running.filter(...)` 分配，改为 in-place 压缩

### 3.4 桌面密度与 DPR 预算

| 常量 / 逻辑 | 作用 |
|-------------|------|
| `MAX_RUNNING = 80` | 硬上限 |
| `MAX_RUNNING_DESKTOP = 64` | 桌面 soft 目标 |
| `maxRunning()` 桌面 | `min(80, max(48, min(64, lanes*3)))` |
| `MAX_RUNNING_MOBILE_FS = 48` | 移动全屏（保持） |
| `DPR_SOFT_AREA = 1280×720` | 更大舞台把有效 DPR 往 1–1.5 压，减 clear/blit 带宽 |
| `getContext('2d', { desynchronized: true })` | 能开则开 |

媒体时间模型未改：`x = f(video.currentTime)`，暂停停 rAF，与画面同相。

## 4. 热路径成本模型（优化后）

每播放帧（`tick` → `paint`）：

| 步骤 | 复杂度 | 说明 |
|------|--------|------|
| 原地 prune `running` | O(n) | 无 filter 分配 |
| spawn 到期且未超 cap | O(due) | `ensureMeasured` + 轨道 |
| `clearRect` 整幅舞台 | 面积 × DPR | 仍可能是大头之一 |
| 每条 `drawImage(glyph)` | ≤ maxRunning | 命中缓存则纯 blit |
| 缓存未命中 | 一次栅格化 | 按 text×color×fontPx |

## 5. 若仍卡：排查顺序

1. Chrome Performance：瓶颈在弹幕 `paint`、主线程其它逻辑，还是视频 / Anime4K
2. 对比开/关 **Anime4K**：双 GPU 路径会放大卡顿
3. 再考虑产品向：按 `area` 更早丢弹、SR 开启时自动降 cap/DPR

## 6. 后续档位（Atlas / WebGL）— 分析结论

### 6.1 三档 atlas

| 档 | 做法 | 状态 |
|----|------|------|
| **A** | 每条独立 offscreen + `drawImage` | **已做**（本轮） |
| **B** | 单张大图 2D packed atlas，`drawImage(sx,sy,…)` | 未做，**性价比更高** |
| **C** | WebGL/WebGPU 四边形 + 纹理 atlas | 未做，**复杂度高** |

业界「WebGL 弹幕」通常仍是：**Canvas2D 栅格化汉字 → 上传纹理 → GPU 只平移四边形**。WebGL **不能**原生画 CJK 描边字。

### 6.2 WebGL atlas 的好处

1. 同屏 64～200 时可用少量 draw call 画完全部 quad，减少 N 次 `drawImage` 的 JS/API 开销
2. 大同屏（接近 B 站级上百条 60fps）更稳
3. 大分辨率下 GL 清屏 + 脏 quad 可能比 2D 整幅 clear 更省（取决于实现）
4. 独立 GL 层有机会更好走 GPU 合成
5. 着色器可做统一透明度等扩展；轨道逻辑仍可留 CPU

### 6.3 WebGL atlas 的坏处 / 风险

1. **复杂度陡增**：着色器、实例化、装箱、扩容、字体失效、DPR、context loss
2. **字仍靠 2D 烘焙**：冷启动大量新词时 WebGL 帮不上；受益主要在「已缓存 + 每帧移动」
3. **与 Anime4K（WebGPU）争资源**：核显上解码 + WebGPU + WebGL 可能让**视频**掉帧；移动端收益小、过热风险大
4. **兼容**：上下文失败、iOS 透明 GL 叠 video、父级 overflow/`translateZ` 与硬解黑屏需重新回归
5. **可能过度设计**：热路径已是 `drawImage`、桌面 soft cap ~64；若 `paint` 已 &lt; 2–3ms，体感无感却永久背锅
6. **无法与 WebGPU 共用 context**：一个 canvas 不能同时挂 `webgpu` 与 `webgl`/`2d`；合并等于重写整条绘制管线

### 6.4 推荐

**现在不上 WebGL。** 优先：

1. 用本轮 A 档 + Performance 验证  
2. 仍不够 → **B：2D packed atlas**，或 SR 开时降弹幕预算  
3. 明确要 100+ 同屏且 profiling 证明绘制 &gt;~4ms → 再单开 WebGL2 + 2D 烘焙 + 2D fallback  

### 6.5 若将来做 WebGL（备忘）

- 保留：媒体时间位置、透明叠加、`pointer-events: none`、无 GL 时回退 2D
- 主要改：`paint` / `getGlyph`；可抽 `DanmakuRenderer`；**不要**耦合 `anime4k.ts`
- 验证：密集弹幕 60fps；开/关 Anime4K；字体/resize/seek；iOS 全屏与 Chrome 大窗无黑屏

## 7. 相关文件

| 路径 | 角色 |
|------|------|
| `apps/web/src/player/media/canvas-danmaku.ts` | 引擎（本轮改动） |
| `apps/web/src/player/media/danmaku-utils.ts` | 字号/速度/过滤、desktop·mobile 分轨 |
| `apps/web/src/player/VideoPlayer.tsx` | 挂载 layer、`applyDanmaku` |
| `apps/web/src/player/anime4k.ts` | WebGPU 超分（独立层） |
| `apps/web/src/player/plyr-overrides.css` | `.kz-danmaku-layer` 合成 |
