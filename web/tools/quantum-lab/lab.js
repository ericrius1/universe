// Standalone WebGPU harness for the world below the atom, shaders/quantum_core.wgsl (no weft).
// Reads ?L=...&t=...&yaw=...&pitch=...&ballR=...&bg=...&hud=1
// Exposes window.__ready, window.__failed, window.__render(opts), window.__bench(opts)

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const qp = new URLSearchParams(location.search);

const state = {
  L: qp.has('L') ? Number(qp.get('L')) : -10.1,
  t: qp.has('t') ? Number(qp.get('t')) : 0.0,
  yaw: qp.has('yaw') ? Number(qp.get('yaw')) : 0.4,
  pitch: qp.has('pitch') ? Number(qp.get('pitch')) : -0.3,
  ballR: qp.has('ballR') ? Number(qp.get('ballR')) : -1.0, // -1 => auto in stage 10
  bg: qp.get('bg') ?? 'cell', // 'cell' simulates the DNA bead behind alpha<1; 'black' is pure black
  animate: qp.get('play') === '1',
  hud: qp.get('hud') === '1',
};

if (state.hud) hud.classList.remove('hidden');

function defaultBallR(L) {
  if (L > -39.8) return 0.0;
  // Matches the real CMB ball's apparent size (~0.38 view units at L=-41, growing in gently from L=-40)
  const u = Math.max(0, Math.min(1, (-39.8 - L) / 1.2));
  return 0.46 - 0.08 * u;
}

function buildCamera(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = [-sy * cp, sp, -cy * cp];
  const ro = [-fwd[0], -fwd[1], -fwd[2]];
  // World up = (0, 1, 0)
  let rx = -fwd[2], ry = 0, rz = fwd[0];
  const rlen = Math.hypot(rx, ry, rz) || 1;
  rx /= rlen; ry /= rlen; rz /= rlen;
  // up = cross(right, fwd) -> wait: screen right x fwd or fwd x right
  // Let's check right-handed: right = normalize(cross(fwd, worldUp))
  // cross((fx,fy,fz), (0,1,0)) = (-fz, 0, fx) -> matches (rx, ry, rz)!
  // up = cross(right, fwd)
  const ux = ry * fwd[2] - rz * fwd[1];
  const uy = rz * fwd[0] - rx * fwd[2];
  const uz = rx * fwd[1] - ry * fwd[0];
  return { ro, fwd, right: [rx, ry, rz], up: [ux, uy, uz] };
}

const WRAPPER_WGSL = /* wgsl */`
struct LabU {
  ro: vec3f, L: f32,
  fwd: vec3f, t: f32,
  right: vec3f, px: f32,
  up: vec3f, ballR: f32,
  res: vec2f, tanHalf: f32, bgMode: f32,
}
@group(0) @binding(0) var<uniform> U: LabU;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = p[vi] * 0.5 + 0.5;
  o.uv.y = 1.0 - o.uv.y;
  return o;
}

// Simulated DNA bead backdrop for verifying Stage 1 alpha seam (L -8.6 .. -9.5)
fn labCellBackdrop(ro: vec3f, rd: vec3f, L: f32) -> vec3f {
  if (U.bgMode < 0.5 || L < -9.6) { return vec3f(0.0); }
  // Soft deep cell nucleus background
  let bg = mix(vec3f(0.008, 0.011, 0.022), vec3f(0.018, 0.020, 0.036), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  // DNA bead of radius 0.36 nm at origin
  let rBead = pow(10.0, -9.4436975 - L);
  let b = dot(ro, rd);
  let h = b * b - (dot(ro, ro) - rBead * rBead);
  if (h <= 0.0) { return bg; }
  let hitT = -b - sqrt(h);
  if (hitT <= 0.0) { return vec3f(0.03, 0.04, 0.06); }
  let n = normalize(ro + rd * hitT);
  let ldir = normalize(vec3f(-0.45, 0.65, 0.60));
  let ndl = clamp(dot(n, ldir) * 0.5 + 0.5, 0.0, 1.0);
  let fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.2);
  let baseCol = vec3f(0.24, 0.34, 0.50);
  let bead = baseCol * (0.20 + 0.85 * ndl * ndl) + vec3f(0.26, 0.36, 0.52) * fres * 0.65;
  let edge = smoothstep(0.0, rBead * 0.08, sqrt(h));
  return mix(bg, bead, edge);
}

// Soft film-like display transform (exposure, gentle highlight compression with warm roll-off, sRGB)
fn labToneMap(hdr: vec3f, pix: vec2f) -> vec3f {
  let c = max(hdr, vec3f(0.0));
  // Luminance-preserving soft knee with slight highlight desaturation (AgX-inspired feel)
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let mappedLum = lum / (1.0 + lum * 0.72 + lum * lum * 0.06);
  let scale = mappedLum / max(lum, 1e-6);
  var out = c * scale;
  // Soft desaturation toward ivory-white for bright HDR highlights (> 1.5 linear)
  let hi = smoothstep(0.65, 2.8, lum);
  out = mix(out, vec3f(mappedLum), hi * 0.55);
  // Subtle filmic contrast curve + sRGB
  out = clamp(out, vec3f(0.0), vec3f(1.0));
  let lo = out * 12.92;
  let srgb = select(1.055 * pow(out, vec3f(1.0 / 2.4)) - 0.055, lo, out <= vec3f(0.0031308));
  // Subtle triangular IGN dither to prevent 8-bit banding in dark gradients
  let ign = fract(52.9829189 * fract(dot(pix, vec2f(0.06711056, 0.00583715))));
  return clamp(srgb + (ign - 0.5) / 255.0, vec3f(0.0), vec3f(1.0));
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let aspect = U.res.x / max(U.res.y, 1.0);
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let rd = normalize(U.fwd + U.right * (ndc.x * aspect * U.tanHalf) + U.up * (ndc.y * U.tanHalf));
  let q = qWorld(U.ro, rd, U.L, U.t, U.px, in.pos.xy, U.ballR);
  let behind = labCellBackdrop(U.ro, rd, U.L);
  let hdr = q.rgb + behind * (1.0 - clamp(q.a, 0.0, 1.0));
  return vec4f(labToneMap(hdr, in.pos.xy), 1.0);
}
`;

async function main() {
  if (!navigator.gpu) throw new Error('WebGPU not available');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');

  const hasTimestamp = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: hasTimestamp ? ['timestamp-query'] : [],
  });
  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
  });

  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  const coreSrc = await fetch(`../../shaders/quantum_core.wgsl?v=${Date.now()}`).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch quantum_core.wgsl: ${r.status}`);
    return r.text();
  });

  const fullSrc = `${coreSrc}\n\n${WRAPPER_WGSL}`;
  const module = device.createShaderModule({ label: 'quantum-lab', code: fullSrc });
  const info = await module.getCompilationInfo();
  const errs = info.messages.filter((m) => m.type === 'error');
  if (errs.length > 0) {
    const msg = errs.map((e) => `L${e.lineNum}:${e.linePos} ${e.message}`).join('\n');
    throw new Error(`WGSL compile error:\n${msg}`);
  }
  for (const w of info.messages.filter((m) => m.type === 'warning')) {
    console.warn(`WGSL warning L${w.lineNum}:${w.linePos} ${w.message}`);
  }

  const pipeline = device.createRenderPipeline({
    label: 'quantum-lab-pipe',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const uBuf = device.createBuffer({
    size: 80, // 5 * vec4f
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uBuf } }],
  });

  // Optional GPU timestamp query resources
  let querySet = null, resolveBuf = null, readBuf = null;
  if (hasTimestamp) {
    querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    resolveBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    readBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  }

  let curW = 0, curH = 0;
  function ensureSize() {
    const w = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    const h = Math.max(1, Math.round(canvas.clientHeight * (window.devicePixelRatio || 1)));
    if (w !== curW || h !== curH) {
      curW = w; curH = h;
      canvas.width = w;
      canvas.height = h;
      ctx.configure({ device, format, alphaMode: 'opaque' });
    }
    return [curW, curH];
  }

  const uData = new Float32Array(20);
  const fovRad = (60 * Math.PI) / 180;
  const tanHalf = Math.tan(fovRad * 0.5);

  function drawFrame(opts = {}, recordTimestamp = false) {
    const L = opts.L ?? state.L;
    const t = opts.t ?? state.t;
    const yaw = opts.yaw ?? state.yaw;
    const pitch = opts.pitch ?? state.pitch;
    const ballR = opts.ballR !== undefined
      ? opts.ballR
      : (state.ballR >= 0 ? state.ballR : defaultBallR(L));
    const bgMode = (opts.bg ?? state.bg) === 'cell' ? 1.0 : 0.0;

    const [w, h] = ensureSize();
    const cam = buildCamera(yaw, pitch);
    const px = (2.0 * tanHalf) / h;

    uData[0] = cam.ro[0]; uData[1] = cam.ro[1]; uData[2] = cam.ro[2]; uData[3] = L;
    uData[4] = cam.fwd[0]; uData[5] = cam.fwd[1]; uData[6] = cam.fwd[2]; uData[7] = t;
    uData[8] = cam.right[0]; uData[9] = cam.right[1]; uData[10] = cam.right[2]; uData[11] = px;
    uData[12] = cam.up[0]; uData[13] = cam.up[1]; uData[14] = cam.up[2]; uData[15] = ballR;
    uData[16] = w; uData[17] = h; uData[18] = tanHalf; uData[19] = bgMode;
    device.queue.writeBuffer(uBuf, 0, uData);

    const enc = device.createCommandEncoder();
    const passDesc = {
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    };
    if (recordTimestamp && querySet) {
      passDesc.timestampWrites = {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      };
    }
    const pass = enc.beginRenderPass(passDesc);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    if (recordTimestamp && querySet) {
      enc.resolveQuerySet(querySet, 0, 2, resolveBuf, 0);
      enc.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, 16);
    }
    device.queue.submit([enc.finish()]);

    if (state.hud) {
      hud.textContent = `L = ${L.toFixed(3)}   t = ${t.toFixed(2)}s   ballR = ${ballR.toFixed(3)}   ${w}x${h}`;
    }
  }

  window.__render = async (opts = {}) => {
    Object.assign(state, opts);
    drawFrame(opts, false);
    await device.queue.onSubmittedWorkDone();
    // Wait one rAF so compositor presents the frame
    await new Promise((r) => requestAnimationFrame(r));
  };

  window.__bench = async ({ L = -15.2, frames = 120, stepL = 0.0, stepT = 1 / 60 } = {}) => {
    // Warmup 10 frames
    for (let i = 0; i < 10; i++) {
      drawFrame({ L, t: i * stepT }, false);
    }
    await device.queue.onSubmittedWorkDone();

    let gpuMsTotal = 0;
    let gpuSamples = 0;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const curL = L + i * stepL;
      const curT = i * stepT;
      if (hasTimestamp) {
        drawFrame({ L: curL, t: curT }, true);
        await device.queue.onSubmittedWorkDone();
        await readBuf.mapAsync(GPUMapMode.READ);
        const times = new BigUint64Array(readBuf.getMappedRange());
        const dtNs = Number(times[1] - times[0]);
        readBuf.unmap();
        if (dtNs > 0 && dtNs < 1e9) {
          gpuMsTotal += dtNs / 1e6;
          gpuSamples++;
        }
      } else {
        drawFrame({ L: curL, t: curT }, false);
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    await device.queue.onSubmittedWorkDone();
    const wallMs = (performance.now() - t0) / frames;
    const gpuMs = gpuSamples > 0 ? gpuMsTotal / gpuSamples : null;
    return { frames, width: curW, height: curH, wallMs, gpuMs, hasTimestamp };
  };

  // Interactive wheel zoom & orbit if viewed manually
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    state.yaw -= (e.clientX - lx) * 0.005;
    state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch + (e.clientY - ly) * 0.005));
    lx = e.clientX; ly = e.clientY;
    if (!state.animate) drawFrame();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.L = Math.max(-41.0, Math.min(-8.6, state.L - e.deltaY * 0.002));
    if (!state.animate) drawFrame();
  }, { passive: false });

  drawFrame();
  await device.queue.onSubmittedWorkDone();

  if (state.animate) {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      state.t += dt;
      drawFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  window.__ready = true;
}

main().catch((err) => {
  console.error(err);
  window.__failed = String(err?.message || err);
});
