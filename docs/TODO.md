# TODO

## 1. 首页等页面数据缓存优化
- [x] 对首页热门趋势列表结果增加缓存机制（服务端 12h + 客户端 RQ 2h）
- [x] 对番剧页面的列表结果增加缓存机制（服务端 browse 2h + 客户端 30m）
- [x] 时间表（放送日历）数据设置更长缓存周期（服务端 24h + 客户端 12h；避免 3d+ 跨季末脏数据）
- [x] 明确缓存失效策略（TTL 为主 + `?refresh=1` / Cache-Control: no-cache 为辅；见 `docs/CONTEXT.md`）
- [x] 顶栏搜索 RQ staleTime 30m（与 browse 对齐；服务端 search 已 2h）
- [x] 条目详情：服务端 subject 6h + 观看页 RQ 30m（完整 item，非 slim）
- 备注：封面直连 Bangumi CDN，已有长 max-age，**不做**本机图片代理/SW

## 2. 设置面板与部署安全
- [x] 规则导入：仅本地 `parsePluginRule` 校验与保存，不经 `/api/plugin/validate`
- [x] 梳理「本地生效 vs 服务器生效」；设置项不可提权（见 CONTEXT）
- [x] env：`MEDIA_FULL_PROXY` 默认 **0**（最多代理 m3u8；1=允许分片/整段）
- [x] `MEDIA_FULL_PROXY=0` 时 media proxy 拒绝非 m3u8 / 忽略 fullProxy / 拒 cookie mp4
- [x] health 暴露 `mediaFullProxy`；设置页展示并禁用「媒体走服务器代理」
- [x] 内置规则 Anime1 排最后；`MEDIA_FULL_PROXY=0` 时禁用 Anime1
- [x] `.env.example` + CONTEXT：`PUBLIC_PROXY` 与 `MEDIA_FULL_PROXY` 两道闸

## 3. 搜索/分集/解析结果缓存
- 主要应用于视频源相关功能（如视频源搜索、获取分集列表、解析播放地址等环节）
- [x] 对视频源搜索结果增加缓存（服务端 4h + 客户端 memory/session；重搜 refresh）
- [x] 对视频源分集列表增加缓存（服务端 12h + roads-cache 12h TTL）
- [x] 对视频源解析结果（播放地址等）增加缓存（按 playUrl 分类：m3u8 30m / mp4 2m / 签名与 cookie 不缓存）
- [x] 该类数据基本不变，可设置较长缓存有效期（search/chapters；resolve 例外）
- [x] 需考虑视频源解析结果的有效期问题（分类 TTL + 播放失败/鉴权过期强制 re-resolve；见 CONTEXT）

## 4. 片头片尾跳过功能（新功能）
- [ ] 建立番剧片头/片尾时间点数据结构，按 Bangumi 番剧 ID 关联
- [ ] 控制面板增加开关选项，供用户选择是否开启该功能
- [ ] 播放器端实现自动跳过片头/片尾逻辑
- [ ] 搭建/接入第三方仓库，用于存储和维护各番剧对应的片头片尾时间点数据
- [ ] 明确数据获取方式（本地缓存 vs 每次请求第三方仓库）及更新策略