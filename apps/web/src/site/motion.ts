/**
 * Subtle motion on the site (plan solo MVP, S-10). The head script in SiteLayout adds `motion` to <html> only when
 * reduced motion isn't asked for; without it, nothing here hides or moves anything.
 *
 * - `[data-reveal]` elements fade and rise in once, as they enter the view;
 * - the navbar marks the link of the section in view (`aria-current="location"`) and gets a shadow once scrolled.
 */
const root = document.documentElement;

function reveal() {
  const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (!root.classList.contains('motion') || !('IntersectionObserver' in window)) {
    for (const el of items) el.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  for (const el of items) io.observe(el);
}

function activeSection() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.site-nav__links a[data-section]')];
  const sections = links.map((a) => document.getElementById(a.dataset.section!)).filter((s): s is HTMLElement => !!s);
  if (!sections.length || !('IntersectionObserver' in window)) return;
  const mark = (id: string | null) => {
    for (const a of links) {
      if (a.dataset.section === id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  };
  // A section is current while it crosses a band just below the middle of the screen.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) mark(e.target.id);
        else if (links.some((a) => a.dataset.section === e.target.id && a.hasAttribute('aria-current'))) mark(null);
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  for (const s of sections) io.observe(s);
}

function scrolledNav() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  const update = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

reveal();
activeSection();
scrolledNav();
root.dataset.motionReady = '1';
