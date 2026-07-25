# Aniku 项目状态

## [2026-07-26] 性能审计 P0/P1 落地

- 状态：已完成（待 push）
- 优先级：P0–P1
- 描述：续播正确性、播放热路径、Anime4K 超分可见差异、媒体/上游超时与 AbortSignal
- 涉及文件：见下方 commits
- 备注：CLAUDE.md 为用户协作规则改动，未纳入产品 commit

### P0 完成
- 续播 resumePosition state + sourceUrl + resumeDone 成功后标记
- auto-pick 相似度阈值 0.55
- timeupdate 节流、弹幕条件 reload、settings debounce
- Anime4K 2× target / 更高 maxDimension / canvas contain
- plugins defaultsVersion merge 保留

### P1 完成
- media m3u8 限长 + cancel body
- bangumi/dandan/bilibili 超时
- 规则搜索仅首词 retry
- 客户端 AbortSignal 贯穿 api/RQ/弹幕 match

### 待处理（P2+）
- 反代 / Docker 开放代理门禁
- cookie 不下 query / 会话化
- soft-fail 契约统一
- DNS-safe fetchPublic
