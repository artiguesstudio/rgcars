document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('heroSearchForm');
  const searchInput = document.getElementById('q');
  const stockSection = document.getElementById('stock');
  const stockGrid = document.getElementById('grid');
  const stockHeading = document.querySelector('#stock .section-head');
  const header = document.querySelector('.site-header');
  const highlightsRail = document.querySelector('.highlight-grid--final');
  const mobileMedia = window.matchMedia('(max-width: 760px)');
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  let highlightsTimer = null;
  let highlightsResumeTimer = null;
  let highlightsIndex = 0;

  const scrollToResults = () => {
    const target = stockGrid || stockHeading || stockSection;
    if (!target) return;
    const offset = (header?.offsetHeight || 0) + 18;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - offset;

    window.history.replaceState(null, '', '#stock');
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  };

  const getHighlightCards = () => [...document.querySelectorAll('.highlight-grid--final .highlight-card')];

  const syncHighlightsIndex = () => {
    if (!highlightsRail) return;
    const cards = getHighlightCards();
    if (!cards.length) return;
    const paddingLeft = parseFloat(window.getComputedStyle(highlightsRail).paddingLeft || '0') || 0;
    const currentLeft = highlightsRail.scrollLeft;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
      const cardLeft = Math.max(0, card.offsetLeft - paddingLeft);
      const distance = Math.abs(cardLeft - currentLeft);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    highlightsIndex = nearestIndex;
  };

  const isHighlightsAutoplayEnabled = () => (
    !!highlightsRail &&
    mobileMedia.matches &&
    !reducedMotionMedia.matches &&
    getHighlightCards().length > 1
  );

  const stopHighlightsAutoplay = () => {
    if (highlightsTimer) {
      window.clearInterval(highlightsTimer);
      highlightsTimer = null;
    }
    if (highlightsResumeTimer) {
      window.clearTimeout(highlightsResumeTimer);
      highlightsResumeTimer = null;
    }
  };

  const scrollHighlightsTo = (nextIndex) => {
    if (!highlightsRail) return;
    const cards = getHighlightCards();
    if (!cards.length) return;
    const paddingLeft = parseFloat(window.getComputedStyle(highlightsRail).paddingLeft || '0') || 0;
    const boundedIndex = (nextIndex + cards.length) % cards.length;
    highlightsIndex = boundedIndex;
    highlightsRail.scrollTo({
      left: Math.max(0, cards[boundedIndex].offsetLeft - paddingLeft),
      behavior: 'smooth',
    });
  };

  const startHighlightsAutoplay = () => {
    stopHighlightsAutoplay();
    if (!isHighlightsAutoplayEnabled()) return;
    syncHighlightsIndex();
    highlightsTimer = window.setInterval(() => {
      const cards = getHighlightCards();
      if (cards.length < 2) return;
      scrollHighlightsTo(highlightsIndex + 1);
    }, 3600);
  };

  const queueHighlightsAutoplay = () => {
    stopHighlightsAutoplay();
    if (!isHighlightsAutoplayEnabled()) return;
    highlightsResumeTimer = window.setTimeout(() => {
      startHighlightsAutoplay();
    }, 5200);
  };

  const bindHighlightsAutoplay = () => {
    if (!highlightsRail) return;
    const interactionEvents = ['pointerdown', 'touchstart', 'wheel'];
    interactionEvents.forEach((eventName) => {
      highlightsRail.addEventListener(eventName, queueHighlightsAutoplay, { passive: true });
    });
    highlightsRail.addEventListener('scroll', () => {
      if (!mobileMedia.matches) return;
      syncHighlightsIndex();
    }, { passive: true });

    const refreshHighlightsAutoplay = () => {
      if (document.hidden) {
        stopHighlightsAutoplay();
        return;
      }
      startHighlightsAutoplay();
    };

    mobileMedia.addEventListener('change', refreshHighlightsAutoplay);
    reducedMotionMedia.addEventListener('change', refreshHighlightsAutoplay);
    window.addEventListener('resize', refreshHighlightsAutoplay);
    document.addEventListener('visibilitychange', refreshHighlightsAutoplay);
    startHighlightsAutoplay();
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();

    searchInput?.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput?.blur();

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToResults);
    });
  });

  document.querySelectorAll('.accordion-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.accordion-item');
      if (!item) return;
      const isOpen = item.classList.contains('is-open');
      item.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  bindHighlightsAutoplay();
});
