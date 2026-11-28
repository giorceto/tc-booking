// Карта без библиотеки: плочки {z}/{x}/{y} (по подразбиране OpenStreetMap – <meta name="map-tiles">),
// местене с мишка или пръст, мащаб с бутони, колелце (само на голямата карта) и клавиатура, точки с цени.
//   const m = TCMap.create(el, { points: [{ id, lat, lon, label?, active? }], onPick(id), mode: 'small'|'embed'|'full' })
//   m.setPoints(points, { fit: true }); m.select(id); m.fit(); m.destroy()
// Без адрес на плочки в страницата TCMap.enabled е false и картата не се показва.
'use strict';

window.TCMap = (() => {
  const meta = (n) => {
    const m = document.querySelector(`meta[name="${n}"]`);
    return m ? m.getAttribute('content') : '';
  };
  const TILES = meta('map-tiles');
  const ATTR = meta('map-attribution');
  const T = 256;
  const MINZ = 3;
  const MAXZ = 18;
  const wx = (lon, z) => ((lon + 180) / 360) * T * 2 ** z;
  const wy = (lat, z) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * T * 2 ** z;
  };
  const tileUrl = (z, x, y) => TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'abc'[(x + y) % 3]);
  const el = (tag, cls, attrs = {}) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  // иконката на хотела – с createElementNS, не като HTML текст
  const NS = 'http://www.w3.org/2000/svg';
  function pinSvg() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 32');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M12 31s10-10.2 10-18.5A10 10 0 0 0 2 12.5C2 20.8 12 31 12 31z');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', '12');
    c.setAttribute('cy', '12.5');
    c.setAttribute('r', '4');
    svg.append(path, c);
    return svg;
  }

  function create(root, { points = [], onPick = null, mode = 'embed', maxFit } = {}) {
    maxFit = maxFit || 15;
    const full = mode === 'full';
    const small = mode === 'small';
    root.classList.add('tmap', `tmap-${mode}`);
    const layer = el('div', 'tm-tiles');
    const pinsBox = el('div', 'tm-pins');
    const ui = el('div', 'tm-ui');
    const zin = el('button', 'tm-btn', { type: 'button', 'aria-label': 'Приближи' });
    zin.textContent = '+';
    const zout = el('button', 'tm-btn', { type: 'button', 'aria-label': 'Отдалечи' });
    zout.textContent = '−';
    ui.append(zin, zout);
    const attr = el('div', 'tm-attr');
    if (/openstreetmap/i.test(ATTR)) {
      const a = el('a', '', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' });
      a.textContent = ATTR;
      attr.append(a);
    } else attr.textContent = ATTR;
    root.replaceChildren(layer, pinsBox, ...(small ? [] : [ui]), attr);
    if (!small) root.tabIndex = 0;
    root.setAttribute('role', 'region');
    if (!root.getAttribute('aria-label')) root.setAttribute('aria-label', 'Карта');

    let z = 12;
    let cx = 0;
    let cy = 0;
    let pts = [];
    let pinEls = new Map();
    let activeId = null;
    let moved = false; // местена/мащабирана от човека – тогава не се нагласява сама при смяна на размера
    let layoutZ = null; // при този мащаб е направено подреждането на цените (кои се виждат, кои са точки)
    const imgs = new Map(); // "z/x/y" -> img
    let raf = 0;

    const size = () => [root.clientWidth || 300, root.clientHeight || 200];

    function render() {
      raf = 0;
      const [w, hgt] = size();
      const x0 = cx - w / 2;
      const y0 = cy - hgt / 2;
      const n = 2 ** z;
      const keep = new Set();
      for (let tx = Math.floor(x0 / T); tx <= Math.floor((x0 + w) / T); tx++) {
        for (let ty = Math.floor(y0 / T); ty <= Math.floor((y0 + hgt) / T); ty++) {
          if (ty < 0 || ty >= n) continue;
          const k = `${z}/${tx}/${ty}`;
          keep.add(k);
          let img = imgs.get(k);
          if (!img) {
            img = el('img', 'tm-tile', { alt: '', draggable: 'false', decoding: 'async' });
            img.src = tileUrl(z, ((tx % n) + n) % n, ty);
            imgs.set(k, img);
            layer.append(img);
          }
          img.style.transform = `translate(${Math.round(tx * T - x0)}px, ${Math.round(ty * T - y0)}px)`;
        }
      }
      for (const [k, img] of imgs) {
        if (!keep.has(k)) {
          img.remove();
          imgs.delete(k);
        }
      }
      for (const p of pts) {
        const e = pinEls.get(p.id);
        if (e) e.style.transform = `translate(${Math.round(wx(p.lon, z) - x0)}px, ${Math.round(wy(p.lat, z) - y0)}px)`;
      }
      if (layoutZ !== z) layout();
      zin.disabled = z >= MAXZ;
      zout.disabled = z <= MINZ;
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };

    function center(lat, lon, zz = z) {
      z = zz;
      cx = wx(lon, z);
      cy = wy(lat, z);
      schedule();
    }

    // всички точки да се виждат, с отстъп
    function fit() {
      if (!pts.length) return;
      const [w, hgt] = size();
      const pad = small ? 18 : 48;
      let zz = maxFit;
      for (; zz > MINZ; zz--) {
        const xs = pts.map((p) => wx(p.lon, zz));
        const ys = pts.map((p) => wy(p.lat, zz));
        if (Math.max(...xs) - Math.min(...xs) <= w - 2 * pad && Math.max(...ys) - Math.min(...ys) <= hgt - 2 * pad) break;
      }
      z = zz;
      const xs = pts.map((p) => wx(p.lon, z));
      const ys = pts.map((p) => wy(p.lat, z));
      cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      schedule();
    }

    function zoom(d, ax, ay) {
      const nz = Math.max(MINZ, Math.min(MAXZ, z + d));
      if (nz === z) return;
      moved = true;
      const [w, hgt] = size();
      const ox = (ax == null ? w / 2 : ax) - w / 2;
      const oy = (ay == null ? hgt / 2 : ay) - hgt / 2;
      const k = 2 ** (nz - z);
      cx = (cx + ox) * k - ox;
      cy = (cy + oy) * k - oy;
      z = nz;
      schedule();
    }

    function setPoints(list, { fit: doFit = true } = {}) {
      pts = (list || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (doFit) moved = false;
      pinEls = new Map();
      pinsBox.replaceChildren(...pts.map((p) => {
        const kind = p.label ? 'price' : p.dot ? 'dot' : 'marker';
        const e = el(onPick && !small ? 'button' : 'span', `tm-pin ${kind}${p.id === activeId ? ' on' : ''}`);
        if (kind === 'price') e.textContent = p.label;
        else if (kind === 'dot') e.setAttribute('aria-hidden', 'true');
        else e.append(pinSvg());
        if (p.title && e.tagName !== 'BUTTON') e.title = p.title;
        if (e.tagName === 'BUTTON') {
          e.type = 'button';
          if (p.title) e.setAttribute('aria-label', `${p.title}${p.label ? `, ${p.label}` : ''}`);
          e.addEventListener('click', (ev) => {
            ev.stopPropagation();
            select(p.id);
            onPick(p.id);
          });
        }
        pinEls.set(p.id, e);
        return e;
      }));
      layoutZ = null;
      if (doFit) fit();
      else schedule();
    }

    // Цените не се застъпват: по реда на точките (най-евтините първи, избраната – най-първа) – която
    // би покрила вече показана, става малка точка; при приближаване пак се вижда с цената
    function layout() {
      layoutZ = z;
      const placed = [];
      const order = pts.filter((p) => p.label).sort((a, b) => (b.id === activeId) - (a.id === activeId));
      for (const p of order) {
        const e = pinEls.get(p.id);
        if (!e) continue;
        const x = wx(p.lon, z);
        const y = wy(p.lat, z);
        const w = (e.classList.contains('mini') ? p.label.length * 7.6 + 20 : e.offsetWidth || p.label.length * 7.6 + 20) + 4;
        const box = [x - w / 2, y - 34, x + w / 2, y];
        const hit = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        e.classList.toggle('mini', hit);
        if (!hit) placed.push(box);
      }
    }

    function select(id) {
      activeId = id;
      for (const [pid, e] of pinEls) e.classList.toggle('on', pid === id);
      const e = pinEls.get(id);
      if (e) pinsBox.append(e); // най-отгоре
      layoutZ = null; // избраната винаги е с цената си
      schedule();
    }

    // ---------- местене ----------
    let drag = null;
    const canDrag = (e) => !small && (full || e.pointerType !== 'touch'); // на телефона малката карта не пречи на скрола
    root.addEventListener('pointerdown', (e) => {
      if (!canDrag(e) || e.button !== 0 || e.target.closest('.tm-btn, .tm-pin, .tm-attr')) return;
      drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      root.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      cx -= e.clientX - drag.x;
      cy -= e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = true;
      moved = true;
      schedule();
    });
    const end = () => {
      drag = null;
      root.classList.remove('dragging');
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('dblclick', (e) => {
      if (small || e.target.closest('.tm-btn, .tm-pin')) return;
      const r = root.getBoundingClientRect();
      zoom(1, e.clientX - r.left, e.clientY - r.top);
    });
    if (full) {
      root.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = root.getBoundingClientRect();
        zoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
    }
    zin.addEventListener('click', () => zoom(1));
    zout.addEventListener('click', () => zoom(-1));
    root.addEventListener('keydown', (e) => {
      if (small || e.target !== root) return;
      const step = 80;
      const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (k) {
        moved = true;
        cx += k[0];
        cy += k[1];
        schedule();
      } else if (e.key === '+' || e.key === '=') zoom(1);
      else if (e.key === '-') zoom(-1);
      else return;
      e.preventDefault();
    });
    // първото истинско оразмеряване (картата е създадена преди да е в страницата) – нагласяне по точките
    const ro = new ResizeObserver(() => (!moved && pts.length ? fit() : schedule()));
    ro.observe(root);

    setPoints(points);
    return {
      setPoints,
      select,
      fit,
      center,
      destroy() {
        ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
      },
      get zoom() {
        return z;
      },
    };
  }

  return { enabled: Boolean(TILES), create };
})();
