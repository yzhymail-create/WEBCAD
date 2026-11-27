// ===== 可调布局试点（2026-11-27）：拖节点调布局 =====
// 口径（2026-11-27 11:31 用户纠正，以此为准）：
//  - 长度是线段的属性参数，不是 1:1 几何量；2D 图只是图示展示，不是实际长度。
//  - 拖节点只改图示坐标（节点 x/y、路径 points、pieces pts 的图示位置），
//    长度等属性参数（len_3d / len_2d / merged_from 长度）原样保留、绝不重算、绝不写回几何长度。
//  - 不按图示几何长度判对错，不标红，不拦保存。
//  - 节点 x/y 就是相连路径 points 的端点，拖节点时端点必须跟动，中间折点不动；
//    pieces 里以该节点为 na/nb 的段端点一起移。
//  - 长度/名称文字按 ID 绑在对应线段/节点上：拖动后标签位置自动跟随，文字内容不变。
// 2026-11-27 11:42 用户看截图后定新规：
//  - 调整时把节点到节点之间的线段拉直：拖某节点时，与该节点相连的每条路径
//    （node0-node1）图示 points 只保留两端直连，中间折点去掉；未拖动的路径保持原样，
//    不一打开就全图拉直。拉直只改图示坐标，属性一律不变；撤销恢复原折线。
//  - 长度标注文字放在线段中间、平行于线段：拉直后取直线段中点，未拉直取折线弧长中点；
//    文字沿线段方向旋转，角度超过 90 度翻转 180 度保证可读；法向微偏移防压线。
// 2026-11-27 12:21 用户曾定调整时隐藏全部参数标签；2026-11-27 20:28 用户发截图纠正
//  （取代 12:21 全隐藏）：调整的时候，用户在标签下拉里选择显示的要显示出来——
//  调整模式下标签显隐完全跟随四开关 labelVis（applyView 决定）：勾选的显示
//  （含拖动中/拖动后），未勾选的不显示；调整时改勾选即时生效。
//  不再加 #svg.edit-on 强制隐藏 CSS，不改 labelVis；标签绑 ID 跟随拖动、文字不变、
//  长度居中平行等既有规则不变。只改显示，不改数据。
// 2026-11-27 17:43 用户发截图定：调整时不要浮窗——调整模式下不显示任何浮窗/详情弹窗：
//  点按节点、拖动中、松手定版都不弹节点信息框（#editPanel）与详情弹窗（#popup）；
//  进入调整模式时已打开的浮窗立即关掉；退出调整后弹窗恢复原有行为。
//  工具栏按钮区（.bar：调整开关/撤销/保存等）是操作 UI，保留，不算浮窗。
// 2026-11-27 20:41 用户发截图定：文字位置再优化，不要与图中的线干涉——
//  长度标签仍居中平行，但法向改取字身方向 u（见 midpointPerp），整行字偏到
//  线的一侧不压线；节点名/真名不再一律贴右侧，按 8 方位打分选离线最远的
//  方位（见 fixNodeLabels，包在 applyView 后执行）；白色描边只作兜底。
//  只改文字摆放，不改文字内容与数据；拖动后按新方向自动重摆。
// 2026-11-27 21:36 用户语音定两点：
//  ① 调整改「双击选中、再拖动」，防手机滑图面误拖：调整模式内双击节点才选中
//     （红环标记，只选一个），只有已选中节点能拖；没选中的节点按住滑动只平移
//     图面。单击/点按别处取消选中（点另一个节点单击只取消、不直接选中新节点，
//     新节点仍需双击）。双击空白保持原双击放大，双击节点优先选中不放大
//     （dblclick 钩子 __editDbl 在原放大前拦截，见构建脚本补丁）。手机双击手势
//     靠指针点按两次判定（450ms 内同节点两次点按），与鼠标双击同一口径。
//     选中状态只是交互状态，不进保存数据；只看模式行为不变。
//  ② 长度标签贴近线段：偏移 12px→8px 屏幕像素（线半宽约 2.5 + 字下伸约 2.75
//     + 描边半宽约 1.5 + 净空约 1.25），字贴线但不压线，白色描边兜底保留。
// 手感借 velxio：拖动时预览、松手才定版；网格吸附可选，默认关。
// 保存下载改后的 layout.json（FULL_LAYOUT 全量字段保留，meta 注明 schematic 图示布局），
// 可重新导入继续改；不存服务器。
(function () {
  var editMode = false;
  window.__editMode = false; // 供原查看器 showNode/showBranch 守卫读取（构建时注入）
  var snapOn = false;
  var snapStep = 5;
  var undoStack = [];
  var UNDO_CAP = 50;
  var editedNodes = {}; // code -> true（保存时写入 meta）
  var drag = null; // {pointerId, code, startX, startY, origX, origY, snap, moved, tapT}
  var fullNodes = {}, fullBranches = {};
  // 双击选中状态（2026-11-27 21:36 用户定）：只在调整模式内有效，不进保存数据
  var selectedCode = null;
  var tapCand = null; // {pointerId, x, y, t} 本次按下候选点按（未开拖时记录，抬起时判点按/双击）
  var lastTap = null; // {code, x, y, t} 上一次点按（判双击手势用）
  // 选中红环：挂在 vp 里随视图变换，半径/线宽按屏幕像素恒定（updateSelRing 维护）
  var selRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  selRing.setAttribute('class', 'edit-selring');
  selRing.setAttribute('fill', 'none');
  selRing.setAttribute('stroke', '#e03131');
  selRing.style.display = 'none';
  selRing.style.pointerEvents = 'none';
  vp.appendChild(selRing);
  function updateSelRing() {
    if (!selectedCode || !editMode) { selRing.style.display = 'none'; return; }
    var n = nodesByCode[selectedCode];
    if (!n) { selRing.style.display = 'none'; return; }
    var rect = svg.getBoundingClientRect();
    var scale = (rect.width / svg.viewBox.baseVal.width) * view.k;
    if (!(scale > 0)) return;
    var nNodes = Object.keys(nodesByCode).length;
    var DOT_R = nNodes <= 150 ? 12 : Math.max(5, Math.round(12 * Math.sqrt(150 / nNodes)));
    var dr = (n.type === 'connector' || n.type === 'clamp') ? DOT_R : Math.max(3, Math.round(DOT_R / 2));
    selRing.setAttribute('cx', n.x);
    selRing.setAttribute('cy', -n.y);
    selRing.setAttribute('r', (dr + 7) / scale);
    selRing.setAttribute('stroke-width', 2.5 / scale);
    selRing.style.display = '';
  }
  function selectNode(code) {
    if (selectedCode && nodeEls[selectedCode]) nodeEls[selectedCode].classList.remove('edit-sel');
    selectedCode = code;
    if (code && nodeEls[code]) nodeEls[code].classList.add('edit-sel');
    updateSelRing();
  }
  function clearEditSel() {
    if (selectedCode && nodeEls[selectedCode]) nodeEls[selectedCode].classList.remove('edit-sel');
    selectedCode = null;
    updateSelRing();
  }

  function rebuildFullMaps() {
    fullNodes = {}; fullBranches = {};
    (FULL_LAYOUT.nodes || []).forEach(function (n) { fullNodes[n.code] = n; });
    (FULL_LAYOUT.branches || []).forEach(function (b) { fullBranches[b.key] = b; });
  }
  rebuildFullMaps();

  // 元素索引：分支 key 含反斜杠（如 Test-4304050\Test ...），拼 CSS 属性选择器会失效，
  // 一律按 getAttribute 建索引，不拼选择器（2026-11-27 自测实测：选择器找不到管子、线不跟动）。
  // 另：地板数据有 9 个重复分支 key（同名管子靠端点区分），按 key 索引会串位，
  // 故管子/长度标签按 DOM 顺序与 DATA.branches 下标对齐（生成器同序输出）。
  var tubeElList = [], lenElList = [], nodeEls = {};
  function rebuildElMaps() {
    tubeElList = Array.prototype.slice.call(document.querySelectorAll('.tube'));
    lenElList = Array.prototype.slice.call(document.querySelectorAll('.lenlbl'));
    nodeEls = {};
    document.querySelectorAll('.node').forEach(function (el) { nodeEls[el.getAttribute('data-code')] = el; });
  }
  rebuildElMaps();

  function r3(v) { return Math.round(v * 1000) / 1000; }

  // 弧长中点 + 法向（2026-11-27 20:41 用户定：文字不要与图中的线干涉）。
  // 长度标签仍居中、平行于线段（11:42 规则不变），但偏移方向必须选在
  // 「字身长出去的那一侧」：SVG 文字基线在 (lx,ly)，字身从基线向文字上方
  // 长约 0.75em、下方只有约 0.25em。旧口径法向只按布局坐标取一侧，竖线
  // 向上段（如 BN55→CLP45 的 165）法向与字身方向相反，字身横跨基线往线
  // 那边长，10px 偏移不够，线从字中间穿过。
  // 新口径（全程 SVG 坐标，y 朝下）：先算可读方向角 ang（超过 90 度翻转
  // 180 度防倒字，与原规则一致），字身方向 u=(sinA,-cosA)（A 为 ang 弧度，
  // 即 rotate(ang) 作用在文字上方 (0,-1) 上），法向就取 u——基线沿 u 偏到
  // 线的一侧，字身继续往外长，离线最近的只有基线下方约 0.25em 的下伸部。
  // 偏移量由 applyView 的 lenOff 给（屏幕 8px，2026-11-27 21:36 用户定贴近线：
  // 线半宽约 2.5 + 字下伸约 2.75（0.25em 保守值，数字实际无下伸）+ 描边半宽
  // 约 1.5 + 净空约 1.25 ≈ 8）：字贴线但不压线。横线时 u=(0,-1) 与旧
  // 口径一致（字在线上方），竖线/斜线自动选对侧，方向稳定可说清。
  function midpointPerp(pts) {
    var total = 0, segLens = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segLens.push(L); total += L;
    }
    var half = total / 2, acc = 0;
    for (var j = 0; j + 1 < pts.length; j++) {
      var Lj = segLens[j];
      if (Lj > 0 && acc + Lj >= half) {
        var t = (half - acc) / Lj;
        var mx = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;
        var my = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
        // SVG 坐标方向（布局 y 朝上，SVG y 朝下，故 dy 取负）
        var dx = (pts[j + 1][0] - pts[j][0]) / Lj, dy = -(pts[j + 1][1] - pts[j][1]) / Lj;
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
        var rad = ang * Math.PI / 180;
        return { mx: mx, my: -my, px: Math.sin(rad), py: -Math.cos(rad), ang: ang };
      }
      acc += Lj;
    }
    var mid = pts[Math.floor(pts.length / 2)];
    return { mx: mid[0], my: -mid[1], px: 0, py: -1, ang: 0 };
  }

  function affectedIdx(code) {
    var out = [];
    DATA.branches.forEach(function (b, idx) {
      var hit = (b.node0 === code || b.node1 === code);
      if (!hit) {
        for (var i = 0; i < (b.pieces || []).length; i++) {
          if (b.pieces[i].na === code || b.pieces[i].nb === code) { hit = true; break; }
        }
      }
      if (hit) out.push(idx);
    });
    return out;
  }
  function affectedBranches(code) {
    return affectedIdx(code).map(function (i) { return DATA.branches[i]; });
  }

  // 把一个分支对象（DATA 或 FULL_LAYOUT 里的）按节点新坐标更新图示端点。
  // 只改图示坐标：len_3d / len_2d / merged_from 长度等属性参数一律不动、不重算。
  // 2026-11-27 11:42 新规：被拖节点相连的路径（node0/node1 命中）图示拉直——
  // points 只保留两端节点直连，中间折点去掉；pieces 只更新触及该节点的段端点，
  // 段结构与属性保留（DXF 的 LENGTH 块仍按 pieces 出，撤销靠快照恢复原折线）。
  function applyPieceEnds(b, code, nx, ny) {
    (b.pieces || []).forEach(function (pc) {
      if (pc.na === code) pc.pts[0] = [nx, ny];
      if (pc.nb === code) pc.pts[pc.pts.length - 1] = [nx, ny];
    });
  }
  function applyToBranch(b, code, nx, ny, posOf) {
    var hitEnd = (b.node0 === code || b.node1 === code);
    if (hitEnd && b.node0 !== b.node1 && posOf) {
      var p0 = b.node0 === code ? [nx, ny] : posOf(b.node0);
      var p1 = b.node1 === code ? [nx, ny] : posOf(b.node1);
      if (p0 && p1) b.points = [[p0[0], p0[1]], [p1[0], p1[1]]];
      else { // 找不到对端节点时退回只更新端点，不丢折点
        if (b.node0 === code) b.points[0] = [nx, ny];
        if (b.node1 === code) b.points[b.points.length - 1] = [nx, ny];
      }
    } else {
      if (b.node0 === code) b.points[0] = [nx, ny];
      if (b.node1 === code) b.points[b.points.length - 1] = [nx, ny];
    }
    applyPieceEnds(b, code, nx, ny);
  }

  function snapshotOf(code, idxs) {
    var n = nodesByCode[code];
    return {
      code: code, x: n.x, y: n.y,
      branches: idxs.map(function (idx) {
        var b = DATA.branches[idx];
        return {
          idx: idx, key: b.key,
          points: JSON.parse(JSON.stringify(b.points)),
          pieces: (b.pieces || []).map(function (pc) { return JSON.parse(JSON.stringify(pc.pts)); })
        };
      })
    };
  }
  function restoreSnapshot(snap) {
    moveNodeInternal(snap.code, snap.x, snap.y, true);
    // moveNodeInternal 已按端点规则恢复点位；再把折点全量写回，保证与快照逐点一致
    snap.branches.forEach(function (sb) {
      [DATA.branches[sb.idx], FULL_LAYOUT.branches[sb.idx]].forEach(function (b) {
        if (!b || b.key !== sb.key) return;
        b.points = JSON.parse(JSON.stringify(sb.points));
        (b.pieces || []).forEach(function (pc, i) { if (sb.pieces[i]) pc.pts = JSON.parse(JSON.stringify(sb.pieces[i])); });
      });
      renderBranchIdx(sb.idx);
    });
    renderNode(snap.code);
    applyView();
  }

  function moveNodeInternal(code, nx, ny, skipHistory) {
    var n = nodesByCode[code];
    if (!n) return [];
    var idxs = affectedIdx(code);
    n.x = nx; n.y = ny;
    if (fullNodes[code]) { fullNodes[code].x = nx; fullNodes[code].y = ny; }
    idxs.forEach(function (idx) {
      var b = DATA.branches[idx];
      applyToBranch(b, code, nx, ny, function (c) {
        var nn = nodesByCode[c]; return nn ? [nn.x, nn.y] : null;
      });
      var fb = FULL_LAYOUT.branches[idx];
      if (fb && fb.key === b.key) applyToBranch(fb, code, nx, ny, function (c) {
        var fn = fullNodes[c]; return fn ? [fn.x, fn.y] : null;
      });
      renderBranchIdx(idx);
    });
    renderNode(code);
    return idxs.map(function (i) { return DATA.branches[i]; });
  }

  function renderNode(code) {
    var n = nodesByCode[code];
    var g = nodeEls[code];
    if (!n || !g) return;
    var dot = g.querySelector('.ndot'), hit = g.querySelector('.nhit');
    if (dot) { dot.setAttribute('cx', n.x); dot.setAttribute('cy', -n.y); }
    if (hit) { hit.setAttribute('cx', n.x); hit.setAttribute('cy', -n.y); }
    g.querySelectorAll('.lbl,.nmlbl').forEach(function (t) {
      t.setAttribute('data-nx', n.x); t.setAttribute('data-ny', -n.y);
    });
  }
  function renderBranchIdx(idx) {
    var b = DATA.branches[idx];
    if (!b) return;
    var pl = tubeElList[idx];
    if (pl && pl.getAttribute('data-key') === b.key) {
      pl.setAttribute('points', b.points.map(function (p) { return p[0].toFixed(2) + ',' + (-p[1]).toFixed(2); }).join(' '));
    }
    var ll = lenElList[idx];
    if (ll && ll.getAttribute('data-key') !== b.key) ll = null;
    if (ll) {
      var mp = midpointPerp(b.points);
      ll.setAttribute('data-mx', mp.mx.toFixed(2));
      ll.setAttribute('data-my', mp.my.toFixed(2));
      ll.setAttribute('data-px', mp.px.toFixed(3));
      ll.setAttribute('data-py', mp.py.toFixed(3));
      ll.setAttribute('data-ang', mp.ang.toFixed(2));
      // 长度标签按分支 ID 绑在该线段上：这里只更新位置（新折线弧长中点），
      // 文字内容是 len_3d 属性取整（生成时已写入），拖动后不变、不重算
    }
  }

  // ---- 节点名避线摆放（2026-11-27 20:41 用户定：文字不要与图中的线干涉） ----
  // 旧摆法：编号/真名一律贴圆点右侧、基线在圆心下方 4px，横线穿过节点时
  // 线正好从字身下部穿过（如截图 BN55、CLP41）。新摆法：每个节点在
  // 右/上/左/下/四斜共 8 个方位里选一个放字（编号+真名成一块，行序不变），
  // 按「字块包围盒到附近线段的最小距离」打分，选离线最远的；同分按
  // 右>上>左>下>右上>右下>左上>左下 的固定次序（贴近原有习惯：竖线穿过
  // 的节点字在右侧、横线穿过的在上方）。距离按屏幕像素算（字号屏幕恒定
  // 11px、线宽屏幕恒定，与 applyView 同口径），拖动后方向变了自动重选。
  // 只改文字摆放，不改文字内容与任何数据。白色描边保留作兜底，主办法是挪开。
  // ---- 真实文字测量（2026-11-27 21:38 用户定，借 pretext 的办法） ----
  // pretext（chenglou/pretext，HelloGitHub 第121期）的核心办法：用浏览器字体
  // 引擎作准绳，canvas measureText 测真实字宽并缓存，之后纯算术排版、不碰 DOM。
  // 本试点按此办法自实现（不是引入原库：原库是 TS 多行排版引擎 prepare/layout，
  // 单文件试点只需单行标签真实宽高，内联整库不划算）：font 串从页面实际标签
  // 元素的 computed style 取（字号按屏幕恒定 11px 口径、字体族/字重与 CSS 一致），
  // 测得宽与 ascent/descent 一起缓存；测量失败时退回按字数估算兜底。
  var _measureCtx = null, _measureCache = {};
  function estimateTextWidthPx(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      w += c > 127 ? 11 : (c === 32 ? 3.3 : 6.6);
    }
    return Math.max(w, 6.6);
  }
  function labelFontStr(el) {
    try {
      var cs = getComputedStyle(el);
      return (cs.fontStyle || 'normal') + ' ' + (cs.fontWeight || '400') + ' 11px ' + (cs.fontFamily || 'sans-serif');
    } catch (err) { return '11px sans-serif'; }
  }
  function measureTextBox(str, fontStr) {
    var key = fontStr + '\n' + str;
    if (_measureCache[key]) return _measureCache[key];
    var box = null;
    try {
      if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
      _measureCtx.font = fontStr;
      var m = _measureCtx.measureText(str);
      if (m && m.width > 0) {
        box = {
          w: m.width,
          ascent: (typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0) ? m.actualBoundingBoxAscent : 8.5,
          descent: (typeof m.actualBoundingBoxDescent === 'number') ? m.actualBoundingBoxDescent : 2.5
        };
      }
    } catch (err) { box = null; }
    if (!box) box = { w: estimateTextWidthPx(str), ascent: 8.5, descent: 2.5 };
    _measureCache[key] = box;
    return box;
  }
  function textWidthPx(str, el) {
    return measureTextBox(str, el ? labelFontStr(el) : '11px sans-serif').w;
  }
  // 长度标签偏移按真实字高算（2026-11-27 21:38）：线半宽 + 数字真实下伸 +
  // 描边半宽 1.5 + 净空 1.5，夹在 7~9px（贴线但不压线）；applyView 读此值
  (function () {
    try {
      var lenEl = document.querySelector('.lenlbl');
      var box = measureTextBox('0123456789', lenEl ? labelFontStr(lenEl) : '11px sans-serif');
      var nNodes = Object.keys(nodesByCode).length;
      var DOT_R = nNodes <= 150 ? 12 : Math.max(5, Math.round(12 * Math.sqrt(150 / nNodes)));
      var lineHalf = Math.max(3, Math.round(DOT_R * 2 / 3)) / 2;
      var off = lineHalf + box.descent + 1.5 + 1.5;
      window.__lenOffPx = Math.max(7, Math.min(9, Math.round(off * 2) / 2));
      window.__lenDescentPx = box.descent;
    } catch (err) { window.__lenOffPx = 8; }
  })();
  function ptSegDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L2 = dx * dx + dy * dy;
    var t = L2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
  }
  function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
    function o(px, py, qx, qy, rx, ry) { return (qx - px) * (ry - py) - (qy - py) * (rx - px); }
    var o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy);
    var o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
    return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
  }
  function segSegDist(a, b) {
    if (segCross(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2)) return 0;
    return Math.min(
      ptSegDist(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2), ptSegDist(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
      ptSegDist(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2), ptSegDist(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2));
  }
  function segBboxDist(s, bb) {
    var inB = function (x, y) { return x >= bb.l && x <= bb.r && y >= bb.t && y <= bb.b; };
    if (inB(s.x1, s.y1) || inB(s.x2, s.y2)) return 0;
    var edges = [
      { x1: bb.l, y1: bb.t, x2: bb.r, y2: bb.t }, { x1: bb.r, y1: bb.t, x2: bb.r, y2: bb.b },
      { x1: bb.r, y1: bb.b, x2: bb.l, y2: bb.b }, { x1: bb.l, y1: bb.b, x2: bb.l, y2: bb.t }];
    var d = Infinity;
    for (var i = 0; i < 4; i++) d = Math.min(d, segSegDist(s, edges[i]));
    return d;
  }
  function buildSegsSvg() {
    var segs = [];
    function addPts(pts) {
      for (var i = 0; i + 1 < pts.length; i++) {
        segs.push({ x1: pts[i][0], y1: -pts[i][1], x2: pts[i + 1][0], y2: -pts[i + 1][1] });
      }
    }
    DATA.branches.forEach(function (b) {
      addPts(b.points || []);
      (b.pieces || []).forEach(function (pc) { addPts(pc.pts || []); });
    });
    return segs;
  }
  var LBL_DIRS = [
    { name: 'R', dx: 1, dy: 0 }, { name: 'U', dx: 0, dy: -1 },
    { name: 'L', dx: -1, dy: 0 }, { name: 'D', dx: 0, dy: 1 },
    { name: 'UR', dx: 0.7071, dy: -0.7071 }, { name: 'DR', dx: 0.7071, dy: 0.7071 },
    { name: 'UL', dx: -0.7071, dy: -0.7071 }, { name: 'DL', dx: -0.7071, dy: 0.7071 }];
  function fixNodeLabels() {
    if (view.k < 1.5) return; // 标签未显示时不算（与 applyView 的 showLbl 同口径）
    var rect = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    var scale = (rect.width / vb.width) * view.k;
    if (!(scale > 0)) return;
    var nNodes = Object.keys(nodesByCode).length;
    var DOT_R = nNodes <= 150 ? 12 : Math.max(5, Math.round(12 * Math.sqrt(150 / nNodes)));
    var DOT_R_FORK = Math.max(3, Math.round(DOT_R / 2));
    var segs = buildSegsSvg();
    // 实际可见范围（viewBox 坐标）：preserveAspectRatio=meet 等比留边时，
    // 屏幕上看得见的 viewBox 范围比 vb 本身大，不能拿 vb 当视口裁剪
    // （2026-11-27 自测实测：BN32 等在屏幕上看得见却被 vb 口径误裁）
    var vis = null, marginVb = 170 / (rect.width / vb.width);
    try {
      var ctm = svg.getScreenCTM();
      if (ctm) {
        var inv = ctm.inverse();
        var p1 = svg.createSVGPoint(); p1.x = rect.left; p1.y = rect.top;
        var p2 = svg.createSVGPoint(); p2.x = rect.right; p2.y = rect.bottom;
        var a = p1.matrixTransform(inv), b = p2.matrixTransform(inv);
        vis = { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
        // vx/vy 已是 vp 变换后的 viewBox 坐标，屏幕像素 = vb 单位 × ctm.a，
        // 余量按 200 屏幕像素换算（不能再除 view.k，2026-11-27 自测实测误裁）
        marginVb = 200 / Math.abs(ctm.a);
      }
    } catch (err) { vis = null; }
    if (!vis) vis = { x1: vb.x, y1: vb.y, x2: vb.x + vb.width, y2: vb.y + vb.height };
    document.querySelectorAll('.node').forEach(function (g) {
      var code = g.getAttribute('data-code');
      var n = nodesByCode[code];
      if (!n) return;
      // 视口外节点跳过（平移/缩放时会再算），放大时只算看得见的几十个
      var vx = n.x * view.k + view.x, vy = (-n.y) * view.k + view.y;
      if (vx < vis.x1 - marginVb || vx > vis.x2 + marginVb ||
          vy < vis.y1 - marginVb || vy > vis.y2 + marginVb) {
        g.removeAttribute('data-lbl-dir'); g.removeAttribute('data-lbl-dist'); return;
      }
      var lblEl = g.querySelector('.lbl'), nmEl = g.querySelector('.nmlbl');
      var visLbl = !!lblEl && lblEl.style.display !== 'none';
      var visNm = !!nmEl && nmEl.style.display !== 'none';
      if (!visLbl && !visNm) return;
      var dr = (n.type === 'connector' || n.type === 'clamp') ? DOT_R : DOT_R_FORK;
      // 真实包围盒（2026-11-27 21:38 pretext 办法）：宽与 ascent/descent 都实测，
      // 不再按字数估算；行距仍 13px 屏幕（与 applyView 的 lblGap 同口径）
      var W = 0, ascent = 8.5, descent = 2.5;
      if (visLbl) { var b1 = measureTextBox(lblEl.textContent || '', labelFontStr(lblEl)); W = Math.max(W, b1.w); ascent = Math.max(ascent, b1.ascent); descent = Math.max(descent, b1.descent); }
      if (visNm) { var b2 = measureTextBox(nmEl.textContent || '', labelFontStr(nmEl)); W = Math.max(W, b2.w); ascent = Math.max(ascent, b2.ascent); descent = Math.max(descent, b2.descent); }
      var lines = (visLbl ? 1 : 0) + (visNm ? 1 : 0);
      var blockH = ascent + descent + (lines - 1) * 13;
      // 安全余量：canvas 与 SVG 在个别环境下中文回退字体可能不一致（2026-11-27
      // 无头 Chromium 实测：长中文名 canvas 比 SVG 实际窄约 6.7%，平均误差 0.7px），
      // 打分包围盒按实测宽 ×1.08+1 放大，保证真实字块落在打分盒内（宁远勿压线）
      W = W * 1.08 + 1;
      var gap = 4;
      // 附近线段（SVG 坐标粗筛后转屏幕像素相对坐标）
      var reachSvg = (dr + gap + Math.max(W, blockH) + 24) / scale;
      var rel = [];
      for (var si = 0; si < segs.length; si++) {
        var s = segs[si];
        if (Math.max(s.x1, s.x2) < n.x - reachSvg || Math.min(s.x1, s.x2) > n.x + reachSvg ||
            Math.max(s.y1, s.y2) < -n.y - reachSvg || Math.min(s.y1, s.y2) > -n.y + reachSvg) continue;
        rel.push({ x1: (s.x1 - n.x) * scale, y1: (s.y1 + n.y) * scale,
                   x2: (s.x2 - n.x) * scale, y2: (s.y2 + n.y) * scale });
      }
      var best = null;
      for (var di = 0; di < LBL_DIRS.length; di++) {
        var d = LBL_DIRS[di];
        var ax = d.dx * (dr + gap), ay = d.dy * (dr + gap);
        var left = d.dx > 0.3 ? ax : (d.dx < -0.3 ? ax - W : -W / 2);
        var top = d.dy > 0.3 ? ay : (d.dy < -0.3 ? ay - blockH : -blockH / 2);
        var bb = { l: left, t: top, r: left + W, b: top + blockH };
        var score = 999;
        for (var ri = 0; ri < rel.length; ri++) score = Math.min(score, segBboxDist(rel[ri], bb));
        score += (LBL_DIRS.length - di) * 0.01; // 同分时按固定次序优先
        if (!best || score > best.score) best = { d: d, bb: bb, score: score };
      }
      var d2 = best.d, bb2 = best.bb;
      var anchor = d2.dx > 0.3 ? 'start' : (d2.dx < -0.3 ? 'end' : 'middle');
      var xSvg = n.x + (anchor === 'start' ? bb2.l : (anchor === 'end' ? bb2.r : (bb2.l + bb2.r) / 2)) / scale;
      var lineIdx = 0;
      function place(el) {
        el.setAttribute('x', xSvg.toFixed(2));
        el.setAttribute('y', (-n.y + (bb2.t + ascent + lineIdx * 13) / scale).toFixed(2));
        el.style.textAnchor = anchor;
        lineIdx++;
      }
      if (visLbl) place(lblEl);
      if (visNm) place(nmEl);
      g.setAttribute('data-lbl-dir', d2.name);
      g.setAttribute('data-lbl-dist', (best.score - (LBL_DIRS.length - LBL_DIRS.indexOf(d2)) * 0.01).toFixed(1));
    });
  }
  // 包一层 applyView：原定位（字号/显隐/长度标签）照旧，之后重摆节点名避线；
  // 原查看器所有调用点（缩放/平移/搜索/拖动）都走全局 applyView，自动跟上
  var _origApplyView = applyView;
  applyView = function () { _origApplyView(); fixNodeLabels(); updateSelRing(); };

  // 图示口径提示（取代旧 H2 标红：长度是属性参数，不按图示几何判差）
  function updateSchematicNote() {
    var el = document.getElementById('editBadCount');
    if (el) el.textContent = '图示布局：长度是属性参数，不按图上几何判差';
  }

  // 调整时不要浮窗（2026-11-27 17:43 用户定）：信息面板 #editPanel 在调整模式下不显示，
  // panelShow 变为无操作（只确保面板与详情弹窗都关着）；按钮区在工具栏 .bar，不受影响
  function hideFloats() {
    popup.style.display = 'none';
    var ep = document.getElementById('editPanel');
    if (ep) ep.style.display = 'none';
  }
  function panelShow(code, aff, note) {
    if (editMode) { hideFloats(); return; }
    var box = document.getElementById('editList');
    var head = document.getElementById('editHead');
    if (!box || !head) return;
    var n = nodesByCode[code];
    head.textContent = '节点 ' + code + (n ? '（' + n.x.toFixed(1) + ', ' + n.y.toFixed(1) + '）' : '') + (note ? ' · ' + note : '');
    box.innerHTML = aff.map(function (b) {
      var name = b.route_name || b.key;
      return '<div class="erow"><span class="ek">' + esc(name) + '</span>' +
        '<span>长度属性 ' + b.len_3d.toFixed(1) + ' mm（不变）</span></div>';
    }).join('') || '<div class="erow">无相连管子</div>';
  }

  function clientToLayout(cx, cy) {
    var p = svgPoint(cx, cy);
    return { x: (p.x - view.x) / view.k, y: -((p.y - view.y) / view.k) };
  }
  function snapVal(v) { return snapOn ? Math.round(v / snapStep) * snapStep : v; }

  // ---- 指针钩子（由原 pointerdown/move/up 处理器在最前面调用） ----
  // 缩放修复（2026-11-27 19:40 用户报「图面放大缩小没了」）：
  // 原查看器缩放靠 pointer 事件双指捏合（pointers 里要有 2 个指针才成立）。
  // 旧钩子拖节点时返回 true 把第一根手指吞了（原处理器没登记），第二根手指
  // 进来只登记了自己 → 只剩平移、捏合不成立（全图节点密，28px 内几乎处处
  // 命中节点，故调整模式下捏合基本全丢；只看模式不受影响）。
  // 修法：第二根手指进来时，取消拖动恢复原位，并把第一根手指补登记进原
  // pointers 表，再放行第二根 → 原处理器看到 2 个指针，捏合照常；
  // 已有一根手指在平移时，第二根手指不许再开拖节点，同样交给原捏合。
  window.__editPD = function (e) {
    if (!editMode) return false;
    if (drag) { // 第二根手指进来：取消当前拖动并恢复，交给原双指缩放
      var d0 = drag;
      var g0 = nodeEls[d0.code];
      if (g0) g0.classList.remove('dragging-node');
      restoreSnapshot(d0.snap);
      drag = null;
      tapCand = null;
      try { pointers[d0.pointerId] = { x: d0.lastX, y: d0.lastY }; } catch (err) { /* 忽略 */ }
      return false;
    }
    if (typeof pointers !== 'undefined' && Object.keys(pointers).length > 0) return false; // 已有手指：第二根交给原双指缩放，不开拖节点
    // 记录点按候选（抬起时判单击取消选中 / 双击选中，2026-11-27 21:36 用户定）
    tapCand = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    var nd = nearestNodeDist(e.clientX, e.clientY);
    if (!nd || nd.d > 28) return false; // 没点中节点：放行原平移
    // 双击选中后才能拖（2026-11-27 21:36 用户定）：没选中的节点按住滑动只平移，不拖节点
    if (nd.code !== selectedCode) return false;
    var n = nodesByCode[nd.code];
    if (!n) return false;
    tapCand = null; // 已开拖，不再按点按处理
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    drag = {
      pointerId: e.pointerId, code: nd.code,
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, tapT: Date.now(),
      origX: n.x, origY: n.y, moved: false,
      snap: snapshotOf(nd.code, affectedIdx(nd.code))
    };
    var g = nodeEls[nd.code];
    if (g) g.classList.add('dragging-node');
    popup.style.display = 'none'; // 拖动中旧弹窗坐标已过期，先关掉
    panelShow(nd.code, affectedBranches(nd.code), '拖动中（松手定版，Esc 取消）');
    e.preventDefault();
    return true;
  };
  window.__editPM = function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return false;
    drag.lastX = e.clientX; drag.lastY = e.clientY; // 供第二根手指进来时补登记原 pointers 表用
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 6) drag.moved = true;
    if (drag.moved) {
      var lp = clientToLayout(e.clientX, e.clientY);
      var nx = r3(snapVal(lp.x)), ny = r3(snapVal(lp.y));
      var aff = moveNodeInternal(drag.code, nx, ny, true);
      panelShow(drag.code, aff, '拖动中（松手定版，Esc 取消）');
      updateSchematicNote();
      applyView();
    }
    e.preventDefault();
    return true;
  };
  // 点按处理（2026-11-27 21:36 用户定）：调整模式内抬起时判点按——
  // 450ms 内同节点两次点按 = 双击手势 → 选中该节点；单击别处（空白/管子/别的
  // 节点）→ 取消当前选中（点另一个节点单击只取消、不直接选中新节点）；
  // 单击已选中节点本身保持选中。处理完返回 false 放行原 endPointer
  // （原 handleTap 在调整模式下 showNode/showBranch 已守卫，不弹浮窗）。
  function handleEditTap(e) {
    if (e.type === 'pointercancel') return;
    if (!tapCand || e.pointerId !== tapCand.pointerId) return;
    var tc = tapCand; tapCand = null;
    if (typeof pointers !== 'undefined' && Object.keys(pointers).length !== 1) return; // 多指手势不算点按
    var dist = Math.abs(e.clientX - tc.x) + Math.abs(e.clientY - tc.y);
    if (dist > 12 || Date.now() - tc.t >= 700) return; // 滑过了/按太久：是平移不是点按
    var nd = nearestNodeDist(e.clientX, e.clientY);
    var code = (nd && nd.d <= 28) ? nd.code : null;
    var now = Date.now();
    if (code && lastTap && lastTap.code === code && now - lastTap.t <= 450 &&
        Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= 40) {
      selectNode(code);
      lastTap = null;
      return;
    }
    lastTap = code ? { code: code, x: e.clientX, y: e.clientY, t: now } : null;
    if (selectedCode && code !== selectedCode) clearEditSel();
  }
  // 双击钩子（构建脚本注入原 dblclick 放大之前）：调整模式双击节点优先选中、
  // 不放大；双击空白返回 false 保持原双击放大；只看模式不拦截
  window.__editDbl = function (e) {
    if (!editMode) return false;
    var nd = nearestNodeDist(e.clientX, e.clientY);
    if (nd && nd.d <= 28) {
      selectNode(nd.code);
      lastTap = null;
      e.preventDefault();
      return true;
    }
    return false;
  };
  window.__editPU = function (e) {
    if (!drag) { if (editMode) handleEditTap(e); return false; }
    if (e.pointerId !== drag.pointerId) return false;
    var d = drag; drag = null;
    var g = nodeEls[d.code];
    if (g) g.classList.remove('dragging-node');
    if (!d.moved) { // 没拖动：调整模式下点按不弹详情（2026-11-27 17:43 用户定），只关浮窗
      hideFloats();
      return true;
    }
    undoStack.push(d.snap);
    if (undoStack.length > UNDO_CAP) undoStack.shift();
    editedNodes[d.code] = true;
    popup.style.display = 'none'; // 旧弹窗数字已过期，关掉防误读
    panelShow(d.code, affectedBranches(d.code), '已定版');
    updateSchematicNote();
    applyView();
    updateUndoBtn();
    e.preventDefault();
    return true;
  };

  function cancelDrag() {
    if (!drag) return;
    var d = drag; drag = null;
    var g = nodeEls[d.code];
    if (g) g.classList.remove('dragging-node');
    restoreSnapshot(d.snap);
    panelShow(d.code, affectedBranches(d.code), '已取消');
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drag) { cancelDrag(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { doUndo(); }
  });

  function doUndo() {
    var snap = undoStack.pop();
    if (!snap) { toast('没有可撤销的拖动'); return; }
    restoreSnapshot(snap);
    panelShow(snap.code, affectedBranches(snap.code), '已撤销');
    updateUndoBtn();
  }
  function updateUndoBtn() {
    var b = document.getElementById('btnUndo');
    if (b) b.disabled = undoStack.length === 0;
  }

  // ---- 保存 / 导入 ----
  function tsName() {
    var d = new Date();
    function p2(v) { return (v < 10 ? '0' : '') + v; }
    return 'layout_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' +
      p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.json';
  }
  function saveJSONText() {
    FULL_LAYOUT.meta = FULL_LAYOUT.meta || {};
    FULL_LAYOUT.meta.edited_by = '2D可调布局试点';
    FULL_LAYOUT.meta.edited_at = new Date().toISOString();
    FULL_LAYOUT.meta.edited_nodes = Object.keys(editedNodes).sort();
    // 图示布局注明：坐标是图示位置；长度等属性参数保持原值，未按图示几何重算/写回
    FULL_LAYOUT.meta.display_layout = 'schematic';
    FULL_LAYOUT.meta.display_note = '图示布局：节点/路径坐标为图示位置；长度等属性参数保持原值，未按图示几何长度重算';
    return JSON.stringify(FULL_LAYOUT, null, 1);
  }
  function doSave() {
    var blob = new Blob([saveJSONText()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tsName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('已下载 ' + a.download);
  }
  function importJSONText(text) {
    var d = JSON.parse(text);
    if (!d || !Array.isArray(d.branches) || !Array.isArray(d.nodes)) {
      throw new Error('不是 layout.json（缺 branches/nodes）');
    }
    var oldDisp = {};
    DATA.nodes.forEach(function (n) { oldDisp[n.code] = n.disp; });
    FULL_LAYOUT = d;
    rebuildFullMaps();
    DATA.nodes = d.nodes.map(function (n) {
      var c = JSON.parse(JSON.stringify(n));
      c.disp = oldDisp[n.code] || n.code;
      return c;
    });
    DATA.branches = JSON.parse(JSON.stringify(d.branches));
    DATA.bends = d.bends || [];
    DATA.warnings = d.warnings || [];
    if (d.stats) DATA.stats = d.stats;
    DATA.crossings = d.crossings || [];
    DATA.trunk_path = (d.meta && d.meta.trunk_path) || null;
    nodesByCode = {};
    DATA.nodes.forEach(function (n) { nodesByCode[n.code] = n; });
    branchesByKey = {};
    DATA.branches.forEach(function (b) { branchesByKey[b.key] = b; });
    DATA.branches.forEach(function (b) {
      (b.merged_from || []).forEach(function (m) { if (!(m.key in branchesByKey)) branchesByKey[m.key] = b; });
    });
    DATA.node_branches = {};
    DATA.branches.forEach(function (b) {
      [b.node0, b.node1].forEach(function (code) {
        var lst = DATA.node_branches[code] || (DATA.node_branches[code] = []);
        if (lst.indexOf(b.key) < 0) lst.push(b.key);
      });
    });
    trunkIdx = {};
    if (DATA.trunk_path && DATA.trunk_path.branch_list) {
      DATA.trunk_path.branch_list.forEach(function (k, i) { trunkIdx[k] = i + 1; });
    }
    undoStack = []; editedNodes = {};
    ((d.meta && d.meta.edited_nodes) || []).forEach(function (c) { editedNodes[c] = true; });
    var missN = 0, missB = 0;
    DATA.nodes.forEach(function (n) {
      if (nodeEls[n.code]) renderNode(n.code); else missN++;
    });
    DATA.branches.forEach(function (b, idx) {
      if (tubeElList[idx] && tubeElList[idx].getAttribute('data-key') === b.key) renderBranchIdx(idx); else missB++;
    });
    popup.style.display = 'none';
    updateSchematicNote();
    applyView();
    updateUndoBtn();
    var head = document.getElementById('editHead');
    if (head) head.textContent = '已导入 layout（' + DATA.branches.length + ' 路径 / ' + DATA.nodes.length + ' 节点）';
    document.getElementById('editList').innerHTML = '';
    if (missN || missB) toast('导入完成，但图上有 ' + missN + ' 个节点、' + missB + ' 条路径对不上（非同源布局）');
    else toast('导入完成，可继续调整');
  }

  // ---- 工具栏接线（一律 addEventListener，不用内联 onclick） ----
  var btnEdit = document.getElementById('btnEdit');
  var editPanel = document.getElementById('editPanel');
  btnEdit.addEventListener('click', function () {
    editMode = !editMode;
    window.__editMode = editMode;
    btnEdit.textContent = editMode ? '调整布局：开' : '调整布局：关';
    btnEdit.classList.toggle('on', editMode);
    // 调整时不要浮窗（2026-11-27 17:43 用户定）：信息面板不再以浮窗形式出现，
    // 工具栏按钮（调整开关/撤销/保存/导入）保留；进入时已打开的详情弹窗立即关掉
    editPanel.style.display = 'none';
    svg.classList.toggle('edit-on', editMode);
    if (!editMode && drag) cancelDrag();
    clearEditSel(); lastTap = null; tapCand = null; // 进出调整都清选中（2026-11-27 21:36 双击选中规则）
    if (editMode) { hideFloats(); if (typeof clearSel === 'function') clearSel(); }
    applyView(); // 标签显隐由 labelVis 四开关决定，调整模式不强制隐藏（2026-11-27 20:28 用户定）
    if (editMode) { updateSchematicNote(); } // 进入调整不弹提示气泡（2026-11-27 17:43 调整时不要浮窗）
  });
  document.getElementById('chkSnap').addEventListener('change', function () { snapOn = this.checked; });
  document.getElementById('selSnap').addEventListener('change', function () { snapStep = parseFloat(this.value) || 5; });
  document.getElementById('btnUndo').addEventListener('click', doUndo);
  document.getElementById('btnSaveLayout').addEventListener('click', doSave);
  var fileIn = document.getElementById('fileLayout');
  document.getElementById('btnImportLayout').addEventListener('click', function () { fileIn.click(); });
  fileIn.addEventListener('change', function () {
    var f = fileIn.files && fileIn.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try { importJSONText(String(rd.result)); }
      catch (err) { toast('导入失败：' + err.message); }
      fileIn.value = '';
    };
    rd.readAsText(f);
  });
  updateUndoBtn();
  updateSchematicNote();
  // 初始：给全部长度标签算方向角（未拉直的按折线弧长中点处线段方向），
  // 之后 applyView 按 data-ang 旋转到与线段平行；不改任何坐标与属性
  DATA.branches.forEach(function (b, idx) { renderBranchIdx(idx); });
  applyView();

  // 供自测脚本调用（不影响正常使用）
  window.EditPilot = {
    setEditMode: function (on) { if (on !== editMode) btnEdit.click(); },
    moveNode: function (code, x, y) {
      var snap = snapshotOf(code, affectedIdx(code));
      var aff = moveNodeInternal(code, x, y, true);
      undoStack.push(snap); editedNodes[code] = true;
      panelShow(code, aff, '已定版'); updateSchematicNote(); applyView(); updateUndoBtn();
      return aff.map(function (b) { return { key: b.key, len_3d: b.len_3d, len_2d: b.len_2d }; });
    },
    undo: doUndo,
    labelInfo: function (code) {
      var g = nodeEls[code];
      if (!g) return null;
      return { dir: g.getAttribute('data-lbl-dir'), distPx: parseFloat(g.getAttribute('data-lbl-dist')) };
    },
    selected: function () { return selectedCode; },
    selectNode: function (code) { selectNode(code); },
    clearEditSel: function () { clearEditSel(); },
    measureText: function (str) {
      var el = document.querySelector('.lenlbl') || document.querySelector('.lbl');
      return measureTextBox(String(str), el ? labelFontStr(el) : '11px sans-serif');
    },
    lenOffPx: function () { return window.__lenOffPx; },
    saveJSONText: saveJSONText,
    importJSONText: importJSONText,
    state: function () {
      var vis = 0;
      document.querySelectorAll('.lbl,.nmlbl,.lenlbl').forEach(function (el) {
        if (getComputedStyle(el).display !== 'none') vis++;
      });
      var ep = document.getElementById('editPanel');
      return {
        editMode: editMode, selectedCode: selectedCode, undoDepth: undoStack.length, schematic: true,
        nodes: DATA.nodes.length, branches: DATA.branches.length,
        visibleLabels: vis, labelsHidden: vis === 0, labelVis: (typeof labelVis !== 'undefined' ? JSON.parse(JSON.stringify(labelVis)) : null),
        popupVisible: getComputedStyle(popup).display !== 'none',
        editPanelVisible: ep ? getComputedStyle(ep).display !== 'none' : false
      };
    }
  };
})();
