class CartDrawer extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('keyup', (evt) => evt.code === 'Escape' && this.close());
    this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
    this.setHeaderCartIconAccessibility();
  }

  setHeaderCartIconAccessibility() {
    const cartLink = document.querySelector('#cart-icon-bubble');
    if (!cartLink) return;

    cartLink.setAttribute('role', 'button');
    cartLink.setAttribute('aria-haspopup', 'dialog');
    cartLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.open(cartLink);
    });
    cartLink.addEventListener('keydown', (event) => {
      if (event.code.toUpperCase() === 'SPACE') {
        event.preventDefault();
        this.open(cartLink);
      }
    });
  }

  open(triggeredBy) {
    if (this.classList.contains('active')) return;
    if (triggeredBy) this.setActiveElement(triggeredBy);
    const cartDrawerNote = this.querySelector('[id^="Details-"] summary');
    if (cartDrawerNote && !cartDrawerNote.hasAttribute('role')) this.setSummaryAccessibility(cartDrawerNote);
    // here the animation doesn't seem to always get triggered. A timeout seem to help
    setTimeout(() => {
      this.classList.add('animate', 'active');
    });

    this.addEventListener(
      'transitionend',
      () => {
        const containerToTrapFocusOn = this.classList.contains('is-empty')
          ? this.querySelector('.drawer__inner-empty')
          : document.getElementById('CartDrawer');
        const focusElement = this.querySelector('.drawer__inner') || this.querySelector('.drawer__close');
        trapFocus(containerToTrapFocusOn, focusElement);
      },
      { once: true },
    );

    document.body.classList.add('overflow-hidden');

    // cart-drawer-items is a CartItems subclass that extends createViewEventElement.
    // Its `view-event-trigger="manual"` skips auto-dispatch on connect; we fire
    // it here when the drawer opens, with `context: 'dialog'` from the payload attribute.
    this.querySelector('cart-drawer-items')?.dispatchViewEvent();
  }

  close() {
    this.classList.remove('active');
    removeTrapFocus(this.activeElement);
    document.body.classList.remove('overflow-hidden');
  }

  setSummaryAccessibility(cartDrawerNote) {
    cartDrawerNote.setAttribute('role', 'button');
    cartDrawerNote.setAttribute('aria-expanded', 'false');

    if (cartDrawerNote.nextElementSibling.getAttribute('id')) {
      cartDrawerNote.setAttribute('aria-controls', cartDrawerNote.nextElementSibling.id);
    }

    cartDrawerNote.addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-expanded', !event.currentTarget.closest('details').hasAttribute('open'));
    });

    cartDrawerNote.parentElement.addEventListener('keyup', onKeyUpEscape);
  }

  renderContents(parsedState) {
    this.querySelector('.drawer__inner').classList.contains('is-empty') &&
      this.querySelector('.drawer__inner').classList.remove('is-empty');
    this.productId = parsedState.id;
    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);

      if (!sectionElement) return;
      sectionElement.innerHTML = this.getSectionInnerHTML(parsedState.sections[section.id], section.selector);
    });

    setTimeout(() => {
      this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
      this.open();
      window.freeGiftManager?.handleCartUpdateFromDOM();
    });
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  getSectionsToRender() {
    return [
      {
        id: 'cart-drawer',
        selector: '#CartDrawer',
      },
      {
        id: 'cart-icon-bubble',
      },
    ];
  }

  getSectionDOM(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
  }

  setActiveElement(element) {
    this.activeElement = element;
  }
}

customElements.define('cart-drawer', CartDrawer);

class CartDrawerItems extends CartItems {
  getSectionsToRender() {
    return [
      {
        id: 'CartDrawer',
        section: 'cart-drawer',
        selector: '.drawer__inner',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
    ];
  }
}

customElements.define('cart-drawer-items', CartDrawerItems);

// ===== AUTO-ADD GIFT ON CART LOAD =====
(function() {
  function checkAndAddGift() {
    if (window.__USE_EVENT_DRIVEN_FREE_GIFT__) return;
    const rewardsElement = document.querySelector('.rewards-progress');
    if (!rewardsElement) return;
    
    const currentTier = parseInt(rewardsElement.dataset.currentTier || '0');
    const giftInCart = rewardsElement.dataset.giftInCart === 'true';
    const cartTotal = parseFloat(rewardsElement.dataset.cartTotal || '0');
    
    console.log('===== AUTO-GIFT CHECK =====');
    console.log('Current Tier:', currentTier);
    console.log('Gift in Cart:', giftInCart);
    console.log('Cart Total:', cartTotal);
    
    if (currentTier > 0 && !giftInCart) {
      console.log('Adding gift for tier:', currentTier);
      
      // Get the variant ID based on tier
      const tier1Variant = '{{ gift_variant_tier1 }}';
      const tier2Variant = '{{ gift_variant_tier2 }}';
      const tier3Variant = '{{ gift_variant_tier3 }}';
      
      let variantId = '';
      if (currentTier === 3) variantId = tier3Variant;
      else if (currentTier === 2) variantId = tier2Variant;
      else if (currentTier === 1) variantId = tier1Variant;
      
      if (variantId) {
        // Add gift to cart
        fetch('/cart/add.js', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items: [{
              id: parseInt(variantId),
              quantity: 1,
              properties: {
                _gift: 'true',
                _gift_tier: currentTier
              }
            }]
          })
        })
        .then(response => response.json())
        .then(data => {
          console.log('Gift added successfully:', data);
          // Reload the cart section
          location.reload();
        })
        .catch(error => {
          console.error('Error adding gift:', error);
        });
      }
    }
  }
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndAddGift);
  } else {
    setTimeout(checkAndAddGift, 1000);
  }
  
  // Also run when cart drawer opens
  document.addEventListener('click', function(e) {
    if (e.target.closest('#cart-icon-bubble') || e.target.closest('[aria-controls="CartDrawer"]')) {
      setTimeout(checkAndAddGift, 500);
    }
  });
})();
