/*
 * Tiered free-gift cart synchronizer.
 * One event-driven manager replaces the theme's previous timers and polling.
 */
(function () {
  'use strict';

  if (window.__FREE_GIFT_MANAGER_V2__) return;
  window.__FREE_GIFT_MANAGER_V2__ = true;

  const nativeFetch = window.fetch.bind(window);
  const GIFT_PROPERTY = '_gift';
  const TIER_PROPERTY = '_gift_tier';
  const CART_MUTATION = /\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/;

  class FreeGiftManager {
    constructor() {
      this.isProcessing = false;
      this.queued = false;
      this.pendingCart = null;
      this.initialized = false;
      
      // Add CSS styles immediately
      this._addOrderStyles();
      
      // Start aggressive position monitoring
      this._startPositionMonitoring();
      
      this.installCartInterceptor();
    }

    // Add CSS to force gift to top
    _addOrderStyles() {
      const styleId = 'gift-order-styles';
      if (document.getElementById(styleId)) return;
      
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        /* Force gift items to appear first */
        .cart-item--gift,
        .cart-item[data-gift="true"] {
          order: -1 !important;
        }
        
        /* Ensure cart items container uses flex */
        .drawer__cart-items-wrapper,
        .cart-items,
        .cart-drawer__items,
        #CartDrawer .cart-items,
        .cart-drawer__items-wrapper {
          display: flex !important;
          flex-direction: column !important;
        }
        
        /* Make sure all cart items respect order */
        .cart-item {
          order: 0 !important;
        }
        
        /* Extra force for gift positioning */
        .cart-item--gift + .cart-item,
        .cart-item[data-gift="true"] + .cart-item {
          order: 1 !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Start monitoring and repositioning
    _startPositionMonitoring() {
      // Run every 100ms to ensure gift stays at top
      setInterval(() => {
        this._forceGiftToFirstPosition();
      }, 100);

      // Also use MutationObserver for immediate detection
      this._setupPositionObserver();
    }

    // Force gift to first position using DOM manipulation
    _forceGiftToFirstPosition() {
      // Find all possible cart containers
      const containers = [
        document.querySelector('.drawer__cart-items-wrapper'),
        document.querySelector('.cart-items'),
        document.querySelector('.cart-drawer__items'),
        document.querySelector('#CartDrawer .cart-items'),
        document.querySelector('.cart-drawer .cart-items'),
        document.querySelector('.cart__items'),
        document.querySelector('[data-cart-items]'),
        document.querySelector('.cart-drawer__items-wrapper')
      ];

      containers.forEach(container => {
        if (!container) return;

        // Find all cart items in this container
        const cartItems = container.querySelectorAll('.cart-item');
        if (cartItems.length === 0) return;

        // Separate gift and non-gift items
        let giftItems = [];
        let nonGiftItems = [];

        cartItems.forEach(item => {
          const isGift = item.dataset.gift === 'true' || 
                         item.classList.contains('cart-item--gift') ||
                         item.querySelector('.gift-mandatory-label') ||
                         item.getAttribute('data-gift') === 'true';

          if (isGift) {
            giftItems.push(item);
            // Force order to -1
            item.style.order = '-1';
            item.style.setProperty('order', '-1', 'important');
          } else {
            nonGiftItems.push(item);
            // Ensure non-gift items have order > 0
            const currentOrder = parseInt(item.style.order) || 0;
            if (currentOrder < 1) {
              item.style.order = nonGiftItems.length;
            }
          }
        });

        // If there are gift items, ensure they are first in DOM
        if (giftItems.length > 0) {
          const firstItem = container.querySelector('.cart-item');
          const isGiftFirst = firstItem && (
            firstItem.dataset.gift === 'true' || 
            firstItem.classList.contains('cart-item--gift') ||
            firstItem.getAttribute('data-gift') === 'true'
          );

          // If gift is not first, move it
          if (!isGiftFirst) {
            // Remove all gift items from their current positions
            giftItems.forEach(gift => {
              if (gift.parentNode) {
                gift.remove();
              }
            });

            // Insert gift items at the top (reverse to maintain order)
            giftItems.reverse().forEach(gift => {
              container.insertBefore(gift, container.firstChild);
              // Ensure order is -1 after insertion
              gift.style.order = '-1';
              gift.style.setProperty('order', '-1', 'important');
            });

            console.log('🎁 Gift moved to first position in container');
          }
        }
      });
    }

    // Setup MutationObserver to detect DOM changes
    _setupPositionObserver() {
      const containers = [
        document.querySelector('.drawer__cart-items-wrapper'),
        document.querySelector('.cart-items'),
        document.querySelector('.cart-drawer__items'),
        document.querySelector('#CartDrawer .cart-items'),
        document.querySelector('.cart-drawer .cart-items')
      ];

      const observer = new MutationObserver(() => {
        this._forceGiftToFirstPosition();
      });

      containers.forEach(container => {
        if (container) {
          observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-gift', 'class', 'style']
          });
        }
      });
    }

    getConfig() {
      const settings = window.rewardSettings || {};
      const source = settings.tiers || {};
      return {
        enabled: settings.enabled !== false,
        tiers: [
          {
            tier: 3,
            threshold: Number(source.tier3?.threshold_cents || source.tier3?.threshold || 199900),
            variantId: Number(source.tier3?.variant_id || 42928272048199),
            label: source.tier3?.label || '1 CT Diamond Gift',
          },
          {
            tier: 2,
            threshold: Number(source.tier2?.threshold_cents || source.tier2?.threshold || 149900),
            variantId: Number(source.tier2?.variant_id || 42928272015431),
            label: source.tier2?.label || '0.75 CT Diamond Gift',
          },
          {
            tier: 1,
            threshold: Number(source.tier1?.threshold_cents || source.tier1?.threshold || 99900),
            variantId: Number(source.tier1?.variant_id || 42928271982663),
            label: source.tier1?.label || '0.50 CT Diamond Gift',
          },
        ],
      };
    }

    installCartInterceptor() {
      const manager = this;
      window.fetch = function (...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const responsePromise = nativeFetch(...args);

        if (CART_MUTATION.test(url) && !manager.isInternalRequest(args[1])) {
          responsePromise.then((response) => {
            response.clone().json().then((data) => {
              const cart = manager.isCartPayload(data) ? data : null;
              manager.requestSync(cart);
              // Force position after sync
              setTimeout(() => manager._forceGiftToFirstPosition(), 50);
              setTimeout(() => manager._forceGiftToFirstPosition(), 200);
              setTimeout(() => manager._forceGiftToFirstPosition(), 500);
            }).catch(() => {
              manager.requestSync();
              setTimeout(() => manager._forceGiftToFirstPosition(), 100);
            });
          }).catch(() => {
            manager.requestSync();
            setTimeout(() => manager._forceGiftToFirstPosition(), 100);
          });
        }

        return responsePromise;
      };
    }

    isInternalRequest(options) {
      const headers = options?.headers;
      if (headers instanceof Headers) return headers.get('X-Free-Gift-Sync') === '1';
      return headers?.['X-Free-Gift-Sync'] === '1';
    }

    isCartPayload(data) {
      return Boolean(data && Array.isArray(data.items) && typeof data.total_price === 'number');
    }

    async fetchCart() {
      const response = await nativeFetch(`${window.Shopify?.routes?.root || '/'}cart.js`, {
        headers: { Accept: 'application/json', 'X-Free-Gift-Sync': '1' },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Cart request failed (${response.status})`);
      return response.json();
    }

    isGift(item, config = this.getConfig()) {
      if (!item) return false;
      if (String(item.properties?.[GIFT_PROPERTY]) === 'true') return true;
      if (item.properties?.[TIER_PROPERTY] != null) return true;
      const variantId = Number(item.variant_id || item.id);
      return config.tiers.some((tier) => tier.variantId === variantId);
    }

    subtotalWithoutGifts(cart, config = this.getConfig()) {
      return (cart.items || []).reduce((subtotal, item) => {
        if (this.isGift(item, config)) return subtotal;
        return subtotal + Number(item.final_line_price ?? item.line_price ?? 0);
      }, 0);
    }

    eligibleTier(subtotal, config = this.getConfig()) {
      return config.tiers.find((tier) => subtotal >= tier.threshold) || null;
    }

    hideOutdatedGiftImmediately(cart, config = this.getConfig()) {
      if (!this.isCartPayload(cart)) return;
      const desired = config.enabled ? this.eligibleTier(this.subtotalWithoutGifts(cart, config), config) : null;
      const gifts = (cart.items || []).filter((item) => this.isGift(item, config));
      const giftIsChanging = gifts.some((item) => !desired || Number(item.variant_id || item.id) !== desired.variantId);
      if (!giftIsChanging) return;

      document.querySelectorAll('#CartDrawer .cart-item--gift, #CartDrawer [data-gift="true"]')
        .forEach((row) => { row.hidden = true; });
    }

    requestSync(cart = null) {
      if (cart) this.pendingCart = cart;
      if (this.isProcessing) {
        this.queued = true;
        return this.currentSync;
      }

      const nextCart = this.pendingCart;
      this.pendingCart = null;
      this.currentSync = this.sync(nextCart);
      return this.currentSync;
    }

    async sync(providedCart = null) {
      this.isProcessing = true;
      this.queued = false;

      try {
        const config = this.getConfig();
        let cart = providedCart || await this.fetchCart();
        const subtotal = this.subtotalWithoutGifts(cart, config);
        const desired = config.enabled ? this.eligibleTier(subtotal, config) : null;
        const gifts = (cart.items || []).filter((item) => this.isGift(item, config));
        const correctGifts = desired
          ? gifts.filter((item) => Number(item.variant_id || item.id) === desired.variantId)
          : [];

        this.updateProgress(subtotal, desired, config);

        const updates = {};
        gifts.forEach((item, index) => {
          const keep = desired && Number(item.variant_id || item.id) === desired.variantId && index === gifts.indexOf(correctGifts[0]);
          if (!keep) updates[item.key] = 0;
        });

        if (correctGifts[0] && Number(correctGifts[0].quantity) !== 1) {
          updates[correctGifts[0].key] = 1;
        }

        let finalResponse = null;
        if (Object.keys(updates).length) {
          finalResponse = await this.updateLines(updates);
          cart = this.isCartPayload(finalResponse) ? finalResponse : await this.fetchCart();
        }

        if (desired && !correctGifts.length) {
          finalResponse = await this.addGift(desired);
          cart = await this.fetchCart();
        }

        if (finalResponse?.sections) this.renderSections(finalResponse);
        this.updateProgress(this.subtotalWithoutGifts(cart, config), desired, config);
        document.dispatchEvent(new CustomEvent('free-gift:sync', { detail: { cart, tier: desired?.tier || 0 } }));

        // Force position after sync
        setTimeout(() => this._forceGiftToFirstPosition(), 50);
        setTimeout(() => this._forceGiftToFirstPosition(), 200);
        setTimeout(() => this._forceGiftToFirstPosition(), 500);

      } catch (error) {
        console.error('[Free gift] Unable to synchronize cart:', error);
      } finally {
        this.isProcessing = false;
        if (this.queued || this.pendingCart) {
          const nextCart = this.pendingCart;
          this.pendingCart = null;
          this.requestSync(nextCart);
        }
      }
    }

    async updateLines(updates) {
      const response = await nativeFetch(`${window.Shopify?.routes?.root || '/'}cart/update.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Free-Gift-Sync': '1' },
        body: JSON.stringify({
          updates,
          sections: ['cart-drawer', 'cart-icon-bubble'],
          sections_url: window.location.pathname,
        }),
      });
      if (!response.ok) throw new Error(`Gift removal failed (${response.status})`);
      return response.json();
    }

    async addGift(tier) {
      const response = await nativeFetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Free-Gift-Sync': '1' },
        body: JSON.stringify({
          items: [{
            id: tier.variantId,
            quantity: 1,
            properties: { [GIFT_PROPERTY]: 'true', [TIER_PROPERTY]: String(tier.tier) },
          }],
          sections: ['cart-drawer', 'cart-icon-bubble'],
          sections_url: window.location.pathname,
        }),
      });
      if (!response.ok) throw new Error(`Gift addition failed (${response.status})`);
      return response.json();
    }

    renderSections(state) {
      if (!state.sections?.['cart-drawer'] && !state.sections?.['cart-icon-bubble']) return;
      const drawer = document.querySelector('cart-drawer');
      if (drawer?.renderContents && state.sections?.['cart-drawer']) {
        drawer.renderContents({ id: null, sections: state.sections });
        return;
      }

      const parser = new DOMParser();
      const drawerHtml = state.sections?.['cart-drawer'];
      if (drawerHtml) {
        const source = parser.parseFromString(drawerHtml, 'text/html').querySelector('#CartDrawer');
        const target = document.querySelector('#CartDrawer');
        if (source && target) target.innerHTML = source.innerHTML;
      }
    }

    updateProgress(subtotal, desired, config = this.getConfig()) {

      const tier1 = config.tiers.find((tier) => tier.tier === 1)?.threshold || 99900;
      const tier2 = config.tiers.find((tier) => tier.tier === 2)?.threshold || 149900;
      const tier3 = config.tiers.find((tier) => tier.tier === 3)?.threshold || 199900;

      let percent = 0;

      if (subtotal < tier1) {
        percent = (subtotal / tier1) * 19;
      } else if (subtotal < tier2) {
        percent = 19 + ((subtotal - tier1) / (tier2 - tier1)) * 31;
      } else if (subtotal < tier3) {
        percent = 50 + ((subtotal - tier2) / (tier3 - tier2)) * 33.33;
      } else {
        percent = 100;
      }

      document.querySelectorAll('.cart-drawer__rewards .progress-bar__fill').forEach((fill) => {
        fill.style.width = `${percent}%`;
      });

      document.querySelectorAll('.cart-drawer__rewards .progress-dot').forEach((dot, index) => {
        dot.classList.toggle('active', (desired?.tier || 0) >= index + 1);
      });

      const rewards = document.querySelector('.rewards-progress');
      if (rewards) {
        rewards.dataset.currentTier = String(desired?.tier || 0);
        rewards.dataset.cartSubtotal = String(subtotal);
      }
    }

    // Compatibility aliases used by the theme's existing cart components.
    forceReAddGift() { 
      this.requestSync();
      setTimeout(() => this._forceGiftToFirstPosition(), 50);
      return this.currentSync;
    }
    
    forceCheckGift() { 
      this.requestSync();
      setTimeout(() => this._forceGiftToFirstPosition(), 50);
      return this.currentSync;
    }
    
    handleCartUpdateFromDOM() { 
      this.requestSync();
      setTimeout(() => this._forceGiftToFirstPosition(), 50);
      return this.currentSync;
    }
    
    handleCartUpdate(cart) {
      if (this.isCartPayload(cart)) this.hideOutdatedGiftImmediately(cart);
      this.requestSync(this.isCartPayload(cart) ? cart : null);
      setTimeout(() => this._forceGiftToFirstPosition(), 50);
      return this.currentSync;
    }
    
    instantDomSync(cart) {
      if (!this.isCartPayload(cart)) return;
      const config = this.getConfig();
      const subtotal = this.subtotalWithoutGifts(cart, config);
      this.updateProgress(subtotal, this.eligibleTier(subtotal, config), config);
      this.requestSync(cart);
      setTimeout(() => this._forceGiftToFirstPosition(), 50);
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;
      
      // Force initial position
      setTimeout(() => this._forceGiftToFirstPosition(), 100);
      setTimeout(() => this._forceGiftToFirstPosition(), 500);
      
      this.requestSync();
      
      document.addEventListener('cart:update', () => {
        this.requestSync();
        setTimeout(() => this._forceGiftToFirstPosition(), 50);
      });
      
      document.addEventListener('cart:refresh', () => {
        this.requestSync();
        setTimeout(() => this._forceGiftToFirstPosition(), 50);
      });
      
      document.addEventListener('product:added', () => {
        this.requestSync();
        setTimeout(() => this._forceGiftToFirstPosition(), 100);
        setTimeout(() => this._forceGiftToFirstPosition(), 300);
      });
      
      document.addEventListener('ajaxCart:updated', () => {
        this.requestSync();
        setTimeout(() => this._forceGiftToFirstPosition(), 50);
        setTimeout(() => this._forceGiftToFirstPosition(), 200);
      });
      
      document.addEventListener('localization:changed', () => window.location.reload());
      document.addEventListener('shopify:market:changed', () => window.location.reload());
      
      // Additional event listener for any cart changes
      document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-cart-remove], .cart-remove-button, [data-quantity]');
        if (target) {
          setTimeout(() => this._forceGiftToFirstPosition(), 200);
          setTimeout(() => this._forceGiftToFirstPosition(), 500);
        }
      });
    }
  }

  window.freeGiftManager = new FreeGiftManager();
  const init = () => window.freeGiftManager.init();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

})();