// Hero diagram: "your brand -> our system -> products -> profit".
// Plain three (named imports, tree-shaken) rather than @react-three/fiber:
// fiber + drei alone measured 265 KB gzipped, over the island's 250 KB budget.
//
// The server renders the same diagram as static HTML/SVG inside the mount
// node. That markup stays the fallback for no JS, no WebGL and load failure;
// this script only adds `is-live` and then drives the labels it finds there.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { hardwareWebGL2 } from "@/lib/gpu";

const RADIUS = 3;
const PER_LINE = 5;
// One loop of the story, in seconds.
const T_BRAND = 1.2;
const T_SYSTEM = 1.2;
const T_NODE = 0.7;
const T_PROFIT = 3.6;
const T_REST = 1.0;

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Icon on a rounded card, drawn once to a canvas so the sprite has soft corners. */
function cardTexture(img: HTMLImageElement, surface: string, border: string): CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const r = 52;
  g.beginPath();
  g.moveTo(r, 2);
  g.arcTo(s - 2, 2, s - 2, s - 2, r);
  g.arcTo(s - 2, s - 2, 2, s - 2, r);
  g.arcTo(2, s - 2, 2, 2, r);
  g.arcTo(2, 2, s - 2, 2, r);
  g.closePath();
  g.fillStyle = surface;
  g.fill();
  g.save();
  g.clip();
  g.drawImage(img, 0, 0, s, s);
  g.restore();
  g.lineWidth = 3;
  g.strokeStyle = border;
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function mount(el: HTMLElement): Promise<void> {
  const labels = Array.from(el.querySelectorAll<HTMLElement>("[data-node]"));
  const flow = Array.from((el.parentElement || el).querySelectorAll<HTMLElement>("[data-flow]"));
  const core = el.querySelector<HTMLElement>("[data-core]");
  const n = labels.length;
  if (!n) return;

  // Probe first: three logs console errors when it cannot get a context, and
  // "no WebGL" is an expected state here, not an error. The server-rendered
  // diagram simply stays.
  const canvas = document.createElement("canvas");
  const attrs: WebGLContextAttributes = { antialias: true, alpha: true, powerPreference: "low-power" };
  const gl = hardwareWebGL2(canvas, attrs);
  if (!gl) return;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: gl, ...attrs });
  } catch {
    return;
  }

  const text = cssVar("--color-text", "#1a1a1a");
  const faint = cssVar("--color-text-faint", "#9c9993");
  const surface = cssVar("--color-surface", "#fdfdfc");
  const accent = "#c08a2e";

  const images = await Promise.all(
    labels.map((l) => {
      const img = l.querySelector("img");
      return loadImage(img ? img.currentSrc || img.src : "");
    })
  );

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 6.6, 9.4);
  camera.lookAt(0, -0.5, 0);
  scene.add(new HemisphereLight(0xffffff, 0xd8d5ce, 1.5));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 6, 4);
  scene.add(key);

  // The creator / brand.
  const coreMat = new MeshStandardMaterial({ color: new Color(text), flatShading: true, roughness: 0.85 });
  const coreMesh = new Mesh(new IcosahedronGeometry(0.6, 1), coreMat);
  scene.add(coreMesh);
  const ringMat = new MeshStandardMaterial({ color: new Color(accent), roughness: 0.6, transparent: true, opacity: 0 });
  const ring = new Mesh(new TorusGeometry(0.95, 0.02, 8, 72), ringMat);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  const orbitMat = new MeshStandardMaterial({ color: new Color(faint), transparent: true, opacity: 0.35 });
  const orbit = new Mesh(new TorusGeometry(RADIUS, 0.008, 6, 128), orbitMat);
  orbit.rotation.x = Math.PI / 2;
  scene.add(orbit);

  const wheel = new Group();
  scene.add(wheel);

  const sprites: Sprite[] = [];
  const lineMats: LineBasicMaterial[] = [];
  const local: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = new Vector3(Math.sin(a) * RADIUS, 0, Math.cos(a) * RADIUS);
    local.push(p);
    const mat = new SpriteMaterial({ map: cardTexture(images[i], surface, "rgba(26,26,26,0.14)"), transparent: true });
    const sp = new Sprite(mat);
    sp.position.copy(p);
    wheel.add(sp);
    sprites.push(sp);
    const lm = new LineBasicMaterial({ color: new Color(text), transparent: true, opacity: 0 });
    const lg = new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), p]);
    wheel.add(new Line(lg, lm));
    lineMats.push(lm);
  }

  // Particles travelling along the spokes.
  const pPos = new Float32Array(n * PER_LINE * 3);
  const pGeo = new BufferGeometry();
  pGeo.setAttribute("position", new BufferAttribute(pPos, 3));
  const pMat = new PointsMaterial({ color: new Color(accent), size: 0.11, sizeAttenuation: true, transparent: true, opacity: 0.95 });
  const points = new Points(pGeo, pMat);
  points.frustumCulled = false;
  wheel.add(points);

  canvas.className = "lb-diagram__canvas";
  canvas.setAttribute("aria-hidden", "true");
  el.appendChild(canvas);
  el.classList.add("is-live");

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const total = T_BRAND + T_SYSTEM + n * T_NODE + T_PROFIT + T_REST;
  const lit = new Float32Array(n);
  const v = new Vector3();
  const edge = new Vector3();
  const up = new Vector3();
  let w = 0;
  let h = 0;

  function resize() {
    const r = el.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole wheel inside narrow (portrait) stages.
    camera.fov = camera.aspect < 1 ? 32 / camera.aspect : 32;
    camera.updateProjectionMatrix();
  }

  function frame(t: number) {
    // Where we are in the story. Reduced motion pins the finished state.
    const c = reduce ? T_BRAND + T_SYSTEM + n * T_NODE + T_PROFIT * 0.5 : t % total;
    const sys = Math.min(1, Math.max(0, (c - T_BRAND) / T_SYSTEM));
    const nodesStart = T_BRAND + T_SYSTEM;
    const profitStart = nodesStart + n * T_NODE;
    const profit = c >= profitStart && c < profitStart + T_PROFIT;
    const fade = c > total - T_REST ? Math.max(0, (total - c) / T_REST) : 1;
    const stage = c < T_BRAND ? 0 : c < nodesStart ? 1 : c < profitStart ? 2 : 3;

    wheel.rotation.y = reduce ? 0.35 : t * 0.07;
    coreMesh.rotation.y = reduce ? 0.6 : t * 0.25;
    coreMesh.rotation.x = 0.3;
    const pulse = c < T_BRAND ? Math.sin((c / T_BRAND) * Math.PI) : 0;
    coreMesh.scale.setScalar(1 + pulse * 0.1);
    ringMat.opacity = profit ? 0.9 * fade : 0;
    ring.scale.setScalar(profit && !reduce ? 1 + 0.08 * Math.sin((c - profitStart) * 3.2) : 1);

    for (let i = 0; i < n; i++) {
      const target = Math.min(1, Math.max(0, (c - nodesStart - i * T_NODE) / (T_NODE * 0.6))) * fade;
      lit[i] = target;
      const s = 0.66 + 0.26 * target;
      sprites[i].scale.set(s, s, 1);
      (sprites[i].material as SpriteMaterial).opacity = 0.38 + 0.62 * target;
      lineMats[i].opacity = (0.1 * sys + 0.3 * target) * fade;
      for (let k = 0; k < PER_LINE; k++) {
        let u = (t * 0.32 + k / PER_LINE + i * 0.13) % 1;
        if (profit) u = 1 - u; // profit flows back to the creator
        const o = (i * PER_LINE + k) * 3;
        if (target > 0.5) {
          pPos[o] = local[i].x * u;
          pPos[o + 1] = 0;
          pPos[o + 2] = local[i].z * u;
        } else {
          pPos[o] = pPos[o + 2] = 0;
          pPos[o + 1] = -99; // parked out of view
        }
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    // Labels are real DOM text; place each under its card.
    for (let i = 0; i < n; i++) {
      sprites[i].getWorldPosition(v);
      v.project(camera);
      const depth = (v.z + 1) / 2;
      const x = (v.x * 0.5 + 0.5) * w;
      // The card's bottom edge on screen, so the label always clears it.
      sprites[i].getWorldPosition(edge).addScaledVector(up, -sprites[i].scale.y / 2);
      edge.project(camera);
      const y = (-edge.y * 0.5 + 0.5) * h + 3;
      const l = labels[i];
      // The (hidden) icon box stays in the label's layout, so lift the label by its height.
      l.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-1 * var(--lb-node-img, 38px) - 4px))`;
      l.style.opacity = (0.45 + 0.55 * lit[i]).toFixed(2);
      l.style.zIndex = String(100 - Math.round(depth * 100));
    }
    if (core) core.style.opacity = stage === 0 || stage === 3 ? "1" : "0.6";
    flow.forEach((f, i) => f.classList.toggle("is-on", reduce ? true : i === stage));
  }

  resize();
  frame(0);

  let visible = true;
  let lost = false;
  let raf = 0;
  let t0 = 0;
  let elapsed = 0;
  function loop(now: number) {
    raf = 0;
    if (!t0) t0 = now;
    elapsed += Math.min(0.1, (now - t0) / 1000);
    t0 = now;
    frame(elapsed);
    schedule();
  }
  function schedule() {
    if (reduce || lost || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    t0 = 0;
  }

  new ResizeObserver(() => {
    if (lost) return;
    resize();
    frame(elapsed);
  }).observe(el);
  new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) schedule();
    else stop();
  }).observe(el);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : schedule()));
  // A lost context shows the static diagram again; a restored one resumes
  // (three re-creates its GL state, the scene graph is untouched).
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    stop();
    el.classList.remove("is-live");
    labels.forEach((l) => l.removeAttribute("style"));
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    el.classList.add("is-live");
    resize();
    frame(elapsed);
    schedule();
  });
  schedule();
}
