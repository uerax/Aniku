import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PluginCatalogItem, PluginMeta } from '@aniku/shared'
import { catalogItemStatus } from '@aniku/shared'
import { bangumiApi } from '../lib/bangumi'
import { pluginApi } from '../lib/plugin-api'
import {
  runPluginSmoke,
  type SmokeReport,
} from '../lib/plugin-smoke'
import { useSettingsStore } from '../stores/settings'
import { usePluginStore } from '../stores/plugins'
import { PageHeader } from '../components/ui'
import { EMPTY_ARRAY, FALLBACK_DANMAKU, FALLBACK_PLAYER } from '../lib/stable'

type CatalogSort = 'lastUpdate' | 'name'

export function SettingsPage() {
  const bangumiToken = useSettingsStore((s) => s.bangumiToken)
  const setBangumiToken = useSettingsStore((s) => s.setBangumiToken)
  const danmaku = useSettingsStore((s) => s.danmaku ?? FALLBACK_DANMAKU)
  const setDanmaku = useSettingsStore((s) => s.setDanmaku)
  const resetDanmaku = useSettingsStore((s) => s.resetDanmaku)
  const player = useSettingsStore((s) => s.player ?? FALLBACK_PLAYER)
  const setPlayer = useSettingsStore((s) => s.setPlayer)
  const resetPlayer = useSettingsStore((s) => s.resetPlayer)

  const plugins = usePluginStore((s) =>
    Array.isArray(s.plugins) ? s.plugins : EMPTY_ARRAY,
  )
  const importRule = usePluginStore((s) => s.importRule)
  const removePlugin = usePluginStore((s) => s.removePlugin)
  const togglePlugin = usePluginStore((s) => s.togglePlugin)
  const setPluginAdBlocker = usePluginStore((s) => s.setPluginAdBlocker)
  const ensureDefaults = usePluginStore((s) => s.ensureDefaults)
  const resetToDefaults = usePluginStore((s) => s.resetToDefaults)

  const [tokenInput, setTokenInput] = useState(bangumiToken)
  const [tokenMsg, setTokenMsg] = useState('')
  const [pluginMsg, setPluginMsg] = useState('')
  /** Per-plugin automatic smoke (search→chapters→resolve); no user keyword */
  const [smokeById, setSmokeById] = useState<
    Record<string, SmokeReport | { running: true }>
  >({})
  const smokeAbortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [useMirror, setUseMirror] = useState(false)
  const [catalogSort, setCatalogSort] = useState<CatalogSort>('lastUpdate')
  const [catalogFilter, setCatalogFilter] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)

  useEffect(() => {
    setTokenInput(bangumiToken)
  }, [bangumiToken])

  useEffect(() => {
    ensureDefaults()
  }, [ensureDefaults])

  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health')
      return res.json() as Promise<{ ok: boolean; danmakuConfigured: boolean }>
    },
  })

  const me = useQuery({
    queryKey: ['me-settings', bangumiToken],
    queryFn: () => bangumiApi.me(),
    enabled: Boolean(bangumiToken),
    retry: false,
  })

  const catalog = useQuery({
    queryKey: ['plugin-catalog', useMirror],
    queryFn: () => pluginApi.catalog(useMirror),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const installedByName = useMemo(() => {
    const map = new Map<string, PluginMeta>()
    for (const p of plugins) {
      map.set(p.name.toLowerCase(), p)
    }
    return map
  }, [plugins])

  const catalogItems = useMemo(() => {
    const items = [...(catalog.data?.data ?? [])]
    if (catalogSort === 'lastUpdate') {
      items.sort((a, b) => b.lastUpdate - a.lastUpdate)
    } else {
      items.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      )
    }
    const q = catalogFilter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.author.toLowerCase().includes(q),
    )
  }, [catalog.data?.data, catalogSort, catalogFilter])

  async function saveToken() {
    setBangumiToken(tokenInput.trim())
    setTokenMsg('已保存')
    setTimeout(() => setTokenMsg(''), 2000)
  }

  async function onImportFile(file: File) {
    setPluginMsg('')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const list = Array.isArray(json) ? json : [json]
      let n = 0
      for (const item of list) {
        const validated = await pluginApi.validate(item)
        if (!validated.ok || !validated.rule) {
          throw new Error(validated.message || '规则无效')
        }
        importRule(validated.rule, { source: 'import' })
        n++
      }
      setPluginMsg(`成功导入 ${n} 条规则`)
    } catch (e) {
      setPluginMsg(e instanceof Error ? e.message : '导入失败')
    }
  }

  async function installFromCatalog(item: PluginCatalogItem) {
    setInstalling(item.name)
    setPluginMsg('')
    try {
      const res = await pluginApi.download(item.name, useMirror)
      const validated = await pluginApi.validate(res.data)
      if (!validated.ok || !validated.rule) {
        throw new Error(validated.message || '规则校验失败')
      }
      importRule(validated.rule, { source: 'catalog' })
      setPluginMsg(`已安装 ${item.name} v${validated.rule.version}`)
    } catch (e) {
      setPluginMsg(
        e instanceof Error ? e.message : `安装 ${item.name} 失败`,
      )
    } finally {
      setInstalling(null)
    }
  }

  async function updateAllFromCatalog() {
    if (!catalog.data?.data?.length) return
    setBatchBusy(true)
    setPluginMsg('')
    let updated = 0
    let failed = 0
    try {
      for (const item of catalog.data.data) {
        const local = installedByName.get(item.name.toLowerCase())
        const status = catalogItemStatus(local, item)
        if (status !== 'update') continue
        try {
          const res = await pluginApi.download(item.name, useMirror)
          importRule(res.data, { source: 'catalog' })
          updated++
        } catch {
          failed++
        }
      }
      setPluginMsg(
        updated
          ? `已更新 ${updated} 条${failed ? `，失败 ${failed}` : ''}`
          : failed
            ? `更新失败 ${failed} 条`
            : '没有可更新的规则',
      )
    } finally {
      setBatchBusy(false)
    }
  }

  async function testPlugin(plugin: PluginMeta) {
    smokeAbortRef.current?.abort()
    const ac = new AbortController()
    smokeAbortRef.current = ac
    setSmokeById((prev) => ({ ...prev, [plugin.id]: { running: true } }))
    try {
      const report = await runPluginSmoke(plugin, { signal: ac.signal })
      if (ac.signal.aborted) return
      setSmokeById((prev) => ({ ...prev, [plugin.id]: report }))
    } catch (e) {
      if (ac.signal.aborted) return
      setSmokeById((prev) => ({
        ...prev,
        [plugin.id]: {
          pluginName: plugin.name,
          ok: false,
          steps: [],
          summary: '测试失败',
          detail: e instanceof Error ? e.message : String(e),
          finishedAt: Date.now(),
        },
      }))
    }
  }

  function formatLastUpdate(ms: number) {
    if (!ms) return ''
    try {
      return new Date(ms).toLocaleString()
    } catch {
      return String(ms)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader title="设置" description="Token、规则插件与弹幕偏好" />

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-lg font-medium">服务状态</h2>
        <div className="text-sm text-zinc-400">
          API：{health.data?.ok ? '正常' : health.isLoading ? '检测中…' : '不可用（请启动 server）'}
          <br />
          弹幕：
          {health.data?.danmakuConfigured
            ? (health.data as { danmakuUsingFallback?: boolean })
                .danmakuUsingFallback
              ? '可用（内置密钥，与 agefans-enhance 相同）'
              : '已配置开放平台密钥'
            : '不可用'}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-lg font-medium">Bangumi Access Token</h2>
        <p className="text-sm text-zinc-400">
          用于同步追番收藏。在{' '}
          <a
            href="https://next.bgm.tv/demo/access-token"
            target="_blank"
            rel="noreferrer"
            className="kz-link"
          >
            Bangumi 令牌页
          </a>{' '}
          创建后粘贴到下方。Token 仅保存在本机浏览器。
        </p>
        <textarea
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          rows={3}
          placeholder="粘贴 Access Token…"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-sky-600 focus:ring-2"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveToken}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm hover:bg-sky-500"
          >
            保存
          </button>
          {tokenMsg && <span className="text-sm text-emerald-400">{tokenMsg}</span>}
          {bangumiToken && me.isSuccess && (
            <span className="text-sm text-zinc-400">
              已登录：{me.data.data.nickname || me.data.data.username}
            </span>
          )}
          {bangumiToken && me.isError && (
            <span className="text-sm text-red-400">
              校验失败：{(me.error as Error).message}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="text-lg font-medium">已安装规则</h2>
        <p className="text-sm text-zinc-400">
          默认内置可用规则（Anime1 / otage / xifan / MXdm）。可本地导入 JSON，或从下方规则仓库安装。仓库：{' '}
          <a
            href="https://github.com/Predidit/KazumiRules"
            className="kz-link"
            target="_blank"
            rel="noreferrer"
          >
            KazumiRules
          </a>
          。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  '将清空当前规则并恢复为内置默认（Anime1 / otage / xifan / MXdm），确定？',
                )
              ) {
                resetToDefaults()
                setPluginMsg('已恢复默认规则')
              }
            }}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            恢复默认
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          「测试」使用内置关键词自动跑 搜索 → 分集 → 解析，无需填写。
        </p>
        {pluginMsg && <div className="text-sm text-emerald-400">{pluginMsg}</div>}
        {!plugins.length && (
          <div className="text-sm text-zinc-500">暂无插件，可恢复默认或从仓库安装</div>
        )}
        <ul className="space-y-2">
          {plugins.map((p) => {
            const smoke = smokeById[p.id]
            const running = smoke && 'running' in smoke && smoke.running
            const report =
              smoke && !('running' in smoke) ? (smoke as SmokeReport) : null
            return (
              <li
                key={p.id}
                className="space-y-2 rounded-xl border border-zinc-800 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {p.name}{' '}
                      <span className="text-xs text-zinc-500">
                        v{p.version || '?'}
                      </span>
                      {p.source && (
                        <span className="ml-2 text-xs text-zinc-600">
                          {p.source === 'builtin'
                            ? '内置'
                            : p.source === 'catalog'
                              ? '仓库'
                              : '导入'}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {p.baseURL}
                    </div>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => togglePlugin(p.id)}
                    />
                    启用
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-zinc-400"
                    title="HLS 分片广告过滤（#EXT-X-DISCONTINUITY 短段）。需走媒体代理。"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(p.adBlocker)}
                      onChange={(e) =>
                        setPluginAdBlocker(p.id, e.target.checked)
                      }
                    />
                    广告过滤
                  </label>
                  <button
                    type="button"
                    disabled={Boolean(running)}
                    onClick={() => void testPlugin(p)}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700 disabled:opacity-50"
                    title="自动搜索→分集→解析（内置关键词）"
                  >
                    {running ? '测试中…' : '测试'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removePlugin(p.id)}
                    className="rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-zinc-800"
                  >
                    删除
                  </button>
                </div>
                {running && (
                  <div className="text-xs text-zinc-500">
                    后台自动测试中（搜索 → 分集 → 解析）…
                  </div>
                )}
                {report && (
                  <div
                    className={`rounded-lg px-2.5 py-2 text-xs ${
                      report.ok
                        ? 'bg-emerald-950/40 text-emerald-300/90'
                        : 'bg-amber-950/30 text-amber-200/90'
                    }`}
                  >
                    <div className="font-medium">{report.summary}</div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed opacity-90">
                      {report.detail}
                    </pre>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">规则仓库</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-zinc-400">
              <input
                type="checkbox"
                checked={useMirror}
                onChange={(e) => setUseMirror(e.target.checked)}
              />
              使用镜像
            </label>
            <button
              type="button"
              onClick={() => void catalog.refetch()}
              disabled={catalog.isFetching}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-50"
            >
              {catalog.isFetching ? '刷新中…' : '刷新目录'}
            </button>
            <button
              type="button"
              onClick={() => void updateAllFromCatalog()}
              disabled={batchBusy || catalog.isLoading || !catalog.data}
              className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs hover:bg-sky-600 disabled:opacity-50"
            >
              {batchBusy ? '更新中…' : '更新全部'}
            </button>
          </div>
        </div>
        <p className="text-sm text-zinc-400">
          从{' '}
          <a
            href="https://github.com/Predidit/KazumiRules"
            className="kz-link"
            target="_blank"
            rel="noreferrer"
          >
            Predidit/KazumiRules
          </a>{' '}
          选择规则安装。访问由本地 server 代理（主源 GitHub raw，失败可切镜像）。
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={catalogFilter}
            onChange={(e) => setCatalogFilter(e.target.value)}
            placeholder="筛选规则名…"
            className="min-w-[10rem] flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
          <select
            value={catalogSort}
            onChange={(e) => setCatalogSort(e.target.value as CatalogSort)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="lastUpdate">按更新时间</option>
            <option value="name">按名称</option>
          </select>
        </div>
        {catalog.isError && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
            {(catalog.error as Error).message || '无法访问规则仓库'}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded-lg bg-zinc-800 px-2 py-1 text-xs"
                onClick={() => setUseMirror((v) => !v)}
              >
                {useMirror ? '改用主源' : '启用镜像'}
              </button>
              <button
                type="button"
                className="rounded-lg bg-zinc-800 px-2 py-1 text-xs"
                onClick={() => void catalog.refetch()}
              >
                重试
              </button>
            </div>
          </div>
        )}
        {catalog.isLoading && (
          <div className="text-sm text-zinc-500">加载规则目录…</div>
        )}
        {catalog.isSuccess && !catalogItems.length && (
          <div className="text-sm text-zinc-500">规则仓库中暂无匹配规则</div>
        )}
        {catalog.data?.source && (
          <div className="truncate text-xs text-zinc-600">
            来源：{catalog.data.source}
          </div>
        )}
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {catalogItems.map((item) => {
            const local = installedByName.get(item.name.toLowerCase())
            const status = catalogItemStatus(local, item)
            const busy = installing === item.name
            const label =
              status === 'install'
                ? '安装'
                : status === 'update'
                  ? '更新'
                  : '已安装'
            return (
              <li
                key={item.name}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{item.name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                      v{item.version}
                    </span>
                    {item.antiCrawlerEnabled && (
                      <span className="rounded bg-amber-950 px-1.5 py-0.5 text-xs text-amber-300">
                        captcha
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {item.lastUpdate > 0
                      ? `更新：${formatLastUpdate(item.lastUpdate)}`
                      : '—'}
                    {local ? ` · 本地 v${local.version}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={status === 'installed' || busy}
                  onClick={() => void installFromCatalog(item)}
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-default disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {busy ? '…' : label}
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">播放器</h2>
          <button
            type="button"
            onClick={resetPlayer}
            className="text-sm text-zinc-400 hover:text-white"
          >
            恢复默认
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          对齐 agefans-enhance：倍速、自动下一集、记忆进度、跳过片头/片尾。超分对齐
          Kazumi（Anime4K / WebGPU），默认关闭时不占 GPU。也可在播放器控制条切换。
          HLS 广告过滤对齐 Kazumi：按 discontinuity 短段启发式剔除，非域名拦截。
        </p>
        <Toggle
          label="强制广告过滤"
          checked={Boolean(player.forceAdBlocker)}
          onChange={(forceAdBlocker) => setPlayer({ forceAdBlocker })}
        />
        <p className="text-xs text-zinc-600">
          开启后所有规则播放 m3u8 时强制过滤（忽略下方规则的「广告过滤」关闭）。默认仅
          MXdm 规则开启；Anime1 / otage / xifan 默认关。无 DISCONTINUITY
          的片源无效。
        </p>
        <Toggle
          label="自动播放"
          checked={player.autoplay}
          onChange={(autoplay) => setPlayer({ autoplay })}
        />
        <Toggle
          label="自动下一集"
          checked={player.autoNext}
          onChange={(autoNext) => setPlayer({ autoNext })}
        />
        <Toggle
          label="记忆播放位置"
          checked={player.continuePlay}
          onChange={(continuePlay) => setPlayer({ continuePlay })}
        />
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          <span>默认倍速</span>
          <select
            value={player.speed}
            onChange={(e) => setPlayer({ speed: Number(e.target.value) || 1 })}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          <span>超分（Anime4K）</span>
          <select
            value={player.superResolution || 'off'}
            onChange={(e) =>
              setPlayer({
                superResolution: (e.target.value === 'efficiency' ||
                e.target.value === 'quality'
                  ? e.target.value
                  : 'off') as 'off' | 'efficiency' | 'quality',
              })
            }
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          >
            <option value="off">关闭（默认）</option>
            <option value="efficiency">效率档</option>
            <option value="quality">质量档</option>
          </select>
        </label>
        <p className="text-xs text-zinc-600">
          需要 Chrome / Edge 等支持 WebGPU 的浏览器，且页面为安全上下文（HTTPS
          或 localhost）。用局域网 IP 的 HTTP 访问 Docker
          时 WebGPU 不可用。弱显卡请用效率档；iPhone 系统全屏看不到 canvas
          超分，请用「网页全屏」。iframe 降级播放不支持超分。
        </p>
        <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
          <span>记忆跳转时长（J 键，秒）</span>
          <input
            type="number"
            min={1}
            max={600}
            value={player.customSeekTime}
            onChange={(e) =>
              setPlayer({ customSeekTime: Number(e.target.value) || 85 })
            }
            className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
          />
        </label>
        <Toggle
          label="跳过片头"
          checked={player.skipOp.enabled}
          onChange={(enabled) =>
            setPlayer({ skipOp: { ...player.skipOp, enabled } })
          }
        />
        {player.skipOp.enabled && (
          <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
            <label className="flex items-center gap-2">
              起始（秒）
              <input
                type="number"
                min={0}
                value={player.skipOp.start}
                onChange={(e) =>
                  setPlayer({
                    skipOp: {
                      ...player.skipOp,
                      start: Number(e.target.value) || 0,
                    },
                  })
                }
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              时长（秒）
              <input
                type="number"
                min={1}
                value={player.skipOp.duration}
                onChange={(e) =>
                  setPlayer({
                    skipOp: {
                      ...player.skipOp,
                      duration: Number(e.target.value) || 90,
                    },
                  })
                }
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1"
              />
            </label>
          </div>
        )}
        <Toggle
          label="跳过片尾（起=0 表示最后 N 秒）"
          checked={player.skipEd.enabled}
          onChange={(enabled) =>
            setPlayer({ skipEd: { ...player.skipEd, enabled } })
          }
        />
        {player.skipEd.enabled && (
          <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
            <label className="flex items-center gap-2">
              起始（秒）
              <input
                type="number"
                min={0}
                value={player.skipEd.start}
                onChange={(e) =>
                  setPlayer({
                    skipEd: {
                      ...player.skipEd,
                      start: Number(e.target.value) || 0,
                    },
                  })
                }
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              时长（秒）
              <input
                type="number"
                min={1}
                value={player.skipEd.duration}
                onChange={(e) =>
                  setPlayer({
                    skipEd: {
                      ...player.skipEd,
                      duration: Number(e.target.value) || 90,
                    },
                  })
                }
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1"
              />
            </label>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">弹幕默认设置</h2>
          <button
            type="button"
            onClick={resetDanmaku}
            className="text-sm text-zinc-400 hover:text-white"
          >
            恢复默认
          </button>
        </div>
        <Toggle
          label="默认开启弹幕"
          checked={danmaku.enabled}
          onChange={(enabled) => setDanmaku({ enabled })}
        />
        <Slider
          label={`不透明度 ${danmaku.opacity.toFixed(2)}`}
          min={0.1}
          max={1}
          step={0.05}
          value={danmaku.opacity}
          onChange={(opacity) => setDanmaku({ opacity })}
        />
        <Slider
          label={`字号倍率 ${danmaku.fontSize.toFixed(2)}`}
          min={0.5}
          max={2}
          step={0.05}
          value={danmaku.fontSize}
          onChange={(fontSize) => setDanmaku({ fontSize })}
        />
        <Slider
          label={`速度 ${danmaku.speed.toFixed(2)}`}
          min={0.5}
          max={2}
          step={0.05}
          value={danmaku.speed}
          onChange={(speed) => setDanmaku({ speed })}
        />
        <Slider
          label={`显示区域 ${Math.round(danmaku.area * 100)}%`}
          min={0.2}
          max={1}
          step={0.05}
          value={danmaku.area}
          onChange={(area) => setDanmaku({ area })}
        />
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ['showScroll', '滚动'],
              ['showTop', '顶部'],
              ['showBottom', '底部'],
              ['showColor', '彩色'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-zinc-300">
              <input
                type="checkbox"
                checked={danmaku[key]}
                onChange={(e) => setDanmaku({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            关键词屏蔽（每行一条，支持 /正则/）
          </label>
          <textarea
            value={danmaku.filters.join('\n')}
            onChange={(e) =>
              setDanmaku({
                filters: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            rows={4}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-400">
        <h2 className="text-lg font-medium text-zinc-100">关于</h2>
        <p>
          <strong className="font-medium text-zinc-200">Aniku</strong>{' '}
          是浏览器端番剧应用。规则格式兼容{' '}
          <a
            className="kz-link"
            href="https://github.com/Predidit/KazumiRules"
            target="_blank"
            rel="noreferrer"
          >
            KazumiRules
          </a>
          ；早期设计曾参考{' '}
          <a
            className="kz-link"
            href="https://github.com/Predidit/Kazumi"
            target="_blank"
            rel="noreferrer"
          >
            Kazumi
          </a>{' '}
          与{' '}
          <a
            className="kz-link"
            href="https://github.com/IronKinoko/agefans-enhance"
            target="_blank"
            rel="noreferrer"
          >
            agefans-enhance
          </a>
          。
        </p>
        <p>
          元数据：Bangumi · 弹幕：弹弹play · 播放源：内置/导入/规则仓库。请在 24
          小时内清除缓存数据，并遵守当地法律法规。
        </p>
      </section>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-zinc-300">{label}</div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
