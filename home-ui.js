document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('heroSearchForm');
  const searchInput = document.getElementById('q');
  const stockSection = document.getElementById('stock');
  const stockGrid = document.getElementById('grid');
  const stockHeading = document.querySelector('#stock .section-head');
  const header = document.querySelector('.site-header');
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

  const initializeCoverVideo = () => {
    const video = document.getElementById('homeCoverVideo');
    const toggle = document.getElementById('homeVideoToggle');
    if (!video || !toggle) return;

    const label = toggle.querySelector('[data-video-label]');
    const icon = toggle.querySelector('[data-video-icon]');
    const hideControl = () => { toggle.hidden = true; };
    if (typeof video.canPlayType !== 'function' || !video.canPlayType('video/mp4') || video.error) {
      hideControl();
      return;
    }

    const syncControl = () => {
      const playing = !video.paused && !video.ended;
      const action = playing ? 'Pausar video' : 'Reproducir video';
      toggle.setAttribute('aria-label', action);
      toggle.setAttribute('aria-pressed', String(playing));
      toggle.title = action;
      if (label) label.textContent = action;
      if (icon) icon.textContent = playing ? 'Ⅱ' : '▶';
    };

    const pauseForReducedMotion = () => {
      if (!reducedMotionMedia.matches) return;
      video.autoplay = false;
      video.removeAttribute('autoplay');
      video.pause();
      syncControl();
    };

    toggle.hidden = false;
    video.addEventListener('play', syncControl);
    video.addEventListener('pause', syncControl);
    video.addEventListener('ended', syncControl);
    video.addEventListener('error', hideControl);
    video.querySelectorAll('source').forEach((source) => {
      source.addEventListener('error', hideControl);
    });
    toggle.addEventListener('click', async () => {
      if (!video.paused && !video.ended) {
        video.pause();
      } else {
        try {
          await video.play();
        } catch (error) {
          if (error?.name === 'NotSupportedError') hideControl();
        }
      }
      syncControl();
    });
    reducedMotionMedia.addEventListener('change', pauseForReducedMotion);
    pauseForReducedMotion();
    syncControl();
  };

  const scrollToResults = () => {
    const target = stockGrid || stockHeading || stockSection;
    if (!target) return;
    const offset = (header?.offsetHeight || 0) + 18;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - offset;

    window.history.replaceState(null, '', '#stock');
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: reducedMotionMedia.matches ? 'instant' : 'smooth',
    });
  };

  const buildHomeNavigation = () => {
    const navigation = header?.querySelector('.header-nav--desktop');
    if (!navigation) return;

    // Keep the shared services menu and its existing keyboard/click handlers.
    [...navigation.children].forEach((item) => {
      if (item.tagName === 'A') item.remove();
    });
    const links = [
      { href: '#stock', label: 'Stock' },
      { href: './consignacion.html', label: 'Vendé tu auto' },
      { href: './financiacion.html', label: 'Financiación' },
      { href: '#contacto', label: 'Ubicación' },
    ];
    const primaryLinks = document.createDocumentFragment();
    links.forEach(({ href, label }) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      primaryLinks.appendChild(link);
    });
    navigation.prepend(primaryLinks);
    const primaryDestinations = new Set(links.map(({ href }) => href));
    navigation.querySelectorAll('.services-dropdown a').forEach((link) => {
      if (primaryDestinations.has(link.getAttribute('href'))) link.remove();
    });

    const actions = header.querySelector('.header-actions--desktop');
    if (!actions || actions.querySelector('.home-header-contact')) return;
    const contact = document.createElement('a');
    const whatsappNumber = String(window.RG?.WHATSAPP || '5492964588267').replace(/\D+/g, '');
    contact.className = 'home-header-contact';
    contact.href = `https://wa.me/${whatsappNumber}`;
    contact.target = '_blank';
    contact.rel = 'noopener noreferrer';
    contact.textContent = 'Hablemos';
    contact.setAttribute('aria-label', 'Hablemos por WhatsApp');
    actions.appendChild(contact);
  };

  const revealSections = () => {
    const elements = [...document.querySelectorAll('[data-home-reveal]')];
    if (!elements.length || reducedMotionMedia.matches || !('IntersectionObserver' in window)) return;

    const activeAnimations = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        observer.unobserve(target);
        target.classList.add('is-revealed');

        // The document never depends on opacity/visibility classes to be readable.
        if (reducedMotionMedia.matches || typeof target.animate !== 'function') return;
        const animation = target.animate(
          [
            { opacity: 0.65, transform: 'translateY(16px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 480, easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)' },
        );
        activeAnimations.add(animation);
        animation.onfinish = () => activeAnimations.delete(animation);
        animation.oncancel = () => activeAnimations.delete(animation);
      });
    }, { threshold: 0.08 });
    elements.forEach((element) => observer.observe(element));

    reducedMotionMedia.addEventListener('change', () => {
      if (!reducedMotionMedia.matches) return;
      activeAnimations.forEach((animation) => animation.cancel());
      activeAnimations.clear();
      observer.disconnect();
    });
  };

  const loadLocationMap = () => {
    const map = document.querySelector('iframe[data-location-map]');
    if (!map || !map.dataset.src) return;
    const status = document.getElementById('homeMapStatus');
    let mapStarted = false;

    const loadMap = () => {
      if (mapStarted) return;
      mapStarted = true;
      map.setAttribute('aria-busy', 'true');
      if (status) status.textContent = 'Cargando el mapa de nuestra agencia…';

      const fallbackTimer = window.setTimeout(() => {
        if (status) status.textContent = 'También podés abrir la ubicación en Google Maps.';
      }, 12000);
      map.addEventListener('load', () => {
        window.clearTimeout(fallbackTimer);
        map.setAttribute('aria-busy', 'false');
        map.classList.add('is-loaded');
        if (status) status.textContent = 'Consultá la ubicación o abrí las indicaciones en Google Maps.';
      }, { once: true });
      map.addEventListener('error', () => {
        window.clearTimeout(fallbackTimer);
        map.setAttribute('aria-busy', 'false');
        if (status) status.textContent = 'Abrí la ubicación en Google Maps para ver cómo llegar.';
      }, { once: true });
      map.src = map.dataset.src;
    };

    if (!('IntersectionObserver' in window)) {
      loadMap();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadMap();
    }, { rootMargin: '400px 0px', threshold: 0 });
    observer.observe(map);
  };

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    searchInput?.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput?.blur();

    // Put keyboard users immediately before the resulting vehicle links.
    if (stockGrid) {
      stockGrid.setAttribute('tabindex', '-1');
      stockGrid.focus({ preventScroll: true });
    }
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

  const feedbackButton = document.querySelector('.feedback-floating-button');
  if (feedbackButton) {
    feedbackButton.textContent = 'Tu opinión';
    feedbackButton.setAttribute('aria-label', 'Tu opinión: abrir formulario de sugerencias');
  }

  buildHomeNavigation();
  initializeCoverVideo();
  revealSections();
  loadLocationMap();
});
