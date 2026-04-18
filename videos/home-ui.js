document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('heroSearchForm');
  const searchInput = document.getElementById('q');
  const stockSection = document.getElementById('stock');
  const stockGrid = document.getElementById('grid');
  const stockHeading = document.querySelector('#stock .section-head');
  const header = document.querySelector('.site-header');

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
});
