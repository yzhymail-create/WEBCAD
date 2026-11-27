#!/usr/bin/env python3
"""构建「2D 可调布局试点」：以现有查看器为底，注入拖节点调整模式。
用法：python3 build_edit_pilot.py <viewer.html> <layout.json> <edit_pilot.js> <out.html>
不改源文件；产物为单文件 HTML（内嵌 FULL_LAYOUT 全量布局供保存/导入）。
"""
import json, sys, re

viewer_path, layout_path, edit_js_path, out_path = sys.argv[1:5]
html = open(viewer_path, encoding='utf-8').read()
layout = json.load(open(layout_path, encoding='utf-8'))
edit_js = open(edit_js_path, encoding='utf-8').read()

assert len(layout['branches']) == 408 and len(layout['nodes']) == 409, '地板数据计数不对，停'
assert html.count('class="tube"') == 408 and html.count('class="node"') == 409, '查看器元素计数不对，停'
assert 'onclick' not in html, '源文件含内联 onclick，停'

def patch(old, new, name):
    global html
    assert html.count(old) == 1, f'补丁锚点 {name} 出现 {html.count(old)} 次，停'
    html = html.replace(old, new)
    print(f'[patch] {name} ok')

# 1. 标题
patch('<h1>线束 2D 展开图</h1>', '<h1>线束 2D 展开图 · 可调布局试点</h1>', 'title')

# 2. CSS（注入到 </style> 前；.tube.h2bad 须在 .tube.sel 之后，同权重靠后胜）
css = """
/* 可调布局试点 */
.bar button.on { background: #e8590c; }
.bar .snapwrap { display: flex; align-items: center; gap: 4px; color: #ced4da; font-size: 13px; }
.bar .snapwrap select { padding: 5px 4px; border: none; border-radius: 4px; font-size: 13px; }
.bar button:disabled { opacity: .45; cursor: default; }
#svg.edit-on { cursor: crosshair; }
#svg.edit-on .node .ndot { stroke: #e8590c; }
/* 调整时标签按用户选择显示（2026-11-27 20:28 用户发截图纠正，取代 12:21 的全隐藏）：
   调整模式不再强制隐藏参数标签，显隐完全跟随标签下拉四开关（labelVis，applyView 决定）：
   勾选的显示（含拖动中/拖动后），未勾选的不显示；调整时改勾选即时生效。
   此处不加任何 edit-on 标签隐藏规则，避免压过 applyView 的内联 display */
/* 调整时不要浮窗（2026-11-27 17:43 用户发截图定）：调整模式下详情弹窗 #popup 与
   调整信息面板 #editPanel 一律不显示；工具栏按钮区（.bar）是操作 UI，不在此列，保留。
   :has 兜底 + JS 守卫（showNode/showBranch 入口）双保险，退出调整后恢复原有弹窗行为 */
#wrap:has(#svg.edit-on) #popup, #wrap:has(#svg.edit-on) #editPanel { display: none !important; }
.node.dragging-node .ndot { stroke: #e8590c; }
/* 双击选中标记（2026-11-27 21:36 用户定）：选中节点圆点红描边 + 红环（edit_pilot.js 的 .edit-selring） */
.node.edit-sel .ndot { stroke: #e03131; }
.edit-selring { pointer-events: none; }
/* 文字避线兜底（2026-11-27 20:41）：白色描边转角圆滑，万一有线靠近也不穿字；
   主办法是 edit_pilot.js 把字挪开（长度偏到线侧、节点名选离线最远方位） */
.lbl, .nmlbl, .lenlbl { stroke-linejoin: round; }

#editPanel { position: absolute; left: 8px; top: 8px; background: rgba(255,255,255,.96); border: 1px solid #adb5bd; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 8px 10px; font-size: 12px; line-height: 1.6; z-index: 6; max-width: min(92vw, 430px); max-height: 46%; overflow-y: auto; display: none; }
#editPanel .ehead { font-weight: 700; font-size: 13px; }
#editPanel .ebad { color: #495057; font-weight: 600; }
#editPanel .erow { display: flex; justify-content: space-between; gap: 10px; white-space: nowrap; }
#editPanel .ek { overflow: hidden; text-overflow: ellipsis; max-width: 190px; }
#editPanel .enote { color: #868e96; }
"""
patch('</style>', css + '</style>', 'css')

# 3. 工具栏：标签下拉之后加调整控件（仍在 .bar 内）
toolbar = """</div>
<button id="btnEdit" type="button">调整布局：关</button>
<span class="snapwrap"><label><input type="checkbox" id="chkSnap"> 网格吸附</label><select id="selSnap"><option value="5" selected>5mm</option><option value="10">10mm</option><option value="20">20mm</option><option value="50">50mm</option></select></span>
<button id="btnUndo" type="button">撤销</button>
<button id="btnSaveLayout" type="button">保存 layout.json</button>
<button id="btnImportLayout" type="button">导入 layout.json</button>
<input type="file" id="fileLayout" accept=".json,application/json" style="display:none">
</div>
</header>"""
patch('</div>\n</div>\n</header>', toolbar, 'toolbar')

# 4. 调整面板（#wrap 内，弹窗之前）
panel = """<div id="editPanel"><div class="ehead" id="editHead">调整布局：双击节点选中后拖动，点别处取消选中</div><div class="ebad" id="editBadCount">图示布局：长度是属性参数，不按图上几何判差</div><div id="editList"></div><div class="enote">双击节点选中（红环）后才能拖动，没选中的节点按住滑动只平移图面；单击别处取消选中。调整时标签按标签下拉选择显示（勾选的显示，未勾的不显示）；拖动时相连线段拉直为两端直连；只改图示坐标，长度等属性不变。松手定版，Esc 取消，Ctrl+Z 撤销。</div></div>
<div id="popup">"""
patch('<div id="popup">', panel, 'panel')

# 5. FULL_LAYOUT 注入（DATA 之后、TYPE_CN 之前）
full_json = json.dumps(layout, ensure_ascii=False).replace('<', '\\u003c')
patch('\nvar TYPE_CN =', '\nvar FULL_LAYOUT = ' + full_json + ';\nvar TYPE_CN =', 'full_layout')

# 6. 指针钩子（原处理器最前面调用调整模块，返回 true 表示已接管）
patch("svg.addEventListener('pointerdown', function(e) {\n  svg.setPointerCapture(e.pointerId);",
      "svg.addEventListener('pointerdown', function(e) {\n  if (window.__editPD && window.__editPD(e)) return;\n  svg.setPointerCapture(e.pointerId);",
      'hook_pointerdown')
patch("svg.addEventListener('pointermove', function(e) {\n  if (!pointers[e.pointerId]) return;",
      "svg.addEventListener('pointermove', function(e) {\n  if (window.__editPM && window.__editPM(e)) return;\n  if (!pointers[e.pointerId]) return;",
      'hook_pointermove')
patch("function endPointer(e) {",
      "function endPointer(e) {\n  if (window.__editPU && window.__editPU(e)) return;",
      'hook_pointerup')
patch("svg.addEventListener('pointercancel', function(e) { delete pointers[e.pointerId];",
      "svg.addEventListener('pointercancel', function(e) { if (window.__editPU && window.__editPU(e)) return; delete pointers[e.pointerId];",
      'hook_pointercancel')

# 7. 长度标签平行于线段（2026-11-27 11:42 用户定）：applyView 定位后按 data-ang 旋转，
#    角度由调整模块按线段方向算好（含 >90 度翻转）；自环外放标签（loff）不旋转
patch("""    el.setAttribute('x', lx);
    el.setAttribute('y', ly);
    el.style.fontSize = lblFs + 'px';
    el.style.strokeWidth = lenSw + 'px';""",
      """    el.setAttribute('x', lx);
    el.setAttribute('y', ly);
    var angAttr = el.getAttribute('data-ang');
    if (angAttr !== null && loffDir === null) el.setAttribute('transform', 'rotate(' + angAttr + ' ' + lx + ' ' + ly + ')');
    else el.removeAttribute('transform');
    el.style.fontSize = lblFs + 'px';
    el.style.strokeWidth = lenSw + 'px';""",
      'lenlbl_rotate')

# 7b. 长度标签贴线（2026-11-27 20:41 字身侧法向 + 21:36 贴近线 + 21:38 真实测量）：
#    偏移不再写死，由 edit_pilot.js 按真实测得的数字下伸算（线半宽+下伸+描边半宽
#    +净空 1.5，夹 7~9px）写入 window.__lenOffPx；未算出时默认 8px。
#    节点名避线在 edit_pilot.js 的 fixNodeLabels（包 applyView），不在此改原定位
patch("  var lenOff = 10 / scale, lenSw = 3 / scale;",
      "  var lenOff = (window.__lenOffPx || 8) / scale, lenSw = 3 / scale;",
      'lenlbl_offset_measured')

# 7c. 双击选中（2026-11-27 21:36 用户定）：原 dblclick 放大前先问调整模块——
#    调整模式双击节点选中不放大（__editDbl 返回 true），双击空白/只看模式照常放大
patch("svg.addEventListener('dblclick', function(e) { zoomAt(e.clientX, e.clientY, 1.6); });",
      "svg.addEventListener('dblclick', function(e) { if (window.__editDbl && window.__editDbl(e)) return; zoomAt(e.clientX, e.clientY, 1.6); });",
      'hook_dblclick')

# 8. 调整时不要浮窗（2026-11-27 17:43 用户定）：showNode/showBranch 入口守卫，
#    调整模式（window.__editMode，由调整模块维护）下直接关弹窗并返回，
#    覆盖点按（handleTap）与搜索（doSearch）两条开弹窗路径；退出调整后恢复
patch("function showNode(code) {\n  var n = nodesByCode[code];",
      "function showNode(code) {\n  if (window.__editMode) { popup.style.display = 'none'; return; }\n  var n = nodesByCode[code];",
      'showNode_edit_guard')
patch("function showBranch(key) {\n  var b = branchesByKey[key];",
      "function showBranch(key) {\n  if (window.__editMode) { popup.style.display = 'none'; return; }\n  var b = branchesByKey[key];",
      'showBranch_edit_guard')

# 9. 调整模块 JS 追加到脚本末尾（applyView(); 之后、</script> 之前）
patch('applyView();\n</script>', 'applyView();\n' + edit_js + '\n</script>', 'edit_js')

open(out_path, 'w', encoding='utf-8').write(html)
print(f'[done] {out_path} ({len(html)} chars)')
