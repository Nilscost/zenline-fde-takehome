/* QuadChart: quadrant scatter/bubble chart in pure SVG. Global: QuadChart */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var C = (window.UI && window.UI.COLORS) || {
    good: "rgba(47,125,91,.06)", bad: "rgba(192,57,43,.05)", neutral: "transparent", selected: "#111"
  };
  var FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  var MINUS = "−";

  function S(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function H(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function merge(a, b) { return Object.assign({}, a || {}, b || {}); }

  function darken(col) {
    var m = /^#([0-9a-f]{6})$/i.exec(col || "");
    if (!m) return col || "#555";
    var n = parseInt(m[1], 16), f = 0.68;
    var r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  /* ---------- scales ---------- */
  var ZERO_OFF = 8, BREAK_OFF = 17, LOG_BASE = 26;

  function niceStep(range, target) {
    var raw = range / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / mag;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  }
  function clean(v) { return parseFloat(v.toPrecision(12)); }

  // returns { t(v) -> offset in px from the low end, ticks:[{v,off,zero}], zero:bool }
  function buildScale(ax, vals, len, target) {
    var log = ax.scale === "log";
    var split = isNum(ax.split) ? ax.split : null;
    var nums = vals.filter(isNum);
    var lo, hi, hasZero = false, ticks = [], t;
    if (log) {
      var pos = [];
      nums.forEach(function (v) { if (v > 0) pos.push(v); else hasZero = true; });
      if (split > 0) pos.push(split);
      if (isNum(ax.min) && ax.min > 0) pos.push(ax.min);
      if (isNum(ax.max) && ax.max > 0) pos.push(ax.max);
      if (!pos.length) { lo = 1; hi = 10; }
      else { lo = Math.min.apply(null, pos); hi = Math.max.apply(null, pos); }
      if (lo === hi) { lo /= 2; hi *= 2; }
      var ll = Math.log(lo), lh = Math.log(hi), p = 0.09 * (lh - ll);
      ll -= p; lh += p;
      if (isNum(ax.min) && ax.min > 0) ll = Math.log(ax.min);
      if (isNum(ax.max) && ax.max > 0) lh = Math.log(ax.max);
      if (lh <= ll) lh = ll + 1;
      var base = hasZero ? LOG_BASE : 0, usable = Math.max(10, len - base);
      t = function (v) { return v > 0 ? base + (Math.log(v) - ll) / (lh - ll) * usable : ZERO_OFF; };
      lo = Math.exp(ll); hi = Math.exp(lh);
      var dec = (lh - ll) / Math.LN10, ppd = usable / dec;
      var mults = ppd >= 110 ? [1, 2, 5] : ppd >= 55 ? [1, 3] : [1];
      function logTicks(ms) {
        var out = [];
        for (var e = Math.floor(Math.log(lo) / Math.LN10); e <= Math.ceil(Math.log(hi) / Math.LN10); e++) {
          for (var i = 0; i < ms.length; i++) {
            var v = ms[i] * Math.pow(10, e);
            if (v >= lo * 0.9999 && v <= hi * 1.0001) out.push({ v: clean(v), off: t(v) });
          }
        }
        return out;
      }
      ticks = logTicks(mults);
      // narrow range (e.g. a drill-down): add intermediate ticks so the axis stays readable
      if (ticks.length < 3) ticks = logTicks(dec < 0.6 ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8] : [1, 1.5, 2, 3, 5, 7]);
      if (hasZero) ticks.unshift({ v: 0, off: ZERO_OFF, zero: true });
    } else {
      if (split != null) nums.push(split);
      if (isNum(ax.min)) nums.push(ax.min);
      if (isNum(ax.max)) nums.push(ax.max);
      if (!nums.length) { lo = 0; hi = 1; }
      else { lo = Math.min.apply(null, nums); hi = Math.max.apply(null, nums); }
      if (lo === hi) { var d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
      var pad = 0.08 * (hi - lo);
      lo -= pad; hi += pad;
      if (isNum(ax.min)) lo = ax.min;
      if (isNum(ax.max)) hi = ax.max;
      if (hi <= lo) hi = lo + 1;
      t = function (v) { return (v - lo) / (hi - lo) * len; };
      var step = niceStep(hi - lo, target);
      for (var k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) {
        var tv = clean(k * step);
        ticks.push({ v: tv, off: t(tv) });
      }
    }
    return { t: t, ticks: ticks, zero: hasZero, lo: lo, hi: hi };
  }

  function fmtTick(ax, tk) {
    if (tk.zero) return "0";
    var s = ax.format ? ax.format(tk.v) : String(tk.v);
    return s == null ? "" : String(s).replace("-", MINUS);
  }

  /* ---------- tooltip ---------- */
  function makeTip() {
    var d = document.createElement("div");
    d.className = "qc-tip";
    d.style.cssText = "position:fixed;left:0;top:0;display:none;pointer-events:none;z-index:9999;";
    document.body.appendChild(d);
    return {
      el: d,
      show: function (tip, ev) {
        if (!tip) return;
        d.innerHTML = "";
        if (tip.title) d.appendChild(H("div", "qc-tip-title", tip.title));
        if (tip.rows && tip.rows.length) {
          var tb = H("table", "qc-tip-rows");
          tip.rows.forEach(function (r) {
            var tr = H("tr");
            tr.appendChild(H("td", "k", r[0]));
            tr.appendChild(H("td", "v", r[1] == null ? "–" : r[1]));
            tb.appendChild(tr);
          });
          d.appendChild(tb);
        }
        d.style.display = "block";
        this.move(ev);
      },
      move: function (ev) {
        var w = d.offsetWidth, h = d.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
        var x = ev.clientX + 14, y = ev.clientY + 14;
        if (x + w > vw - 8) x = ev.clientX - w - 14;
        if (y + h > vh - 8) y = ev.clientY - h - 14;
        d.style.left = Math.max(8, x) + "px";
        d.style.top = Math.max(8, y) + "px";
      },
      hide: function () { d.style.display = "none"; }
    };
  }

  /* ---------- component ---------- */
  function create(container, opts) {
    opts = opts || {};
    var height = opts.height || 440;
    var stack = [];
    var hl = null, sel = null;
    var tip = makeTip();
    var root = H("div", "qc");
    var toolbar = H("div", "qc-toolbar"), legendEl = H("div", "qc-legend"), plotEl = H("div", "qc-plot");
    plotEl.style.position = "relative";
    root.appendChild(toolbar); root.appendChild(legendEl); root.appendChild(plotEl);
    container.innerHTML = "";
    container.appendChild(root);

    var qc = {};
    function view() { return stack[stack.length - 1] || null; }

    function eff() {
      var v = view() || {};
      return {
        x: merge(opts.x, v.x), y: merge(opts.y, v.y),
        quadrants: merge(opts.quadrants, v.quadrants), tints: merge(opts.tints, v.tints),
        legend: v.legend || opts.legend || [], sizeNote: v.sizeNote != null ? v.sizeNote : opts.sizeNote,
        points: v.points || [],
        rMin: v.rMin != null ? v.rMin : opts.rMin, rMax: v.rMax != null ? v.rMax : opts.rMax
      };
    }

    function drawChrome(e) {
      toolbar.innerHTML = "";
      var v = view();
      if (v && (v.title || stack.length > 1)) {
        var crumbs = stack.map(function (s) { return s.title || s.id || ""; }).join(" › ");
        toolbar.appendChild(H("span", "qc-crumb", crumbs));
        if (stack.length > 1) {
          var prev = stack[stack.length - 2];
          var b = H("button", "qc-back", "← Back to " + (prev.title || prev.id || "previous"));
          b.type = "button";
          b.addEventListener("click", function () { qc.back(); });
          toolbar.appendChild(b);
        }
      }
      toolbar.style.display = toolbar.childNodes.length ? "" : "none";
      legendEl.innerHTML = "";
      e.legend.forEach(function (l) {
        var item = H("span", "qc-leg");
        var sw = H("i", "qc-sw");
        if (l.hollow) { sw.style.background = "#fff"; sw.style.border = "2px solid " + l.color; }
        else { sw.style.background = l.color; sw.style.borderColor = darken(l.color); }
        item.appendChild(sw);
        item.appendChild(document.createTextNode(l.label));
        legendEl.appendChild(item);
      });
      if (e.sizeNote) legendEl.appendChild(H("span", "qc-sizenote", e.sizeNote));
      legendEl.style.display = legendEl.childNodes.length ? "" : "none";
    }

    function draw() {
      tip.hide();
      var e = eff(), pts = e.points;
      drawChrome(e);
      plotEl.innerHTML = "";
      var W = Math.max(320, Math.floor(container.clientWidth || plotEl.clientWidth || 800));
      var M = { l: 70, r: 22, t: 10, b: 54 };
      var pw = W - M.l - M.r, ph = height - M.t - M.b;
      var svg = S("svg", { width: W, height: height, viewBox: "0 0 " + W + " " + height, role: "img", "class": "qc-svg" });
      svg.style.display = "block";
      svg.style.fontFamily = FONT;
      plotEl.appendChild(svg);
      var clipId = "qcclip" + Math.random().toString(36).slice(2, 8);
      var defs = S("defs", null, svg);
      var cp = S("clipPath", { id: clipId }, defs);
      S("rect", { x: -2, y: -2, width: pw + 4, height: ph + 4 }, cp);
      var g = S("g", { transform: "translate(" + M.l + "," + M.t + ")" }, svg);

      // scales
      var xv = [], yv = [];
      pts.forEach(function (p) {
        xv.push(p.x); yv.push(p.y);
        if (p.link) { xv.push(p.link.x); yv.push(p.link.y); }
      });
      var xs = buildScale(e.x, xv, pw, Math.max(3, Math.floor(pw / 95)));
      var ys = buildScale(e.y, yv, ph, Math.max(3, Math.floor(ph / 50)));
      function X(v) { return xs.t(v); }
      function Y(v) { return ph - ys.t(v); }

      // background + background click
      var bg = S("rect", { x: 0, y: 0, width: pw, height: ph, fill: "#fff", stroke: "#e3e1da" }, g);
      var sx = (isNum(e.x.split) && !(e.x.scale === "log" && e.x.split <= 0)) ? Math.max(0, Math.min(pw, X(e.x.split))) : null;
      var sy = (isNum(e.y.split) && !(e.y.scale === "log" && e.y.split <= 0)) ? Math.max(0, Math.min(ph, Y(e.y.split))) : null;
      function tintColor(n) { return n ? (C[n] != null ? C[n] : n) : null; }
      if (sx != null && sy != null) {
        var rects = { tl: [0, 0, sx, sy], tr: [sx, 0, pw - sx, sy], bl: [0, sy, sx, ph - sy], br: [sx, sy, pw - sx, ph - sy] };
        Object.keys(rects).forEach(function (q) {
          var col = tintColor(e.tints[q]);
          if (col && col !== "transparent") S("rect", { x: rects[q][0], y: rects[q][1], width: rects[q][2], height: rects[q][3], fill: col, "pointer-events": "none" }, g);
        });
      }

      // grid + ticks
      var gridG = S("g", null, g);
      var lastX = -1e9;
      xs.ticks.forEach(function (tk) {
        S("line", { x1: tk.off, x2: tk.off, y1: 0, y2: ph, stroke: "#eeece6", "stroke-width": 1, "pointer-events": "none" }, gridG);
        var label = fmtTick(e.x, tk), wpx = label.length * 6.4 + 8;
        if (tk.off - wpx / 2 < lastX + 2 && !tk.zero) return;
        lastX = tk.off + wpx / 2;
        S("line", { x1: tk.off, x2: tk.off, y1: ph, y2: ph + 4, stroke: "#9a9890" }, gridG);
        var tx = S("text", { x: tk.off, y: ph + 18, "text-anchor": "middle", "font-size": 11, fill: "#6b6a65" }, gridG);
        tx.textContent = label;
      });
      var lastY = 1e9;
      ys.ticks.slice().sort(function (a, b) { return a.off - b.off; }).forEach(function (tk) {
        var yy = ph - tk.off;
        S("line", { x1: 0, x2: pw, y1: yy, y2: yy, stroke: "#eeece6", "stroke-width": 1, "pointer-events": "none" }, gridG);
        if (yy > lastY - 15 && !tk.zero) return;
        lastY = yy;
        S("line", { x1: -4, x2: 0, y1: yy, y2: yy, stroke: "#9a9890" }, gridG);
        var ty = S("text", { x: -8, y: yy + 4, "text-anchor": "end", "font-size": 11, fill: "#6b6a65" }, gridG);
        ty.textContent = fmtTick(e.y, tk);
      });
      // axis break marks on log zero lanes
      if (xs.zero) {
        S("line", { x1: BREAK_OFF - 3, y1: ph + 4, x2: BREAK_OFF + 3, y2: ph - 4, stroke: "#6b6a65", "stroke-width": 1.5 }, g);
        S("line", { x1: BREAK_OFF, y1: 0, x2: BREAK_OFF, y2: ph, stroke: "#d9d6cc", "stroke-dasharray": "2 3", "pointer-events": "none" }, g);
      }
      if (ys.zero) {
        var by = ph - BREAK_OFF;
        S("line", { x1: -4, y1: by + 3, x2: 4, y2: by - 3, stroke: "#6b6a65", "stroke-width": 1.5 }, g);
        S("line", { x1: 0, y1: by, x2: pw, y2: by, stroke: "#d9d6cc", "stroke-dasharray": "2 3", "pointer-events": "none" }, g);
      }
      // axis titles
      if (e.x.label) {
        var xt = S("text", { x: pw / 2, y: ph + 44, "text-anchor": "middle", "font-size": 12, "font-weight": 600, fill: "#3d3c38" }, g);
        xt.textContent = e.x.label;
      }
      if (e.y.label) {
        var yt = S("text", { x: -ph / 2, y: -M.l + 16, "text-anchor": "middle", "font-size": 12, "font-weight": 600, fill: "#3d3c38", transform: "rotate(-90)" }, g);
        yt.textContent = e.y.label;
      }

      var plot = S("g", { "clip-path": "url(#" + clipId + ")" }, g);
      // split lines
      if (sx != null) S("line", { x1: sx, x2: sx, y1: 0, y2: ph, stroke: "#8a8982", "stroke-dasharray": "5 4", "pointer-events": "none" }, plot);
      if (sy != null) S("line", { x1: 0, x2: pw, y1: sy, y2: sy, stroke: "#8a8982", "stroke-dasharray": "5 4", "pointer-events": "none" }, plot);
      bg.addEventListener("click", function () { if (opts.onBackgroundClick) opts.onBackgroundClick(qc); });
      var bgHit = S("rect", { x: 0, y: 0, width: pw, height: ph, fill: "transparent" }, plot);
      bgHit.addEventListener("click", function () { if (opts.onBackgroundClick) opts.onBackgroundClick(qc); });

      // quadrant names
      var qn = e.quadrants;
      // Name is split at ":" into a bold head and a smaller second line; long lines are
      // shortened so the two corner labels on one edge never meet in the middle.
      function qlabel(txt, x, y, anchor, top) {
        if (!txt) return;
        var parts = String(txt).split(/:\s*/), head = parts[0], rest = parts.slice(1).join(": ");
        function fit(s, cw) { var n = Math.floor((pw / 2 - 20) / cw); return s.length > n ? s.slice(0, Math.max(4, n - 1)) + "…" : s; }
        var lines = [{ s: fit(head, 6.6), fs: 11, fw: 700 }];
        if (rest) lines.push({ s: fit(rest, 5.6), fs: 10, fw: 400 });
        if (!top) lines.reverse();
        lines.forEach(function (ln, i) {
          var yy = top ? y + i * 13 : y - i * 13;
          var t = S("text", {
            x: x, y: yy, "text-anchor": anchor, "font-size": ln.fs, "font-weight": ln.fw, fill: "#7d7c75",
            stroke: "#fff", "stroke-width": 3.5, "stroke-linejoin": "round", "paint-order": "stroke", "pointer-events": "none"
          }, plot);
          t.textContent = ln.s;
          var ttl = S("title", {}, t); ttl.textContent = txt;
        });
      }
      qlabel(qn.tl, 8, 16, "start", true); qlabel(qn.tr, pw - 8, 16, "end", true);
      qlabel(qn.bl, 8, ph - 8, "start", false); qlabel(qn.br, pw - 8, ph - 8, "end", false);

      if (!pts.length) {
        var nd = S("text", { x: pw / 2, y: ph / 2, "text-anchor": "middle", "font-size": 14, fill: "#6b6a65" }, plot);
        nd.textContent = "No data for this selection";
        return;
      }

      // radii
      var maxSize = 0;
      pts.forEach(function (p) { if (isNum(p.size) && p.size > maxSize) maxSize = p.size; });
      var items = pts.map(function (p, i) {
        // radius range: options/view rMin..rMax (defaults 4..16), sqrt-scaled to the view's largest size
        var rMin = isNum(e.rMin) ? e.rMin : 4, rMax = isNum(e.rMax) ? e.rMax : 16;
        var r = isNum(p.size) && maxSize > 0 ? rMin + (rMax - rMin) * Math.sqrt(Math.max(0, p.size) / maxSize) : 6;
        var dim = hl ? !hl.has(p.id) : false;
        return { p: p, i: i, r: r, px: X(p.x), py: Y(p.y), dim: dim, on: !!(hl && hl.has(p.id)) };
      });
      items.sort(function (a, b) { return (a.on - b.on) || (b.r - a.r) || (a.i - b.i); });

      // links first (under points)
      var linkG = S("g", null, plot), ptG = S("g", null, plot), markG = S("g", null, plot);
      var ringItem = null;
      items.forEach(function (it) {
        var p = it.p, op = it.dim ? 0.18 : 1;
        if (p.link && isNum(p.link.x) && isNum(p.link.y)) {
          var lx = X(p.link.x), ly = Y(p.link.y);
          S("line", { x1: it.px, y1: it.py, x2: lx, y2: ly, stroke: "#a9a8a1", "stroke-width": 1, opacity: it.dim ? 0.15 : 0.8, "pointer-events": "none" }, linkG);
          var mk = S("circle", { cx: lx, cy: ly, r: 4, fill: "#fff", stroke: "#8a8982", "stroke-width": 1.4, opacity: op, style: "cursor:pointer" }, markG);
          wire(mk, it, 4);
        }
        var col = p.color || "#1f5c4d", dk = darken(col);
        var c = S("circle", { cx: it.px, cy: it.py, r: it.r, style: "cursor:pointer" }, ptG);
        if (p.hollow) {
          c.setAttribute("fill", "#fff"); c.setAttribute("stroke", col); c.setAttribute("stroke-width", 1.5);
        } else {
          c.setAttribute("fill", col); c.setAttribute("fill-opacity", 0.75); c.setAttribute("stroke", dk); c.setAttribute("stroke-width", 1);
        }
        if (p.dashed) c.setAttribute("stroke-dasharray", "3 2");
        if (it.on) { c.setAttribute("stroke", C.selected || "#111"); c.setAttribute("stroke-width", 1.8); }
        if (it.dim) c.setAttribute("opacity", 0.18);
        wire(c, it, it.r);
        if (sel != null && sel === p.id) ringItem = it;
      });
      function wire(node, it, r0) {
        node.addEventListener("mouseenter", function (ev) {
          if (node.parentNode === markG) node.setAttribute("r", r0 + 2); else node.setAttribute("r", r0 + Math.max(1.5, r0 * 0.12));
          tip.show(it.p.tip || { title: String(it.p.id) }, ev);
        });
        node.addEventListener("mousemove", function (ev) { tip.move(ev); });
        node.addEventListener("mouseleave", function () { node.setAttribute("r", r0); tip.hide(); });
        node.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (opts.onClick) opts.onClick(it.p, qc);
        });
      }
      if (ringItem) {
        S("circle", { cx: ringItem.px, cy: ringItem.py, r: ringItem.r + 4, fill: "none", stroke: C.selected || "#111", "stroke-width": 2.5, "pointer-events": "none" }, plot);
      }

      // labels
      var placed = [];
      function overlaps(b) {
        for (var i = 0; i < placed.length; i++) {
          var o = placed[i];
          if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true;
        }
        return false;
      }
      var labelG = S("g", { "pointer-events": "none" }, plot);
      items.slice().reverse().forEach(function (it) {
        var txt = it.p.label;
        if (txt == null || txt === "") return;
        txt = String(txt);
        var w = txt.length * 6 + 2, h = 12, r = it.r + 3;
        var cands = [
          { x: it.px + r, y: it.py - h / 2, a: "start", tx: it.px + r },
          { x: it.px - r - w, y: it.py - h / 2, a: "end", tx: it.px - r },
          { x: it.px - w / 2, y: it.py - it.r - 3 - h, a: "middle", tx: it.px },
          { x: it.px - w / 2, y: it.py + it.r + 3, a: "middle", tx: it.px }
        ];
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i], box = { x: c.x, y: c.y, w: w, h: h };
          if (box.x < 0 || box.y < 0 || box.x + w > pw || box.y + h > ph) continue;
          if (overlaps(box)) continue;
          placed.push(box);
          var t = S("text", {
            x: c.tx, y: c.y + h - 2, "text-anchor": c.a, "font-size": 11, fill: "#2b2a27", stroke: "#fff", "stroke-width": 3,
            "stroke-linejoin": "round", "paint-order": "stroke", opacity: it.dim ? 0.25 : 1
          }, labelG);
          t.textContent = txt;
          break;
        }
      });
    }

    /* ---- public API ---- */
    function prune() {
      var v = view();
      if (!v) return;
      var ids = {};
      (v.points || []).forEach(function (p) { ids[p.id] = true; });
      if (hl) {
        var keep = Array.from(hl).filter(function (i) { return ids[i]; });
        hl = keep.length ? new Set(keep) : null;
      }
      if (sel != null && !ids[sel]) sel = null;
    }
    function changed() {
      prune();
      draw();
      if (opts.onViewChange) opts.onViewChange(view(), qc);
    }
    qc.setView = function (v) { stack = [v]; changed(); return qc; };
    qc.pushView = function (v) { stack.push(v); changed(); return qc; };
    qc.back = function () { if (stack.length > 1) { stack.pop(); changed(); } return qc; };
    qc.view = view;
    qc.depth = function () { return stack.length; };
    qc.highlight = function (ids) {
      hl = ids && ids.length ? new Set(ids) : null;
      draw();
      return qc;
    };
    qc.select = function (id) { sel = id == null ? null : id; draw(); return qc; };
    qc.setAxis = function (which, partial) {
      var v = view();
      if (!v) return qc;
      v[which] = merge(v[which], partial);
      draw();
      return qc;
    };
    qc.redraw = function () { draw(); return qc; };
    qc.destroy = function () {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", onResize);
      if (tip.el.parentNode) tip.el.parentNode.removeChild(tip.el);
      root.parentNode && root.parentNode.removeChild(root);
    };

    // resize handling (debounced)
    var timer = null, lastW = container.clientWidth, ro = null;
    function onResize() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = container.clientWidth;
        if (w && w !== lastW) { lastW = w; draw(); }
      }, 80);
    }
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(onResize); ro.observe(container); }
    else window.addEventListener("resize", onResize);

    draw();
    return qc;
  }

  window.QuadChart = { create: create };
})();
