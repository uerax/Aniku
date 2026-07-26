/**
 * Anime4K super-resolution via WebGPU (anime4k-webgpu).
 *
 * Stock `render()` never stops — we own a disposable controller so src/mode
 * changes and unmount do not leak GPU devices or stack frame callbacks.
 *
 * Dynamic-import the heavy package only when a non-off mode is requested.
 *
 * Package note: npm `anime4k-webgpu@1.0.0` ships a webpack UMD build; named
 * ESM exports are often undefined and real classes live on `.default`.
 */
/// <reference types="@webgpu/types" />

import type { SuperResolutionMode } from '@animaku/shared'

export type Anime4KStop = () => void

export interface Anime4KStartOptions {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  mode: Exclude<SuperResolutionMode, 'off'>
  /**
   * Cap canvas buffer long edge (CSS-independent). Default 1920.
   * Larger = sharper / heavier.
   */
  maxDimension?: number
  /** Optional: measure layout from shell when canvas is not yet visible */
  layoutEl?: HTMLElement | null
}

const FULLSCREEN_QUAD_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) fragUV : vec2<f32>,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  const pos = array(
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0),
  );

  const uv = array(
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0),
  );

  var output : VertexOutput;
  output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
  output.fragUV = uv[VertexIndex];
  return output;
}
`

const SAMPLE_TEXTURE_WGSL = /* wgsl */ `
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

@fragment
fn main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(myTexture, mySampler, fragUV);
}
`

type A4kNs = {
  ModeA: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
    nativeDimensions: { width: number; height: number }
    targetDimensions: { width: number; height: number }
  }) => Pipeline
  ClampHighlights: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
  }) => Pipeline
  CNNM: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
  }) => Pipeline
  CNNx2M: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
  }) => Pipeline
  CNNVL?: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
  }) => Pipeline
  CNNx2VL?: new (opts: {
    device: GPUDevice
    inputTexture: GPUTexture
  }) => Pipeline
}

type Pipeline = {
  pass(encoder: GPUCommandEncoder): void
  getOutputTexture(): GPUTexture
}

/**
 * Cheap sync probe — does not request a device.
 * WebGPU is only exposed in a secure context (HTTPS or localhost / 127.0.0.1).
 * Docker served over http://LAN-IP:PORT has isSecureContext=false → no gpu.
 */
export function hasWebGPU(): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof window !== 'undefined' && !window.isSecureContext) return false
  return !!(navigator as Navigator & { gpu?: GPU }).gpu
}

/** Async probe: adapter may be null (remote desktop, blocked GPU, insecure HTTP). */
export async function supportsAnime4K(): Promise<boolean> {
  if (!hasWebGPU()) return false
  try {
    const gpu = (navigator as Navigator & { gpu: GPU }).gpu
    const adapter = await gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

/**
 * Resolve anime4k-webgpu UMD/CJS interop shapes used by Vite/Node.
 */
function resolveAnime4KExports(mod: unknown): A4kNs {
  const seen = new Set<unknown>()
  const queue: unknown[] = [mod]
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    const o = cur as Record<string, unknown>
    if (typeof o.ModeA === 'function' && typeof o.CNNM === 'function') {
      return o as unknown as A4kNs
    }
    for (const k of ['default', 'anime4k-webgpu', 'module.exports']) {
      if (o[k]) queue.push(o[k])
    }
  }
  throw new Error(
    'anime4k-webgpu: could not resolve ModeA/CNNM (UMD interop failed)',
  )
}

/**
 * Default long-edge caps. Old default 1920 made 1080p → 1080p (CNN x2 never
 * engaged / ModeA took restore-only) so efficiency/quality/off looked identical.
 */
export const SR_MAX_DIMENSION: Record<
  Exclude<SuperResolutionMode, 'off'>,
  number
> = {
  // 2× 720p–1080p comfortably; lighter than quality
  efficiency: 2560,
  // allow full 2× 1080p (3840) and mild 2× 1440p headroom
  quality: 3840,
}

/**
 * Pick GPU canvas + ModeA target so Anime4K **always** runs a real upscale path.
 *
 * Critical: target must be ≥ ~1.2× native or ModeA skips upscale and CNNx2
 * output is immediately bilinear-down to 1× — visually ≈ original.
 * We lock to 2× native (then cap), and also never go below display CSS×DPR.
 */
function pickTargetSize(
  native: { width: number; height: number },
  layout: { width: number; height: number },
  maxDimension: number,
  mode: Exclude<SuperResolutionMode, 'off'>,
): { width: number; height: number } {
  const dpr = Math.min(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    2,
  )
  const cssW = Math.max(2, Math.floor(layout.width * dpr))
  const cssH = Math.max(2, Math.floor(layout.height * dpr))

  // Always 2× native so CNN x2 / ModeA upscale branch engages.
  // Quality keeps more headroom via higher maxDimension (see SR_MAX_DIMENSION).
  const scaleWanted = 2
  let w = Math.floor(native.width * scaleWanted)
  let h = Math.floor(native.height * scaleWanted)

  // If the player shell is larger than 2× native (rare), match display so we
  // don't upscale with CSS alone on top of a small buffer.
  if (cssW > w || cssH > h) {
    w = Math.max(w, cssW)
    h = Math.max(h, cssH)
  }

  const ar = native.width / Math.max(1, native.height)
  if (w / Math.max(1, h) > ar) {
    w = Math.max(2, Math.round(h * ar))
  } else {
    h = Math.max(2, Math.round(w / ar))
  }

  const long = Math.max(w, h)
  if (long > maxDimension) {
    const s = maxDimension / long
    w = Math.max(2, Math.floor(w * s))
    h = Math.max(2, Math.floor(h * s))
  }

  // Final guard: never ship a ~1× buffer (ModeA would no-op upscale).
  // If cap crushed us (e.g. tiny maxDimension), still try ≥1.5× native.
  if (w < native.width * 1.5 && h < native.height * 1.5) {
    const boost = Math.min(
      maxDimension / Math.max(native.width, native.height, 1),
      mode === 'quality' ? 2 : 1.75,
    )
    if (boost > 1.2) {
      w = Math.max(2, Math.floor(native.width * boost))
      h = Math.max(2, Math.floor(native.height * boost))
      if (w / h > ar) w = Math.max(2, Math.round(h * ar))
      else h = Math.max(2, Math.round(w / ar))
    }
  }

  return { width: w, height: h }
}

function layoutSize(
  canvas: HTMLCanvasElement,
  layoutEl?: HTMLElement | null,
): { width: number; height: number } {
  const el = layoutEl ?? canvas.parentElement ?? canvas
  const rect = el.getBoundingClientRect()
  // Hidden canvas often reports 0 — fall back to parent / defaults
  const w = rect.width || canvas.clientWidth || 960
  const h = rect.height || canvas.clientHeight || 540
  return { width: w, height: h }
}

async function waitForVideoDimensions(
  video: HTMLVideoElement,
): Promise<{ width: number; height: number }> {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return { width: video.videoWidth, height: video.videoHeight }
  }
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup()
      if (video.videoWidth > 0) resolve()
      else reject(new Error('video has no dimensions'))
    }
    const onError = () => {
      cleanup()
      reject(new Error('video error before metadata'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', onError)
    if (
      video.readyState >= HTMLMediaElement.HAVE_METADATA &&
      video.videoWidth > 0
    ) {
      cleanup()
      resolve()
    }
  })
  return { width: video.videoWidth, height: video.videoHeight }
}

/**
 * Start Anime4K on video → canvas. Call returned stop() on src change / mode off / unmount.
 */
export async function startAnime4K(
  options: Anime4KStartOptions,
): Promise<Anime4KStop> {
  const { video, canvas, mode, layoutEl } = options
  const maxDimension = options.maxDimension ?? SR_MAX_DIMENSION[mode]

  if (!hasWebGPU()) {
    throw new Error('WebGPU not available')
  }

  const native = await waitForVideoDimensions(video)
  const layout = layoutSize(canvas, layoutEl)
  const target = pickTargetSize(native, layout, maxDimension, mode)
  canvas.width = target.width
  canvas.height = target.height

  // Distinct visual scale vs original — used in logs / caller hints
  const scaleX = target.width / Math.max(1, native.width)
  const scaleY = target.height / Math.max(1, native.height)
  if (scaleX < 1.25 && scaleY < 1.25) {
    console.warn(
      `[anime4k] target ~1× native (${native.width}x${native.height} → ${target.width}x${target.height}); SR will look weak. Raise maxDimension.`,
    )
  }

  const mod = await import('anime4k-webgpu')
  const a4k = resolveAnime4KExports(mod)

  const gpu = (navigator as Navigator & { gpu: GPU }).gpu
  const adapter = await gpu.requestAdapter()
  if (!adapter) throw new Error('WebGPU adapter unavailable')
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) {
    try {
      device.destroy()
    } catch {
      /* ignore */
    }
    throw new Error('webgpu canvas context failed')
  }

  const presentationFormat = gpu.getPreferredCanvasFormat()
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  })

  // COPY_SRC not required; RENDER_ATTACHMENT needed by some browsers for
  // copyExternalImageToTexture destination.
  const videoFrameTexture = device.createTexture({
    size: [native.width, native.height, 1],
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  })

  const pipelines: Pipeline[] = (() => {
    if (mode === 'quality') {
      // ModeA: restore (VL) + upscale + auto-downscale to targetDimensions.
      // target MUST be > native or ModeA degenerates to mild restore.
      const preset = new a4k.ModeA({
        device,
        inputTexture: videoFrameTexture,
        nativeDimensions: native,
        targetDimensions: target,
      })
      return [preset]
    }
    // efficiency: lighter CNN stack, still forced through x2 so edges change.
    // Clamp → CNNM (restore) → CNNx2M (2×). Fullscreen blit samples onto
    // `target` canvas (≤2×, capped) — supersampled look vs raw <video>.
    const clamp = new a4k.ClampHighlights({
      device,
      inputTexture: videoFrameTexture,
    })
    const restore = new a4k.CNNM({
      device,
      inputTexture: clamp.getOutputTexture(),
    })
    const upscale = new a4k.CNNx2M({
      device,
      inputTexture: restore.getOutputTexture(),
    })
    return [clamp, restore, upscale]
  })()

  const renderBindGroupLayout = device.createBindGroupLayout({
    label: 'Animaku SR Bind Group Layout',
    entries: [
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  })

  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [renderBindGroupLayout],
    }),
    vertex: {
      module: device.createShaderModule({ code: FULLSCREEN_QUAD_WGSL }),
      entryPoint: 'vert_main',
    },
    fragment: {
      module: device.createShaderModule({ code: SAMPLE_TEXTURE_WGSL }),
      entryPoint: 'main',
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: 'triangle-list' },
  })

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  })

  const last = pipelines[pipelines.length - 1]
  if (!last) throw new Error('empty Anime4K pipeline')

  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      { binding: 1, resource: sampler },
      { binding: 2, resource: last.getOutputTexture().createView() },
    ],
  })

  let stopped = false
  /** Tab hidden — skip GPU work until visible again */
  let pausedForHidden = false
  const WIDTH = native.width
  const HEIGHT = native.height
  let frameErrors = 0
  let rvfcHandle: number | undefined
  let rafHandle: number | undefined

  const cancelPendingFrame = () => {
    try {
      if (
        rvfcHandle != null &&
        typeof video.cancelVideoFrameCallback === 'function'
      ) {
        video.cancelVideoFrameCallback(rvfcHandle)
      }
    } catch {
      /* ignore */
    }
    rvfcHandle = undefined
    if (rafHandle != null) {
      try {
        cancelAnimationFrame(rafHandle)
      } catch {
        /* ignore */
      }
      rafHandle = undefined
    }
  }

  const scheduleFrame = () => {
    if (stopped || pausedForHidden) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      rvfcHandle = video.requestVideoFrameCallback(frame)
    } else {
      rafHandle = requestAnimationFrame(frame)
    }
  }

  let copyFailedLogged = false
  const copyFrame = () => {
    // Always try to copy when we have a current frame (including paused)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false
    try {
      device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: videoFrameTexture },
        [WIDTH, HEIGHT],
      )
      return true
    } catch (e) {
      // Cross-origin video without CORS → SecurityError; SR cannot run.
      if (!copyFailedLogged) {
        copyFailedLogged = true
        console.warn(
          '[anime4k] copyExternalImageToTexture failed (CORS / not ready?)',
          e,
        )
      }
      return false
    }
  }

  const frame = () => {
    if (stopped || pausedForHidden) return
    try {
      if (!copyFrame()) {
        // Don't burn GPU on empty/black frames; retry next tick
        frameErrors += 1
        if (frameErrors === 1 || frameErrors % 60 === 0) {
          console.warn(
            '[anime4k] skip frame — video copy failed (check CORS on media)',
          )
        }
      } else {
        const commandEncoder = device.createCommandEncoder()
        for (const p of pipelines) p.pass(commandEncoder)
        const passEncoder = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })
        passEncoder.setPipeline(renderPipeline)
        passEncoder.setBindGroup(0, renderBindGroup)
        passEncoder.draw(6)
        passEncoder.end()
        device.queue.submit([commandEncoder.finish()])
        frameErrors = 0
      }
    } catch (e) {
      frameErrors += 1
      if (frameErrors <= 3 || frameErrors % 60 === 0) {
        console.warn('[anime4k] frame error', e)
      }
    }
    if (stopped || pausedForHidden) return
    scheduleFrame()
  }

  const onVisibility = () => {
    if (stopped) return
    if (document.hidden) {
      pausedForHidden = true
      cancelPendingFrame()
      return
    }
    if (!pausedForHidden) return
    pausedForHidden = false
    // Resume pipeline when tab is visible again
    try {
      copyFrame()
    } catch {
      /* ignore */
    }
    scheduleFrame()
  }
  document.addEventListener('visibilitychange', onVisibility)

  /**
   * Retarget canvas buffer on shell resize / fullscreen without rebuilding CNN
   * pipelines. The fullscreen quad samples the fixed pipeline output into the
   * new canvas size (bilinear up/down). Prevents black/stretched frames when
   * `.kz-sr-on` hides the native video and layout changes after start.
   */
  let lastLayoutKey = `${target.width}x${target.height}`
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const applyLayoutSize = () => {
    if (stopped) return
    const next = pickTargetSize(
      native,
      layoutSize(canvas, layoutEl),
      maxDimension,
      mode,
    )
    const key = `${next.width}x${next.height}`
    if (key === lastLayoutKey) return
    // Ignore tiny jitter (< 32px on either edge)
    if (
      Math.abs(next.width - canvas.width) < 32 &&
      Math.abs(next.height - canvas.height) < 32
    ) {
      return
    }
    lastLayoutKey = key
    try {
      canvas.width = next.width
      canvas.height = next.height
      // Reconfigure swapchain for new size (required on some browsers)
      context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
      })
    } catch (e) {
      console.warn('[anime4k] resize reconfigure failed', e)
    }
  }
  const onLayoutResize = () => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(applyLayoutSize, 120)
  }
  let ro: ResizeObserver | null = null
  try {
    const observeEl = layoutEl ?? canvas.parentElement ?? canvas
    ro = new ResizeObserver(onLayoutResize)
    ro.observe(observeEl)
  } catch {
    /* ResizeObserver missing — CSS scaling of fixed buffer still applies */
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onLayoutResize)
    document.addEventListener('fullscreenchange', onLayoutResize)
  }

  // Prime one frame so first paint is not empty black
  copyFrame()

  if (!document.hidden) {
    scheduleFrame()
  } else {
    pausedForHidden = true
  }

  return () => {
    if (stopped) return
    stopped = true
    document.removeEventListener('visibilitychange', onVisibility)
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onLayoutResize)
      document.removeEventListener('fullscreenchange', onLayoutResize)
    }
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    try {
      ro?.disconnect()
    } catch {
      /* ignore */
    }
    ro = null
    cancelPendingFrame()
    try {
      videoFrameTexture.destroy()
    } catch {
      /* ignore */
    }
    try {
      device.destroy()
    } catch {
      /* ignore */
    }
  }
}

export const SUPER_RESOLUTION_LABELS: Record<SuperResolutionMode, string> = {
  off: '关闭',
  efficiency: '效率',
  quality: '质量',
}
