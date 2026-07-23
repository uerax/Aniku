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

import type { SuperResolutionMode } from '@aniku/shared'

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

/** Cheap sync probe — does not request a device. */
export function hasWebGPU(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as Navigator & { gpu?: GPU }).gpu !== 'undefined' &&
    !!(navigator as Navigator & { gpu?: GPU }).gpu
  )
}

/** Async probe: adapter may be null (remote desktop, blocked GPU). */
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
 * Pick GPU buffer size so Anime4K actually upscales.
 * Aim ≥ 2× native (or display CSS size, whichever larger), cap long edge.
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
  // Display CSS box in device pixels
  const cssW = Math.max(2, Math.floor(layout.width * dpr))
  const cssH = Math.max(2, Math.floor(layout.height * dpr))

  // Force at least 2× native so CNN x2 path engages (otherwise 1080p→1080p
  // looks almost identical to original).
  const scaleWanted = mode === 'quality' ? 2 : 2
  let w = Math.max(cssW, Math.floor(native.width * scaleWanted))
  let h = Math.max(cssH, Math.floor(native.height * scaleWanted))

  // Keep aspect of native video
  const ar = native.width / Math.max(1, native.height)
  if (w / h > ar) {
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

  // ModeA needs target meaningfully larger than native for the upscale branch
  if (w < native.width * 1.2 && h < native.height * 1.2) {
    w = Math.min(maxDimension, Math.floor(native.width * 2))
    h = Math.min(maxDimension, Math.floor(native.height * 2))
    const ar2 = native.width / Math.max(1, native.height)
    if (w / h > ar2) w = Math.max(2, Math.round(h * ar2))
    else h = Math.max(2, Math.round(w / ar2))
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
  const maxDimension = options.maxDimension ?? 1920

  if (!hasWebGPU()) {
    throw new Error('WebGPU not available')
  }

  const native = await waitForVideoDimensions(video)
  const layout = layoutSize(canvas, layoutEl)
  const target = pickTargetSize(native, layout, maxDimension, mode)
  canvas.width = target.width
  canvas.height = target.height

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
      // ModeA ≈ Kazumi quality: VL restore + dual upscale + auto-downscale
      const preset = new a4k.ModeA({
        device,
        inputTexture: videoFrameTexture,
        nativeDimensions: native,
        targetDimensions: target,
      })
      return [preset]
    }
    // efficiency: Clamp → CNN restore M → x2 M (lighter than ModeA's VL path)
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
    label: 'Aniku SR Bind Group Layout',
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
  const WIDTH = native.width
  const HEIGHT = native.height
  let frameErrors = 0

  const copyFrame = () => {
    // Always try to copy when we have a current frame (including paused)
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    device.queue.copyExternalImageToTexture(
      { source: video },
      { texture: videoFrameTexture },
      [WIDTH, HEIGHT],
    )
  }

  const frame = () => {
    if (stopped) return
    try {
      copyFrame()
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
    } catch (e) {
      frameErrors += 1
      if (frameErrors <= 3 || frameErrors % 60 === 0) {
        console.warn('[anime4k] frame error', e)
      }
    }
    if (stopped) return
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(frame)
    } else {
      requestAnimationFrame(frame)
    }
  }

  // Prime one frame so first paint is not empty black
  try {
    copyFrame()
  } catch (e) {
    console.warn('[anime4k] initial copy failed (CORS / not ready?)', e)
  }

  console.info(
    `[anime4k] started mode=${mode} native=${native.width}x${native.height} target=${target.width}x${target.height}`,
  )

  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(frame)
  } else {
    requestAnimationFrame(frame)
  }

  return () => {
    if (stopped) return
    stopped = true
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
