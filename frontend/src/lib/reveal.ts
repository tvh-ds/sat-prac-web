export function initReveal() {
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        const delay = el.dataset.delay ? Number(el.dataset.delay) : 0;
        setTimeout(() => el.classList.add("visible"), delay);
        obs.unobserve(el);
      }
    },
    { threshold: 0.08 }
  );
  const els = document.querySelectorAll<HTMLElement>(".reveal");
  // stagger siblings
  for (const el of els) {
    if (!el.dataset.delay) {
      const siblings = Array.from(el.parentElement?.querySelectorAll(".reveal") ?? []);
      const idx = siblings.indexOf(el);
      el.dataset.delay = String(idx * 90);
    }
    obs.observe(el);
  }
}

export function initCountup() {
  const els = document.querySelectorAll<HTMLElement>("[data-countup]");
  for (const el of els) {
    const target = Number(el.dataset.countup);
    if (Number.isNaN(target)) continue;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          obs.disconnect();
          const start = performance.now();
          const isFloat = String(target).includes(".");
          const tick = (now: number) => {
            const p = Math.min((now - start) / 1800, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            const cur = ease * target;
            el.textContent = isFloat ? cur.toFixed(1) : String(Math.floor(cur));
            if (p < 1) requestAnimationFrame(tick);
            else el.textContent = String(target);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(el);
  }
}
