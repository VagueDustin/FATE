import { useEffect, useRef } from 'react';

/**
 * Starfield — the animated constellation sky behind the home screen.
 *
 * Ported from the 702 Squad Palworld portal (palworld.702squad.com), which is the ceremonial-tier
 * expression of the same brand. Same construction: a canvas of twinkling dust, a smaller set of
 * larger "anchor" stars with cross glints, faint gradient links between nearby anchors, and the
 * occasional meteor.
 *
 * ── Why this is on the home screen only ───────────────────────────────────────────────────────
 * FATE sits at the brand's `utility` ornament tier, which explicitly rules out ambient motion —
 * for the reading surface, that rule is right: nothing should move behind a document you are trying
 * to read. The home screen is a different kind of surface. It is idle, it is the first thing you
 * see, and it carries the badge and the wordmark. So the split is deliberate: ceremonial home,
 * utility reader. This component is mounted only when no document is open, and its animation loop
 * is torn down the moment one is.
 *
 * ── Cost control ──────────────────────────────────────────────────────────────────────────────
 *  - Nothing here touches React state; it draws straight to a canvas.
 *  - The rAF loop only runs while mounted, i.e. only on the home screen.
 *  - It also pauses while the window is hidden (`visibilitychange`), so a minimised or background
 *    window costs nothing.
 *  - `prefers-reduced-motion` renders one static frame and never starts the loop.
 *  - Device pixel ratio is capped at 2 — beyond that the cost doubles for no visible gain.
 */

/** Star counts scale with width, but stay bounded so a wide monitor doesn't melt. */
const MAX_DUST = 170;
const DUST_PER_PX = 1 / 8;
const MAX_ANCHORS = 26;
const ANCHORS_PER_PX = 1 / 58;
/** Anchors closer than this (in device px) get a link drawn between them. */
const LINK_RADIUS = 190;
/** At most this many links per anchor, nearest first — keeps the web sparse rather than a mesh. */
const LINKS_PER_ANCHOR = 2;
/** Average gap between meteors, ms. Randomised per spawn so they never feel metronomic. */
const METEOR_INTERVAL = 7000;

export default function Starfield({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    /*
     * Colours are read from the active theme's CSS custom properties rather than hardcoded, so the
     * sky follows the theme: gold in FATE, red in Crimson, violet in Dracula, dark gold on Light.
     * Resolved once per build(), and a MutationObserver on `data-theme` triggers a rebuild so a
     * theme switch repaints immediately.
     */
    const readTheme = () => {
      const s = getComputedStyle(document.documentElement);
      const pick = (name, fallback) => (s.getPropertyValue(name).trim() || fallback);
      return {
        accent: pick('--accent-default', '#D4AF37'),
        bright: pick('--text-accent', '#FFE9A8'),
        dust: pick('--text-muted', '#C9D4F6')
      };
    };

    let theme = readTheme();
    let dust = [];
    let anchors = [];
    let links = [];
    let meteors = [];
    let rafId = null;
    let nextMeteorAt = METEOR_INTERVAL;

    function build() {
      theme = readTheme();
      const { clientWidth: w, clientHeight: h } = canvas.parentElement || canvas;
      canvas.width = Math.max(1, Math.floor(w * DPR));
      canvas.height = Math.max(1, Math.floor(h * DPR));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      dust = [];
      anchors = [];
      links = [];

      const dustCount = Math.min(MAX_DUST, Math.floor(w * DUST_PER_PX));
      for (let i = 0; i < dustCount; i++) {
        dust.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: (Math.random() * 1.15 + 0.3) * DPR,
          // Random phase so they don't all twinkle in unison, and a slow random rate.
          p: Math.random() * Math.PI * 2,
          s: Math.random() * 0.0014 + 0.0004,
          gold: Math.random() < 0.18
        });
      }

      const anchorCount = Math.min(MAX_ANCHORS, Math.floor(w * ANCHORS_PER_PX));
      for (let i = 0; i < anchorCount; i++) {
        anchors.push({
          x: Math.random() * canvas.width,
          // Kept out of the very bottom so the links don't crowd the status bar.
          y: Math.random() * canvas.height * 0.92,
          r: (Math.random() * 0.9 + 1.15) * DPR,
          p: Math.random() * Math.PI * 2,
          s: Math.random() * 0.001 + 0.0003
        });
      }

      const maxD = LINK_RADIUS * DPR;
      for (let a = 0; a < anchors.length; a++) {
        const near = [];
        for (let b = a + 1; b < anchors.length; b++) {
          const d = Math.hypot(anchors[a].x - anchors[b].x, anchors[a].y - anchors[b].y);
          if (d < maxD) near.push([b, d]);
        }
        near.sort((u, v) => u[1] - v[1]);
        for (let k = 0; k < Math.min(LINKS_PER_ANCHOR, near.length); k++) {
          links.push([a, near[k][0]]);
        }
      }
    }

    function spawnMeteor() {
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft ? -40 * DPR : canvas.width * (0.3 + Math.random() * 0.7),
        y: canvas.height * Math.random() * 0.35,
        vx: (5.5 + Math.random() * 4) * DPR * (fromLeft ? 1 : 0.85),
        vy: (2 + Math.random() * 1.6) * DPR,
        life: 1
      });
    }

    /** Convert a hex colour to `r, g, b` so it can be used inside rgba(). */
    const rgb = (hex) => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
      return m
        ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`
        : '212, 175, 55';
    };

    function draw(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const accentRgb = rgb(theme.accent);

      // Links first, so stars sit on top of them.
      ctx.lineWidth = 0.6 * DPR;
      for (const [ai, bi] of links) {
        const A = anchors[ai];
        const B = anchors[bi];
        const g = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
        g.addColorStop(0, 'rgba(185, 195, 240, 0.10)');
        g.addColorStop(0.5, `rgba(${accentRgb}, 0.10)`);
        g.addColorStop(1, 'rgba(185, 195, 240, 0.10)');
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }

      // Anchors: a filled dot plus a four-arm glint, which is what makes them read as stars
      // rather than dots.
      for (const an of anchors) {
        const alpha = 0.5 + 0.4 * Math.abs(Math.sin(an.p + t * an.s));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = theme.bright;
        ctx.beginPath();
        ctx.arc(an.x, an.y, an.r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = theme.bright;
        ctx.lineWidth = 0.5 * DPR;
        const arm = an.r * 3.4;
        ctx.beginPath();
        ctx.moveTo(an.x - arm, an.y);
        ctx.lineTo(an.x + arm, an.y);
        ctx.moveTo(an.x, an.y - arm);
        ctx.lineTo(an.x, an.y + arm);
        ctx.stroke();
      }

      // Background dust.
      for (const st of dust) {
        ctx.globalAlpha = 0.18 + 0.5 * Math.abs(Math.sin(st.p + t * st.s));
        ctx.fillStyle = st.gold ? theme.accent : theme.dust;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Meteors, newest last so they draw over the field.
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.009;
        if (m.life <= 0 || m.x > canvas.width + 60 * DPR || m.y > canvas.height + 60 * DPR) {
          meteors.splice(i, 1);
          continue;
        }
        const tailX = m.x - m.vx * 9;
        const tailY = m.y - m.vy * 9;
        const g = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        g.addColorStop(0, `rgba(${accentRgb}, ${0.5 * m.life})`);
        g.addColorStop(1, `rgba(${accentRgb}, 0)`);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4 * DPR;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
    }

    let start = null;
    function frame(now) {
      if (start === null) start = now;
      const t = now - start;
      if (t > nextMeteorAt) {
        spawnMeteor();
        nextMeteorAt = t + METEOR_INTERVAL * (0.6 + Math.random());
      }
      draw(t);
      rafId = requestAnimationFrame(frame);
    }

    const stop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const play = () => {
      if (rafId === null && !reduced) rafId = requestAnimationFrame(frame);
    };

    build();

    /*
     * Paint one frame synchronously before starting the loop.
     *
     * Two reasons this is unconditional rather than only in the reduced-motion branch:
     *   1. requestAnimationFrame does not fire until the next compositor frame, so without this the
     *      canvas is blank for a frame on mount — a visible flash of empty sky.
     *   2. rAF does not fire at all while the document is hidden. If the window opens minimised or
     *      on another desktop, the loop never starts and the sky stays blank until the window is
     *      focused. Drawing once here means there is always a sky, and the loop only adds motion.
     */
    draw(0);
    if (!reduced) play();

    // Pause entirely while the window is hidden — a minimised window should cost nothing.
    const onVisibility = () => (document.hidden ? stop() : play());
    document.addEventListener('visibilitychange', onVisibility);

    /*
     * Rebuild the field. Debounced with setTimeout, NOT requestAnimationFrame: rAF does not fire
     * while the document is hidden, so an rAF-debounced rebuild is silently dropped for a window
     * that is resized or re-themed while minimised — and then never happens at all.
     */
    let rebuildTimer = null;
    const scheduleRebuild = () => {
      if (rebuildTimer !== null) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        rebuildTimer = null;
        build();
        draw(0); // repaint now; the loop may not be running (hidden window, or reduced motion)
      }, 80);
    };

    // ResizeObserver rather than a window listener, because the canvas tracks its parent box.
    const observer = new ResizeObserver(scheduleRebuild);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    /*
     * Repaint when the theme changes.
     *
     * Star colours are pulled from the active theme's custom properties, so switching theme in
     * Settings has to rebuild — otherwise the sky stays gold after switching to Dracula, which is
     * exactly the kind of half-applied theme this app spent a release removing. `data-theme` on
     * <html> is the single signal for a theme change (see resolveTheme in App.jsx).
     */
    const themeObserver = new MutationObserver(scheduleRebuild);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => {
      stop();
      if (rebuildTimer !== null) clearTimeout(rebuildTimer);
      observer.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className={`starfield ${className}`} aria-hidden="true" />;
}
