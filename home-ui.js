document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('heroSearchForm');
  const searchInput = document.getElementById('q');
  const stockSection = document.getElementById('stock');
  const stockGrid = document.getElementById('grid');
  const stockHeading = document.querySelector('#stock .section-head');
  const supermovilidadSection = document.getElementById('supermovilidad');
  const supermovilidadBenefitsRail = document.querySelector('[data-supermovilidad-benefits-grid]');
  const supermovilidadBenefitIndicators = [...document.querySelectorAll('[data-supermovilidad-benefit-indicator]')];
  const header = document.querySelector('.site-header');
  const highlightsRail = document.querySelector('.highlight-grid--final');
  const mobileMedia = window.matchMedia('(max-width: 760px)');
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  let highlightsTimer = null;
  let highlightsResumeTimer = null;
  let highlightsIndex = 0;
  let supermovilidadBenefitsTimer = null;
  let supermovilidadBenefitsResumeTimer = null;
  let supermovilidadBenefitsIndex = 0;

  const scrollToSection = (target, hash, behavior = 'smooth') => {
    if (!target) return;
    const offset = (header?.offsetHeight || 0) + 18;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - offset;

    if (hash) window.history.replaceState(null, '', `#${hash}`);
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
  };

  const scrollToResults = () => {
    const target = stockGrid || stockHeading || stockSection;
    scrollToSection(target, 'stock');
  };

  const motionAwareBehavior = () => (reducedMotionMedia.matches ? 'auto' : 'smooth');

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

  const getSupermovilidadBenefitCards = () => [...document.querySelectorAll('.supermovilidad-benefit-card')];

  const setSupermovilidadBenefitIndicators = () => {
    supermovilidadBenefitIndicators.forEach((indicator, index) => {
      const isActive = index === supermovilidadBenefitsIndex;
      indicator.classList.toggle('is-active', isActive);
      indicator.setAttribute('aria-current', String(isActive));
    });
  };

  const syncSupermovilidadBenefitsIndex = () => {
    if (!supermovilidadBenefitsRail) return;
    const cards = getSupermovilidadBenefitCards();
    if (!cards.length) return;
    const paddingLeft = parseFloat(window.getComputedStyle(supermovilidadBenefitsRail).paddingLeft || '0') || 0;
    const currentLeft = supermovilidadBenefitsRail.scrollLeft;
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

    supermovilidadBenefitsIndex = nearestIndex;
    setSupermovilidadBenefitIndicators();
  };

  const isSupermovilidadBenefitsAutoplayEnabled = () => (
    !!supermovilidadBenefitsRail &&
    mobileMedia.matches &&
    !reducedMotionMedia.matches &&
    getSupermovilidadBenefitCards().length > 1
  );

  const stopSupermovilidadBenefitsAutoplay = () => {
    if (supermovilidadBenefitsTimer) {
      window.clearInterval(supermovilidadBenefitsTimer);
      supermovilidadBenefitsTimer = null;
    }
    if (supermovilidadBenefitsResumeTimer) {
      window.clearTimeout(supermovilidadBenefitsResumeTimer);
      supermovilidadBenefitsResumeTimer = null;
    }
  };

  const scrollSupermovilidadBenefitsTo = (nextIndex, behavior = motionAwareBehavior()) => {
    if (!supermovilidadBenefitsRail) return;
    const cards = getSupermovilidadBenefitCards();
    if (!cards.length) return;
    const paddingLeft = parseFloat(window.getComputedStyle(supermovilidadBenefitsRail).paddingLeft || '0') || 0;
    const boundedIndex = (nextIndex + cards.length) % cards.length;
    supermovilidadBenefitsIndex = boundedIndex;
    setSupermovilidadBenefitIndicators();
    supermovilidadBenefitsRail.scrollTo({
      left: Math.max(0, cards[boundedIndex].offsetLeft - paddingLeft),
      behavior,
    });
  };

  const startSupermovilidadBenefitsAutoplay = () => {
    stopSupermovilidadBenefitsAutoplay();
    if (!isSupermovilidadBenefitsAutoplayEnabled()) return;
    syncSupermovilidadBenefitsIndex();
    supermovilidadBenefitsTimer = window.setInterval(() => {
      const cards = getSupermovilidadBenefitCards();
      if (cards.length < 2) return;
      scrollSupermovilidadBenefitsTo(supermovilidadBenefitsIndex + 1);
    }, 4600);
  };

  const queueSupermovilidadBenefitsAutoplay = () => {
    stopSupermovilidadBenefitsAutoplay();
    if (!isSupermovilidadBenefitsAutoplayEnabled()) return;
    supermovilidadBenefitsResumeTimer = window.setTimeout(() => {
      startSupermovilidadBenefitsAutoplay();
    }, 6800);
  };

  const bindSupermovilidadBenefitsCarousel = () => {
    if (!supermovilidadBenefitsRail) return;

    supermovilidadBenefitIndicators.forEach((indicator, index) => {
      indicator.addEventListener('click', () => {
        queueSupermovilidadBenefitsAutoplay();
        scrollSupermovilidadBenefitsTo(index);
      });
    });

    ['pointerdown', 'touchstart', 'wheel', 'focusin', 'keydown'].forEach((eventName) => {
      supermovilidadBenefitsRail.addEventListener(eventName, queueSupermovilidadBenefitsAutoplay, { passive: eventName !== 'keydown' });
    });

    supermovilidadBenefitsRail.addEventListener('scroll', () => {
      if (!mobileMedia.matches) return;
      syncSupermovilidadBenefitsIndex();
    }, { passive: true });

    const refreshSupermovilidadBenefitsAutoplay = () => {
      if (document.hidden) {
        stopSupermovilidadBenefitsAutoplay();
        return;
      }
      startSupermovilidadBenefitsAutoplay();
    };

    mobileMedia.addEventListener('change', refreshSupermovilidadBenefitsAutoplay);
    reducedMotionMedia.addEventListener('change', refreshSupermovilidadBenefitsAutoplay);
    window.addEventListener('resize', refreshSupermovilidadBenefitsAutoplay);
    document.addEventListener('visibilitychange', refreshSupermovilidadBenefitsAutoplay);

    setSupermovilidadBenefitIndicators();
    startSupermovilidadBenefitsAutoplay();
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();

    searchInput?.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput?.blur();

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToResults);
    });
  });

  document.querySelectorAll('a[href="#supermovilidad"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (!supermovilidadSection) return;
      event.preventDefault();
      scrollToSection(supermovilidadSection, 'supermovilidad');
    });
  });

  document.querySelectorAll('[data-supermovilidad-cta]').forEach((link) => {
    link.addEventListener('click', () => {
      window.RGShared.trackEvent?.('supermovilidad_cta_click', {
        source: 'home_banner',
        destination: 'santander_supermovilidad',
      });
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

  if (window.location.hash === '#supermovilidad' && supermovilidadSection) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToSection(supermovilidadSection, 'supermovilidad', 'auto');
      });
    });
  }
  bindHighlightsAutoplay();
  bindSupermovilidadBenefitsCarousel();
});
