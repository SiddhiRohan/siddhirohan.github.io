import * as THREE from 'three';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = window.matchMedia('(pointer: fine)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

/* =========================================================
   PARTICLE FIELD
   12k points that morph between baked meshes as you scroll.
   Every transition passes through chaos: mess in, structure out.
   ========================================================= */
const N = 12000;
const BAKED = ['bust', 'scales', 'brain', 'heart', 'bridge', 'coin'];
const field = { ready: false, intro: { v: reduced ? 0 : 1 } };

function proceduralShapes() {
  const chaos = new Float32Array(N * 3);
  const grid = new Float32Array(N * 3);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
  const COLS = 150, ROWS = N / COLS;
  for (let i = 0; i < N; i++) {
    chaos[i * 3] = gauss() * 2.4;
    chaos[i * 3 + 1] = (i / N) * 2.4 - 1.2 + gauss() * 0.5;   // keeps the height ordering the meshes use
    chaos[i * 3 + 2] = gauss() * 1.4;
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = (c / (COLS - 1)) * 2 - 1, y = (r / (ROWS - 1)) * 2 - 1;
    grid[i * 3] = x * 1.7;
    grid[i * 3 + 1] = y * 0.95;
    grid[i * 3 + 2] = Math.sin(x * 3.2) * Math.cos(y * 2.6) * 0.16;
  }
  return { chaos, grid };
}

async function initField() {
  const canvas = $('#gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  } catch (e) { canvas.remove(); return; }
  const DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 1);   // canvas is screen-blended, so black = transparent

  const shapes = proceduralShapes();
  try {
    const buf = await (await fetch('assets/data/shapes.bin')).arrayBuffer();
    const q = new Int16Array(buf);
    BAKED.forEach((name, s) => {
      const a = new Float32Array(N * 3);
      for (let i = 0; i < N * 3; i++) a[i] = q[s * N * 3 + i] / 32767;
      shapes[name] = a;
    });
  } catch (e) { /* procedural shapes only */ }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.z = 6;

  const geo = new THREE.BufferGeometry();
  const aFrom = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const aTo = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
  const aRnd = new THREE.BufferAttribute(new Float32Array(N * 4), 4);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    aRnd.setXYZW(i, r * Math.cos(th), u, r * Math.sin(th), Math.random());
  }
  geo.setAttribute('position', aFrom);   // three needs one; the shader reads aFrom/aTo
  geo.setAttribute('aFrom', aFrom);
  geo.setAttribute('aTo', aTo);
  geo.setAttribute('aRnd', aRnd);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uT: { value: 0 }, uTime: { value: 0 }, uIntro: { value: field.intro.v },
      uAlpha: { value: 1 }, uSize: { value: 1 }, uScan: { value: 9 }
    },
    vertexShader: `
      attribute vec3 aFrom; attribute vec3 aTo; attribute vec4 aRnd;
      uniform float uT, uTime, uIntro, uSize;
      varying float vY; varying float vHot; varying float vFade;
      void main(){
        float d = aRnd.w * 0.35;                                  // stagger so the swarm peels off in waves
        float t = clamp((uT - d) / (1.0 - 0.35), 0.0, 1.0);
        float e = t * t * (3.0 - 2.0 * t);
        vec3 p = mix(aFrom, aTo, e);
        float burst = sin(3.14159 * e);
        p += aRnd.xyz * burst * (0.35 + aRnd.w * 0.9);
        p += aRnd.xyz * uIntro * (2.0 + aRnd.w * 5.0);
        p += 0.012 * vec3(sin(uTime * 0.9 + aRnd.w * 40.0), cos(uTime * 0.7 + aRnd.w * 31.0), sin(uTime * 0.8 + aRnd.w * 17.0));
        vY = p.y;
        vHot = step(0.93, aRnd.w);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFade = 1.0 - 0.75 * smoothstep(5.0, 8.2, -mv.z);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (1.0 + aRnd.w * 1.1) * (6.0 / -mv.z);
      }`,
    fragmentShader: `
      precision mediump float;
      uniform float uAlpha, uScan;
      varying float vY; varying float vHot; varying float vFade;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.12, length(c));
        float band = 1.0 - smoothstep(0.0, 0.2, abs(vY - uScan));
        vec3 col = mix(vec3(0.91, 0.89, 0.84), vec3(1.0, 0.294, 0.0), max(vHot, band));
        gl_FragColor = vec4(col, a * uAlpha * vFade * (0.5 + band * 0.5));
      }`
  });
  const points = new THREE.Points(geo, mat);
  const rig = new THREE.Group();
  rig.add(points);
  scene.add(rig);

  /* stops: every [data-shape] section is a keyframe for the swarm */
  let stops = [], vw = 1, vh = 1, halfW = 1, halfH = 1, portrait = false;
  function measure() {
    vw = window.innerWidth; vh = window.innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    halfH = Math.tan((35 / 2) * Math.PI / 180) * 6;
    halfW = halfH * camera.aspect;
    portrait = vw < 900;
    mat.uniforms.uSize.value = (portrait ? 1.5 : 1.9) * DPR;
    const sy = window.scrollY;
    stops = $$('[data-shape]').map((el) => {
      const r = el.getBoundingClientRect();
      const d = el.dataset;
      // tall sections hold their shape from the first screen to the last
      const top = r.top + sy, h = r.height;
      return {
        shape: shapes[d.shape] ? d.shape : 'chaos',
        a: top + Math.min(h, vh) / 2,
        b: top + h - Math.min(h, vh) / 2,
        x: +d.x || 0, y: +d.y || 0, s: +d.scale || 1, al: d.alpha === undefined ? 1 : +d.alpha
      };
    });
  }

  let seg = -1;
  function setSegment(i) {
    seg = i;
    aFrom.array.set(shapes[stops[i].shape]);
    aTo.array.set(shapes[stops[Math.min(i + 1, stops.length - 1)].shape]);
    aFrom.needsUpdate = true;
    aTo.needsUpdate = true;
  }

  const cur = { t: 0, x: 0, y: 0, s: 1, al: 0 };
  const mouse = { x: 0, y: 0, rx: 0, ry: 0 };
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / vw - 0.5;
    mouse.y = e.clientY / vh - 0.5;
  }, { passive: true });

  const lerp = (a, b, t) => a + (b - a) * t;
  const clock = new THREE.Clock();
  let spin = 0.5;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    const c = window.scrollY + vh / 2;

    // which pair of stops are we between, and how far
    let i = 0;
    while (i < stops.length - 2 && c > stops[i + 1].a) i++;
    const A = stops[i], B = stops[Math.min(i + 1, stops.length - 1)];
    const span = Math.max(1, B.a - A.b);
    const u = Math.min(1, Math.max(0, (c - A.b) / span));
    const hold = Math.min(1, Math.max(0, (u - 0.3) / 0.4));   // dwell on each shape before leaving
    if (i !== seg) { const fwd = i > seg; setSegment(i); cur.t = fwd ? 0 : 1; }

    const k = reduced ? 1 : 1 - Math.pow(0.0015, dt);
    cur.t = lerp(cur.t, hold, k);
    const m = hold * hold * (3 - 2 * hold);
    const px = portrait ? 0 : 1;
    cur.x = lerp(cur.x, lerp(A.x, B.x, m) * px, k);
    cur.y = lerp(cur.y, lerp(A.y, B.y, m) + (portrait ? 0.25 : 0), k);
    cur.s = lerp(cur.s, lerp(A.s, B.s, m) * (portrait ? 0.62 : 1), k);
    cur.al = lerp(cur.al, lerp(A.al, B.al, m) * (portrait ? 0.6 : 1), k);

    mouse.rx = lerp(mouse.rx, mouse.y * 0.3, 0.05);
    mouse.ry = lerp(mouse.ry, mouse.x * 0.6, 0.05);
    if (!reduced) spin += dt * 0.16;
    // wide, flat shapes (grid/chaos) shouldn't tumble: damp spin by how "object-like" the stop is
    const flat = (s) => (s.shape === 'grid' ? 0 : s.shape === 'chaos' ? 0.35 : 1);
    const obj = lerp(flat(A), flat(B), m);
    rig.rotation.set(mouse.rx + (1 - obj) * -0.5, Math.sin(spin) * 0.75 * obj + mouse.ry + (1 - obj) * 0.15, 0);
    rig.position.set(cur.x * halfW, cur.y * halfH, 0);
    rig.scale.setScalar(cur.s);

    mat.uniforms.uT.value = cur.t;
    mat.uniforms.uTime.value = time;
    mat.uniforms.uIntro.value = field.intro.v;
    mat.uniforms.uAlpha.value = cur.al;
    mat.uniforms.uScan.value = reduced ? 9 : ((time * 0.4) % 3.4) - 1.3;
    renderer.render(scene, camera);
  }

  measure();
  setSegment(0);
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  field.remeasure = measure;
  field.ready = true;

  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) loop(); });
  function loop() { if (!running) return; frame(); requestAnimationFrame(loop); }
  loop();
}

/* =========================================================
   TYPE + SCROLL CHOREOGRAPHY
   ========================================================= */
function splitWords() {
  $$('[data-split]').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.innerHTML = words.map((w) => `<span class="w" aria-hidden="true"><span class="wi">${w}</span></span>`).join(' ');
  });
}

// how wide can this headline get before it outgrows its column?
function fitWidth(el, max) {
  const avail = el.parentElement.clientWidth;
  const probe = (w) => { el.style.setProperty('--wdth', w); return el.scrollWidth; };
  const prevWS = el.style.whiteSpace, prevD = el.style.display;
  el.style.whiteSpace = 'nowrap'; el.style.display = 'inline-block';
  const w50 = probe(50), w100 = probe(100);
  el.style.whiteSpace = prevWS; el.style.display = prevD;
  el.style.setProperty('--wdth', 50);
  if (w50 >= avail) return 50;
  const t = (avail * 0.97 - w50) / Math.max(1, w100 - w50);
  return Math.max(50, Math.min(max, 50 + t * 50));
}

function choreography() {
  if (!gsap || !ScrollTrigger || reduced) {
    $$('[data-draw]').forEach((p) => { p.style.strokeDasharray = 'none'; });
    return;
  }

  // words rise out of their line
  $$('[data-split]').forEach((el) => {
    if (el.closest('.hero')) return;
    gsap.from($$('.wi', el), {
      yPercent: 115, rotate: 4, duration: 1.1, ease: 'expo.out', stagger: 0.07,
      scrollTrigger: { trigger: el, start: 'top 88%' }
    });
  });

  // headlines breathe wider as they cross the screen
  const widen = () => $$('[data-widen]').forEach((el) => {
    if (el.closest('.hero')) return;
    const to = fitWidth(el, el.classList.contains('proj-title') ? 100 : 88);
    if (el._w) el._w.kill();
    el._w = gsap.fromTo(el, { '--wdth': 50 }, {
      '--wdth': to, ease: 'none',
      scrollTrigger: { trigger: el, start: 'top 95%', end: 'top 35%', scrub: 0.6 }
    });
  });
  widen();
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { widen(); ScrollTrigger.refresh(); }, 250); });

  // generic fades
  $$('[data-fade]').forEach((el) => {
    if (el.closest('.hero')) return;
    gsap.from(el, {
      y: 34, autoAlpha: 0, duration: 0.9, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 90%' }
    });
  });

  // brush strokes draw themselves
  $$('[data-draw]').forEach((p) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    if (p.closest('.hero')) return;
    gsap.to(p, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', scrollTrigger: { trigger: p, start: 'top 88%' } });
  });

  // stat counters
  $$('[data-count]').forEach((el) => {
    const end = +el.dataset.count, suf = el.dataset.suffix || '';
    const o = { v: 0 };
    gsap.to(o, {
      v: end, duration: 1.6, ease: 'power2.out',
      onUpdate: () => { el.textContent = Math.round(o.v) + suf; },
      scrollTrigger: { trigger: el, start: 'top 90%' }
    });
  });

  // key-art prints drift against the scroll
  $$('[data-art]').forEach((fig) => {
    gsap.fromTo(fig, { y: 110 }, { y: -110, ease: 'none', scrollTrigger: { trigger: fig.closest('.proj'), start: 'top bottom', end: 'bottom top', scrub: 0.8 } });
    gsap.from($('img', fig), { scale: 1.25, ease: 'none', scrollTrigger: { trigger: fig, start: 'top bottom', end: 'bottom top', scrub: true } });
  });

  // progress rail
  gsap.to('#progress', { scaleY: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });
}

function heroIntro() {
  if (!gsap || reduced) { $$('.hero [data-draw]').forEach((p) => { p.style.strokeDashoffset = 0; }); return; }
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to(field.intro, { v: 0, duration: 2.6, ease: 'power3.out' }, 0)
    .from('.name .wi', { yPercent: 115, rotate: 5, duration: 1.3, stagger: 0.12 }, 0.1)
    .fromTo('.name', { '--wdth': 118 }, { '--wdth': 50, duration: 1.6 }, 0.1)
    .to('.hero [data-draw]', { strokeDashoffset: 0, duration: 1, ease: 'power2.inOut' }, 0.8)
    .from('.hero [data-fade]', { y: 26, autoAlpha: 0, duration: 0.9, stagger: 0.09, ease: 'power3.out' }, 0.9);
}

/* =========================================================
   SMALL THINGS
   ========================================================= */
function smoothScroll() {
  if (reduced || !window.Lenis || !gsap) return null;
  const lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const t = $(a.getAttribute('href'));
    if (t) { e.preventDefault(); lenis.scrollTo(t, { duration: 1.6 }); }
  }));
  return lenis;
}

function cycleWord() {
  const el = $('#cycle');
  const words = ['Pipelines', 'Evidence', 'Guardrails', 'RAG', 'Receipts', 'Airflow'];
  const glyphs = '#/\\<>_=+*';
  let i = 0;
  if (reduced) return;
  setInterval(() => {
    i = (i + 1) % words.length;
    const target = words[i];
    let f = 0;
    const id = setInterval(() => {
      f++;
      el.textContent = target.split('').map((ch, k) => (k < f / 2 ? ch : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
      if (f / 2 >= target.length) { clearInterval(id); el.textContent = target; }
    }, 38);
  }, 2600);
}

function cursor() {
  if (!fine || reduced) return;
  const c = $('#cursor');
  let x = -100, y = -100, tx = -100, ty = -100;
  window.addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
  (function tick() {
    x += (tx - x) * 0.22; y += (ty - y) * 0.22;
    c.style.transform = `translate(${x}px,${y}px)`;
    requestAnimationFrame(tick);
  })();
  $$('a, button, .skill, .card').forEach((el) => {
    el.addEventListener('pointerenter', () => c.classList.add('big'));
    el.addEventListener('pointerleave', () => c.classList.remove('big'));
  });
}

function mailCopy() {
  const b = $('#mail');
  b.addEventListener('click', async () => {
    const addr = b.dataset.mail;
    try {
      await navigator.clipboard.writeText(addr);
      b.classList.add('ok');
      setTimeout(() => b.classList.remove('ok'), 1600);
    } catch (e) {
      window.location.href = 'mailto:' + addr;
    }
  });
}

function clock() {
  const el = $('#clock');
  const tick = () => {
    try {
      el.textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' PT';
    } catch (e) { el.textContent = ''; }
  };
  tick();
  setInterval(tick, 20000);
}

/* ---------- boot ---------- */
splitWords();
const lenis = smoothScroll();
$('#toTop').addEventListener('click', () => (lenis ? lenis.scrollTo(0, { duration: 2 }) : window.scrollTo({ top: 0 })));
initField();
cycleWord();
cursor();
mailCopy();
clock();

function start() {
  choreography();
  bootLoader();
  if (field.remeasure) field.remeasure();
}

// one clean loader path: count up, lift the curtain, run the hero intro once
function bootLoader() {
  const el = $('#loader'), n = $('#loaderN');
  const reveal = () => { document.body.classList.remove('is-loading'); };
  if (reduced || !gsap || !el) { if (el) el.remove(); reveal(); heroIntro(); return; }
  const o = { v: 0 };
  gsap.to(o, {
    v: 100, duration: 1.4, ease: 'power2.inOut',
    onUpdate: () => { n.textContent = String(Math.round(o.v)).padStart(2, '0'); },
    onComplete: () => {
      heroIntro();
      gsap.to(el, { yPercent: -100, duration: 0.9, ease: 'expo.inOut', onComplete: () => { el.remove(); reveal(); } });
    }
  });
}

if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else window.addEventListener('load', start);
