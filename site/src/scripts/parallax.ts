// Scroll parallax: transform-only, rAF-throttled, passive. Elements opt in via
// data-parallax="<speed>" (fraction of scroll they lag by; negative leads) and
// an optional data-parallax-max="<px>" travel clamp. Elements far from the top
// of the page add data-parallax-view to compute lag from their viewport
// position instead, so they sit centered at rest.
//
// Imported (and therefore executed exactly once per page, thanks to ES module
// caching) by any component that renders a parallax layer.

const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const items = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]')).map((el) => ({
  el,
  speed: parseFloat(el.getAttribute('data-parallax') || '0'),
  max: parseFloat(el.getAttribute('data-parallax-max') || '40'),
  view: el.hasAttribute('data-parallax-view'),
  last: 0,
}));

if (motionOk && items.length > 0) {
  let ticking = false;

  const frame = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const item of items) {
      let delta: number;
      if (item.view) {
        const rect = item.el.getBoundingClientRect();
        // Subtract the transform we already applied to get the untransformed center
        const center = rect.top + rect.height / 2 - item.last;
        delta = (center - vh / 2) * item.speed;
      } else {
        delta = window.scrollY * item.speed;
      }
      delta = Math.max(-item.max, Math.min(item.max, delta));
      if (delta !== item.last) {
        item.el.style.transform = `translate3d(0, ${delta.toFixed(2)}px, 0)`;
        item.last = delta;
      }
    }
  };

  const schedule = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  frame();
}
