(() => {
  'use strict';

  /* Header scroll state */
  const header = document.getElementById('siteHeader');
  const onScroll = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 40);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Mobile nav toggle — locks body scroll while open to avoid an iOS WebKit
     bug where nested fixed-position elements (primary-nav inside the fixed
     header) desync once the page has been scrolled. */
  const navToggle = document.getElementById('navToggle');
  const primaryNav = document.getElementById('primaryNav');
  let lockedScrollY = 0;

  const openNav = () => {
    lockedScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.width = '100%';
    document.body.classList.add('nav-open');
    navToggle.setAttribute('aria-expanded', 'true');
  };

  const closeNav = () => {
    document.body.classList.remove('nav-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, lockedScrollY);
    navToggle.setAttribute('aria-expanded', 'false');
  };

  navToggle.addEventListener('click', () => {
    if (document.body.classList.contains('nav-open')) closeNav();
    else openNav();
  });
  primaryNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeNav);
  });

  /* Safety: if viewport crosses to desktop layout while menu is open
     (e.g. orientation/resize), release the scroll lock. */
  const desktopMq = window.matchMedia('(min-width: 900px)');
  desktopMq.addEventListener('change', (e) => {
    if (e.matches && document.body.classList.contains('nav-open')) closeNav();
  });

  /* Scroll-reveal */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealTargets = document.querySelectorAll('.fade-in');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealTargets.forEach((el) => observer.observe(el));
  }

  /* Home headshot carousel — coverflow style, auto-rotates slowly, click opens modal */
  const carouselTrack = document.getElementById('homeCarouselTrack');
  if (carouselTrack) {
    const carouselSlides = Array.from(carouselTrack.querySelectorAll('.home-carousel-slide'));
    const total = carouselSlides.length;
    let active = 0;
    let paused = false;

    const layout = () => {
      carouselSlides.forEach((slide, i) => {
        let offset = i - active;
        if (offset > total / 2) offset -= total;
        if (offset < -total / 2) offset += total;

        const abs = Math.abs(offset);
        const spacing = 46; // % of slide width per step
        const scale = abs === 0 ? 1 : abs === 1 ? 0.72 : 0.5;
        const opacity = abs > 2 ? 0 : abs === 0 ? 1 : abs === 1 ? 0.65 : 0.35;

        slide.style.transform = `translate(-50%, -50%) translateX(${offset * spacing}%) scale(${scale})`;
        slide.style.opacity = String(opacity);
        slide.style.zIndex = String(total - abs);
        slide.style.pointerEvents = abs > 2 ? 'none' : 'auto';
      });
    };
    layout();

    let intervalId = null;
    if (!reduceMotion && total > 1) {
      intervalId = setInterval(() => {
        if (paused) return;
        active = (active + 1) % total;
        layout();
      }, 5500);
    }

    const carousel = document.getElementById('homeCarousel');
    const pause = () => { paused = true; };
    const resume = () => { paused = false; };
    carousel.addEventListener('mouseenter', pause);
    carousel.addEventListener('mouseleave', resume);
    carousel.addEventListener('focusin', pause);
    carousel.addEventListener('focusout', resume);

    carouselSlides.forEach((slide, i) => {
      slide.addEventListener('click', () => {
        active = i;
        layout();
      });
    });

    const portraitModal = document.getElementById('portraitModal');
    if (portraitModal) {
      portraitModal.addEventListener('modal:open', pause);
      portraitModal.addEventListener('modal:close', resume);
    }
  }

  /* Reel eyebrow — pull the live YouTube video title via oEmbed */
  const reelFrame = document.getElementById('heroReelFrame');
  const reelEyebrow = document.getElementById('reelEyebrow');
  if (reelFrame && reelEyebrow) {
    const match = reelFrame.src.match(/embed\/([^?]+)/);
    const videoId = match ? match[1] : null;
    if (videoId) {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          if (data && data.title) reelEyebrow.textContent = data.title;
        })
        .catch(() => {
          /* Keep fallback "Showreel" label on failure */
        });
    }
  }

  /* Reusable modal gallery (used by Video Gallery + CV photo modal) */
  const initGalleryModal = ({ modalId, cardSelector, frameId, titleId, wordmarkId, buildMedia }) => {
    const modal = document.getElementById(modalId);
    if (!modal) return null;

    const frame = document.getElementById(frameId);
    const titleEl = document.getElementById(titleId);
    const wordmarkEl = document.getElementById(wordmarkId);
    const modalContent = modal.querySelector('.modal-content');
    const cards = Array.from(document.querySelectorAll(cardSelector));
    let lastFocused = null;
    let currentIndex = -1;

    const load = (index) => {
      currentIndex = (index + cards.length) % cards.length;
      const card = cards[currentIndex];
      const { html, title } = buildMedia(card);
      frame.innerHTML = html;
      titleEl.textContent = title;
    };

    const showPrev = () => load(currentIndex - 1);
    const showNext = () => load(currentIndex + 1);

    const animateWordmark = () => {
      const headerMark = document.querySelector('.site-header .wordmark');
      if (reduceMotion || !headerMark || !wordmarkEl) return;
      const startRect = headerMark.getBoundingClientRect();
      const endRect = wordmarkEl.getBoundingClientRect();
      if (!endRect.width || !endRect.height) return;
      const dx = startRect.left - endRect.left;
      const dy = startRect.top - endRect.top;
      const scaleX = startRect.width / endRect.width;
      const scaleY = startRect.height / endRect.height;
      wordmarkEl.style.transition = 'none';
      wordmarkEl.style.transformOrigin = 'top left';
      wordmarkEl.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
      // Force reflow so the start state renders before animating.
      wordmarkEl.getBoundingClientRect();
      requestAnimationFrame(() => {
        wordmarkEl.style.transition = 'transform var(--dur) var(--ease)';
        wordmarkEl.style.transform = 'translate(0, 0) scale(1, 1)';
      });
      wordmarkEl.addEventListener('transitionend', function cleanup() {
        wordmarkEl.style.transition = '';
        wordmarkEl.style.transform = '';
        wordmarkEl.style.transformOrigin = '';
        wordmarkEl.removeEventListener('transitionend', cleanup);
      });
    };

    const openModal = (index) => {
      lastFocused = document.activeElement;
      load(index);
      modal.hidden = false;
      document.body.classList.add('modal-open');
      animateWordmark();
      modal.querySelector('.modal-close').focus();
      document.addEventListener('keydown', onKeydown);
      modal.dispatchEvent(new CustomEvent('modal:open'));
    };

    const closeModal = () => {
      modal.hidden = true;
      frame.innerHTML = '';
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKeydown);
      if (lastFocused) lastFocused.focus();
      modal.dispatchEvent(new CustomEvent('modal:close'));
    };

    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        closeModal();
        return;
      }
      if (e.key === 'ArrowLeft') {
        showPrev();
        return;
      }
      if (e.key === 'ArrowRight') {
        showNext();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll('button, [href], iframe, img');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    cards.forEach((card, index) => {
      card.addEventListener('click', () => openModal(index));
    });

    modal.querySelectorAll('[data-modal-close]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    modal.querySelector('.modal-nav-prev').addEventListener('click', showPrev);
    modal.querySelector('.modal-nav-next').addEventListener('click', showNext);

    /* Swipe left/right to navigate on touch devices */
    let touchStartX = 0;
    modalContent.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    modalContent.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) showNext();
      else showPrev();
    }, { passive: true });

    return { openModal, closeModal };
  };

  /* Video modal (Video Gallery page) */
  initGalleryModal({
    modalId: 'videoModal',
    cardSelector: '.video-card',
    frameId: 'modalVideoFrame',
    titleId: 'modalVideoTitle',
    wordmarkId: 'modalWordmark',
    buildMedia: (card) => {
      const videoId = card.dataset.videoId;
      const title = card.dataset.videoTitle;
      const html = `<iframe src="https://www.youtube.com/embed/${videoId}?rel=0&autoplay=1" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      return { html, title };
    },
  });

  /* Portrait modal (Homepage carousel) */
  initGalleryModal({
    modalId: 'portraitModal',
    cardSelector: '.home-carousel-slide',
    frameId: 'modalPortraitFrame',
    titleId: 'modalPortraitTitle',
    wordmarkId: 'modalPortraitWordmark',
    buildMedia: (card) => {
      const label = card.dataset.photoLabel || card.dataset.label;
      const src = card.dataset.photoSrc;
      const html = src
        ? `<img src="${src}" alt="${label}">`
        : `<div class="modal-photo-placeholder" data-label="${label}"></div>`;
      return { html, title: label };
    },
  });

  /* Photo modal (CV page headshot slideshow) */
  initGalleryModal({
    modalId: 'photoModal',
    cardSelector: '.cv-slide',
    frameId: 'modalPhotoFrame',
    titleId: 'modalPhotoTitle',
    wordmarkId: 'modalPhotoWordmark',
    buildMedia: (card) => {
      const label = card.dataset.photoLabel || card.dataset.label;
      const src = card.dataset.photoSrc;
      const html = src
        ? `<img src="${src}" alt="${label}">`
        : `<div class="modal-photo-placeholder" data-label="${label}"></div>`;
      return { html, title: label };
    },
  });

  /* Product photo modal (Products page) */
  initGalleryModal({
    modalId: 'productModal',
    cardSelector: '.product-slide',
    frameId: 'modalProductFrame',
    titleId: 'modalProductTitle',
    wordmarkId: 'modalProductWordmark',
    buildMedia: (card) => {
      const label = card.dataset.photoLabel || card.dataset.label;
      const src = card.dataset.photoSrc;
      const html = src
        ? `<img src="${src}" alt="${label}">`
        : `<div class="modal-photo-placeholder" data-label="${label}"></div>`;
      return { html, title: label };
    },
  });

  /* CV headshot slideshow — auto-advances, pauses on hover/focus/modal open */
  const cvSlideshow = document.getElementById('cvSlideshow');
  if (cvSlideshow) {
    const cvSlides = cvSlideshow.querySelectorAll('.cv-slide');
    if (cvSlides.length > 1 && !reduceMotion) {
      let current = 0;
      let paused = false;
      setInterval(() => {
        if (paused) return;
        cvSlides[current].classList.remove('is-active');
        current = (current + 1) % cvSlides.length;
        cvSlides[current].classList.add('is-active');
      }, 4500);

      const pause = () => { paused = true; };
      const resume = () => { paused = false; };
      cvSlideshow.addEventListener('mouseenter', pause);
      cvSlideshow.addEventListener('mouseleave', resume);
      cvSlideshow.addEventListener('focusin', pause);
      cvSlideshow.addEventListener('focusout', resume);

      const photoModal = document.getElementById('photoModal');
      if (photoModal) {
        photoModal.addEventListener('modal:open', pause);
        photoModal.addEventListener('modal:close', resume);
      }
    }
  }

  /* Product galleries (Products page) — auto-advance per product, pause on hover/focus/modal open */
  const productGalleries = document.querySelectorAll('.product-slideshow');
  if (productGalleries.length) {
    const productModal = document.getElementById('productModal');
    productGalleries.forEach((gallery) => {
      const slides = gallery.querySelectorAll('.product-slide');
      if (slides.length < 2 || reduceMotion) return;
      let current = 0;
      let paused = false;
      setInterval(() => {
        if (paused) return;
        slides[current].classList.remove('is-active');
        current = (current + 1) % slides.length;
        slides[current].classList.add('is-active');
      }, 4500);

      const pause = () => { paused = true; };
      const resume = () => { paused = false; };
      gallery.addEventListener('mouseenter', pause);
      gallery.addEventListener('mouseleave', resume);
      gallery.addEventListener('focusin', pause);
      gallery.addEventListener('focusout', resume);

      if (productModal) {
        productModal.addEventListener('modal:open', pause);
        productModal.addEventListener('modal:close', resume);
      }
    });
  }

  /* CV tabs */
  const cvTablist = document.querySelector('.cv-tablist');
  if (cvTablist) {
    const tabs = Array.from(cvTablist.querySelectorAll('.cv-tab'));
    const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

    const activate = (index) => {
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle('is-active', selected);
        panels[i].hidden = !selected;
        panels[i].classList.toggle('is-active', selected);
      });
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => activate(i));
      tab.addEventListener('keydown', (e) => {
        let newIndex = null;
        if (e.key === 'ArrowRight') newIndex = (i + 1) % tabs.length;
        if (e.key === 'ArrowLeft') newIndex = (i - 1 + tabs.length) % tabs.length;
        if (newIndex === null) return;
        e.preventDefault();
        tabs[newIndex].focus();
        activate(newIndex);
      });
    });
  }

  /* Email contact modal (Contact page) */
  const emailModal = document.getElementById('emailModal');
  if (emailModal) {
    /* ---- EmailJS setup ----
       1. Create a free account at https://www.emailjs.com
       2. Add an Email Service (connect the inbox you want messages delivered to —
          this address is never exposed in the code below).
       3. Create an Email Template with variables: sender_email, subject, message.
       4. Replace the three placeholders below with your Service ID, Template ID,
          and Public Key (all from the EmailJS dashboard — safe to expose client-side).
    */
    const EMAILJS_SERVICE_ID = 'service_t5d42nu';
    const EMAILJS_TEMPLATE_ID = 'template_je00uxx';
    const EMAILJS_PUBLIC_KEY = 'DwovGeG97KkJLpMeT';

    if (window.emailjs && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
      emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }

    const form = document.getElementById('emailForm');
    const messageField = document.getElementById('emailMessage');
    const counter = document.getElementById('emailMessageCounter');
    const statusEl = document.getElementById('emailFormStatus');
    const submitBtn = document.getElementById('emailSubmitBtn');
    let lastFocused = null;

    const updateCounter = () => {
      const len = messageField.value.length;
      counter.textContent = `${len} / 2000`;
      counter.classList.toggle('is-limit', len >= 2000);
    };
    messageField.addEventListener('input', updateCounter);

    const openEmailModal = () => {
      lastFocused = document.activeElement;
      emailModal.hidden = false;
      document.body.classList.add('modal-open');
      emailModal.querySelector('.modal-close').focus();
      document.addEventListener('keydown', onEmailKeydown);
    };

    const closeEmailModal = () => {
      emailModal.hidden = true;
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onEmailKeydown);
      if (lastFocused) lastFocused.focus();
    };

    const onEmailKeydown = (e) => {
      if (e.key === 'Escape') {
        closeEmailModal();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = emailModal.querySelectorAll('button, input, textarea, [href]');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.querySelectorAll('#emailModalTrigger, [data-email-trigger]').forEach((el) => {
      el.addEventListener('click', openEmailModal);
    });
    emailModal.querySelectorAll('[data-modal-close]').forEach((el) => {
      el.addEventListener('click', closeEmailModal);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      statusEl.textContent = '';
      statusEl.className = 'form-status';

      /* Honeypot — if filled, silently treat as success and stop (bot trap) */
      if (form.companyWebsite.value) {
        form.reset();
        updateCounter();
        statusEl.textContent = 'Message sent. Thank you.';
        statusEl.classList.add('is-success');
        return;
      }

      if (!form.reportValidity()) return;

      if (!window.emailjs || EMAILJS_PUBLIC_KEY === 'YOUR_PUBLIC_KEY') {
        statusEl.textContent = 'Email is not configured yet. Please try again later.';
        statusEl.classList.add('is-error');
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = 'Sending…';

      try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          sender_email: form.senderEmail.value,
          subject: form.emailSubject.value,
          message: form.emailMessage.value,
        });
        form.reset();
        updateCounter();
        statusEl.textContent = 'Message sent. Thank you.';
        statusEl.className = 'form-status is-success';
      } catch (err) {
        statusEl.textContent = 'Something went wrong. Please try again.';
        statusEl.className = 'form-status is-error';
      } finally {
        submitBtn.disabled = false;
      }
    });

  }

  /* Footer year */
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
