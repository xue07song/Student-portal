/**
 * 无头诊断：用 jsdom 加载画布 bundle，抓运行时报错
 * 用法：node diagnose.mjs <bundle路径>
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

const req = createRequire('C:/Users/Administrator/Desktop/review and assessment/package.json');
const { JSDOM } = req('jsdom');

const bundle = process.argv[2];
if (!bundle) { console.error('缺少 bundle 路径'); process.exit(1); }

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://127.0.0.1:5173/',
  pretendToBeVisual: true,
});

const { window } = dom;
const g = globalThis;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'NodeList',
  'CustomEvent', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'InputEvent', 'UIEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage',
  'matchMedia', 'devicePixelRatio', 'location', 'history', 'MutationObserver', 'ResizeObserver',
  'IntersectionObserver', 'screen', 'addEventListener', 'removeEventListener', 'dispatchEvent']) {
  if (window[k] !== undefined) { try { g[k] = window[k]; } catch (_) { /* 只读的跳过 */ } }
}
g.devicePixelRatio = 1;
g.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });

// canvas 2d 桩：jsdom 没有实现，tsParticles 初始化会拿到 null
const noopCtx = () => new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return null;
    if (typeof p === 'symbol') return undefined;
    if (!(p in t)) t[p] = (..._a) => noopCtx();
    return t[p];
  },
  set: () => true,
});
if (window.HTMLCanvasElement) {
  g.HTMLCanvasElement = window.HTMLCanvasElement;
  window.HTMLCanvasElement.prototype.getContext = function () { return noopCtx(); };
}

// OffscreenCanvas 垫片（与 index.html 里注入的兼容层同款）
if (window.HTMLCanvasElement && !window.HTMLCanvasElement.prototype.transferControlToOffscreen) {
  window.HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    const c = this;
    return {
      get width() { return c.width; }, set width(v) { c.width = v; },
      get height() { return c.height; }, set height(v) { c.height = v; },
      getContext: (t, o) => c.getContext(t, o),
      style: c.style,
      addEventListener: (...a) => c.addEventListener(...a),
      removeEventListener: (...a) => c.removeEventListener(...a),
      getBoundingClientRect: () => c.getBoundingClientRect(),
      toDataURL: (...a) => c.toDataURL(...a),
      toBlob: (...a) => c.toBlob(...a),
    };
  };
}
if (!window.OffscreenCanvas) {
  window.OffscreenCanvas = class {
    constructor(w, h) {
      this.width = w; this.height = h;
      const c = window.document.createElement('canvas'); c.width = w; c.height = h;
      this.__c = c;
    }
    getContext(type) { return this.__c.getContext(type); }
    transferToImageBitmap() { return null; }
    convertToBlob(opt) { return new Promise((res) => this.__c.toBlob(res, opt && opt.type, opt && opt.quality)); }
  };
  g.OffscreenCanvas = window.OffscreenCanvas;
}
if (!g.matchMedia) g.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!g.IntersectionObserver) g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

const errors = [];
window.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.error?.stack || e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason?.stack || e.reason)));
g.reportError = (e) => errors.push('reportError: ' + (e?.stack || e));

const url = pathToFileURL(path.resolve(bundle)).href;
console.log('加载:', url);

try {
  await import(url);
  console.log('模块加载完成（顶层无同步异常）');
} catch (e) {
  console.log('✗ 顶层加载异常:');
  console.log(e?.stack || e);
  process.exit(1);
}

// 等异步渲染
await new Promise((r) => setTimeout(r, 1500));

const app = window.document.querySelector('#app');
const html = app ? app.innerHTML.trim() : '';
console.log('');
console.log('=== 结果 ===');
console.log('#app 内容长度:', html.length);
if (html) console.log('#app 前 200 字符:', html.slice(0, 200).replace(/\n/g, ' '));
console.log('捕获错误数:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('---\n' + e.slice(0, 1200)));
