/**
 * 学习画布 bundle 补丁：注入第 4 种节点类型「复习与检测」(review)
 * - 每个补丁都先验证锚点唯一存在，任一失败则整体中止、不写盘
 * - 原文件先备份到 server/patch-backup/
 */
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
const JS = path.join(DIST, 'assets', 'index-CetlzhQm.js');
const CSS = path.join(DIST, 'assets', 'index-CesZhqQ9.css');
const HTML = path.join(DIST, 'index.html');
const BACKUP = path.join(__dirname, 'patch-backup');

const read = (p) => fs.readFileSync(p, 'utf8');
let js = read(JS);
const jsOrig = js;

const patches = [];
function patch(name, find, replace) {
  const n = js.split(find).length - 1;
  if (n !== 1) {
    console.error(`✗ [${name}] 锚点出现 ${n} 次（期望 1 次），中止`);
    process.exit(1);
  }
  js = js.replace(find, replace);
  patches.push(name);
  console.log(`✓ ${name}`);
}

// 1. 类型表：label / short 徽标 / rank
patch('类型表 +review',
  'practice:{label:`练习`,short:`练`,rank:2}}',
  'practice:{label:`练习`,short:`练`,rank:2},review:{label:`复习与检测`,short:`复`,rank:3}}');

// 2. 侧栏「添加功能块」按钮列表
patch('节点库 +review',
  '{type:`practice`,title:`练习`,description:`在路径末端安排巩固任务`}]',
  '{type:`practice`,title:`练习`,description:`在路径末端安排巩固任务`},{type:`review`,title:`复习与检测`,description:`遗忘曲线提醒复习、错题还原重做与错题引导，双击节点打开`}]');

// 3. 新建节点的默认字段
patch('默认值 +review',
  'practice:{title:`新练习`,description:`选择题目或任务，检验前面知识点是否真正掌握。`,duration:20,status:`待完成`}}',
  'practice:{title:`新练习`,description:`选择题目或任务，检验前面知识点是否真正掌握。`,duration:20,status:`待完成`},review:{title:`复习与检测`,description:`双击节点打开复习面板：按遗忘曲线复习、错题重做与三层引导。`,duration:20,status:`待复习`}}');

// 4. 图谱导入的类型白名单（不 加 会被降级成 concept）
patch('导入白名单 +review',
  'let t=[`chapter`,`concept`,`practice`];',
  'let t=[`chapter`,`concept`,`practice`,`review`];');

// 5. 连线规则：允许 主题→复习与检测、知识点→复习与检测
patch('连线规则 放行 review(1)',
  'e.type===`chapter`&&t.type!==`concept`?{ok:!1,reason:`主题节点只能连接到知识点`}',
  'e.type===`chapter`&&t.type!==`concept`&&t.type!==`review`?{ok:!1,reason:`主题节点只能连接到知识点或复习与检测`}');
patch('连线规则 放行 review(2)',
  'e.type===`concept`&&![`concept`,`practice`].includes(t.type)',
  'e.type===`concept`&&![`concept`,`practice`,`review`].includes(t.type)');

// 6. 新连线的关系自动命名
patch('连线关系 +复习',
  'xe=(e,t)=>e.type===`chapter`?`包含`:t.type===`practice`?`巩固`:`先修`',
  'xe=(e,t)=>e.type===`chapter`?`包含`:t.type===`review`?`复习`:t.type===`practice`?`巩固`:`先修`');

// 7. 底部图例（静态 HTML 片段）
patch('图例 +review',
  'legend-practice" data-v-9a16e909></i>练习</span>',
  'legend-practice" data-v-9a16e909></i>练习</span><span data-v-9a16e909><i class="legend-review" data-v-9a16e909></i>复习与检测</span>');

// ---- 写盘前备份 ----
fs.mkdirSync(BACKUP, { recursive: true });
for (const p of [JS, CSS, HTML]) {
  const dst = path.join(BACKUP, path.basename(p));
  if (!fs.existsSync(dst)) fs.copyFileSync(p, dst);
}
fs.writeFileSync(JS, js, 'utf8');
console.log(`\nJS 补丁完成：${patches.length} 处（原文件 ${jsOrig.length} → ${js.length} 字节）`);

// ---- CSS：补 review 配色 ----
let css = read(CSS);
const cssAdd = [
  // 变量定义（加在 .canvas-page 的变量表里）
  ['--canvas-practice:#b45309;', '--canvas-practice:#b45309;--canvas-review:#7c3aed;'],
  // 节点左侧色条
  ['.knowledge-node.is-practice .node-accent[data-v-9a16e909]{background:var(--canvas-practice)}',
   '.knowledge-node.is-practice .node-accent[data-v-9a16e909]{background:var(--canvas-practice)}.knowledge-node.is-review .node-accent[data-v-9a16e909]{background:var(--canvas-review)}'],
  // 节点类型徽标
  ['.knowledge-node.is-practice .node-kind-mark[data-v-9a16e909]{color:var(--canvas-practice);background:#b4530917}',
   '.knowledge-node.is-practice .node-kind-mark[data-v-9a16e909]{color:var(--canvas-practice);background:#b4530917}.knowledge-node.is-review .node-kind-mark[data-v-9a16e909]{color:var(--canvas-review);background:#7c3aed17}'],
  // 侧栏库图标
  ['.library-item.is-practice .library-icon[data-v-9a16e909]{color:var(--canvas-practice);background:#b4530917}',
   '.library-item.is-practice .library-icon[data-v-9a16e909]{color:var(--canvas-practice);background:#b4530917}.library-item.is-review .library-icon[data-v-9a16e909]{color:var(--canvas-review);background:#7c3aed17}'],
  // 图例
  ['.canvas-legend .legend-practice[data-v-9a16e909]{background:var(--canvas-practice)}',
   '.canvas-legend .legend-practice[data-v-9a16e909]{background:var(--canvas-practice)}.canvas-legend .legend-review[data-v-9a16e909]{background:var(--canvas-review)}'],
];
let cssOk = 0;
for (const [find, replace] of cssAdd) {
  if (css.includes(find)) { css = css.replace(find, replace); cssOk++; }
  else console.error(`⚠ CSS 锚点未找到：${find.slice(0, 50)}…`);
}
fs.writeFileSync(CSS, css, 'utf8');
console.log(`CSS 补丁完成：${cssOk}/${cssAdd.length} 处`);

// ---- index.html：双击 review 节点打开复习模块 + OffscreenCanvas 兼容层 ----
let html = read(HTML);

// 7.5 兼容层：旧内核（如内嵌预览 webview）没有 transferControlToOffscreen，
//     tsParticles 初始化会直接抛错导致整页白屏。用普通 canvas 透传顶上。
const POLYFILL = `<script data-offscreen-polyfill>
  if (typeof window.OffscreenCanvas === 'undefined') {
    window.OffscreenCanvas = class {
      constructor(w, h) {
        this.width = w; this.height = h;
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        this.__c = c;
      }
      getContext(t) { return this.__c.getContext(t); }
      transferToImageBitmap() { return null; }
      convertToBlob(o) { return new Promise(function (r) { this.__c.toBlob(r, o && o.type, o && o.quality); }.bind(this)); }
    };
  }
  if (window.HTMLCanvasElement && !window.HTMLCanvasElement.prototype.transferControlToOffscreen) {
    window.HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
      var c = this;
      return {
        get width() { return c.width; }, set width(v) { c.width = v; },
        get height() { return c.height; }, set height(v) { c.height = v; },
        getContext: function (t, o) { return c.getContext(t, o); },
        style: c.style,
        addEventListener: function () { return c.addEventListener.apply(c, arguments); },
        removeEventListener: function () { return c.removeEventListener.apply(c, arguments); },
        getBoundingClientRect: function () { return c.getBoundingClientRect(); },
        toDataURL: function () { return c.toDataURL.apply(c, arguments); },
        toBlob: function () { return c.toBlob.apply(c, arguments); }
      };
    };
  }
</script>
`;
if (!html.includes('data-offscreen-polyfill')) {
  html = html.replace('<script type="module"', POLYFILL + '<script type="module"');
  console.log('HTML 补丁完成：注入 OffscreenCanvas 兼容层');
} else {
  console.log('HTML 已含 OffscreenCanvas 兼容层，跳过');
}

if (!html.includes('data-review-bridge')) {
  const bridge = `<script data-review-bridge>
  /* 双击「复习与检测」节点（类型徽标为「复」）→ 新窗口打开复习模块 */
  document.addEventListener('dblclick', function (e) {
    if (!(e.target instanceof Element)) return;
    var card = e.target.closest('.knowledge-node');
    if (!card || !card.classList.contains('is-review')) return;
    window.open('review/index.html#/review-test', '_blank');
  });
</script>
`;
  html = html.replace('<script type="module"', bridge + '<script type="module"');
  fs.writeFileSync(HTML, html, 'utf8');
  console.log('HTML 补丁完成：注入双击桥接脚本');
} else {
  console.log('HTML 已含桥接脚本，跳过');
}

console.log('\n全部补丁应用完毕。');
