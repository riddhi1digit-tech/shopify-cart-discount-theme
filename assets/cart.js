class CartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();
      const cartItems = this.closest('cart-items') || this.closest('cart-drawer-items');
      if (cartItems) {
        cartItems.updateQuantity(this.dataset.index, 0, event);
        return;
      }

      fetch(`${routes.cart_change_url}`, {
        ...fetchConfig(),
        body: JSON.stringify({ line: Number(this.dataset.index), quantity: 0 }),
      })
        .then((response) => response.json())
        .then(() => {
          // ⚡ INSTANT: Trigger gift check immediately without delay
          if (window.freeGiftManager) {
            // Use microtask for instant execution
            Promise.resolve().then(() => {
              window.freeGiftManager.forceReAddGift();
            });
          }
        })
        .catch((error) => console.error('Unable to remove cart item:', error));
    });
  }
}

if (!customElements.get('cart-remove-button')) {
  customElements.define('cart-remove-button', CartRemoveButton);
}

class CartItems extends window.StandardEvents.createViewEventElement(HTMLElement) {
  constructor() {
    super();
    this.lineItemStatusElement =
      document.getElementById('shopping-cart-line-item-status') || document.getElementById('CartDrawer-LineItemStatus');

    // Send quantity changes immediately so reward eligibility is reconciled
    // from Shopify's returned cart without an artificial theme delay.
    this.addEventListener('change', this.onChange.bind(this));
  }

  cartUpdateUnsubscriber = undefined;

  static pendingCartDataPromise = null;

  connectedCallback() {
    super.connectedCallback();

    this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
      if (event.source === 'cart-items') return;
      return this.onCartUpdate();
    });
  }

  static fetchCartData() {
    if (!CartItems.pendingCartDataPromise) {
      const pendingCartDataPromise = fetch(`${routes.cart_url}.json`)
        .then((response) => response.json())
        .catch(() => null)
        .finally(() => {
          if (CartItems.pendingCartDataPromise === pendingCartDataPromise) CartItems.pendingCartDataPromise = null;
        });

      CartItems.pendingCartDataPromise = pendingCartDataPromise;
    }
    return CartItems.pendingCartDataPromise;
  }

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  resetQuantityInput(id) {
    const input = this.querySelector(`#Quantity-${id}`);
    if (input) {
      input.value = input.getAttribute('value');
    }
    this.isEnterPressed = false;
  }

  setValidity(event, index, message) {
    event.target.setCustomValidity(message);
    event.target.reportValidity();
    this.resetQuantityInput(index);
    event.target.select();
  }

  validateQuantity(event) {
    const inputValue = parseInt(event.target.value);
    const index = event.target.dataset.index;
    let message = '';

    if (inputValue < event.target.dataset.min) {
      message = window.quickOrderListStrings.min_error.replace('[min]', event.target.dataset.min);
    } else if (inputValue > parseInt(event.target.max)) {
      message = window.quickOrderListStrings.max_error.replace('[max]', event.target.max);
    } else if (inputValue % parseInt(event.target.step) !== 0) {
      message = window.quickOrderListStrings.step_error.replace('[step]', event.target.step);
    }

    if (message) {
      this.setValidity(event, index, message);
    } else {
      event.target.setCustomValidity('');
      event.target.reportValidity();
      this.updateQuantity(
        index,
        inputValue,
        event,
        document.activeElement.getAttribute('name'),
        event.target.dataset.quantityVariantId
      );
    }
  }

  onChange(event) {
    this.validateQuantity(event);
  }

  onCartUpdate() {
    if (this.tagName === 'CART-DRAWER-ITEMS') {
      return fetch(`${routes.cart_url}?section_id=cart-drawer`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const selectors = ['cart-drawer-items', '.cart-drawer__footer'];
          for (const selector of selectors) {
            const targetElement = document.querySelector(selector);
            const sourceElement = html.querySelector(selector);
            if (targetElement && sourceElement) {
              targetElement.replaceWith(sourceElement);
            }
          }
          // ⚡ INSTANT: Trigger gift check immediately after DOM update
          this.triggerGiftCheck();
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      return fetch(`${routes.cart_url}?section_id=main-cart-items`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const sourceQty = html.querySelector('cart-items');
          this.innerHTML = sourceQty.innerHTML;
          // ⚡ INSTANT: Trigger gift check immediately after DOM update
          this.triggerGiftCheck();
        })
        .catch((e) => {
          console.error(e);
        });
    }
  }

  getSectionsToRender() {
    return [
      {
        id: 'main-cart-items',
        section: document.getElementById('main-cart-items')?.dataset?.id || 'main-cart-items',
        selector: '.js-contents',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
      {
        id: 'cart-live-region-text',
        section: 'cart-live-region-text',
        selector: '.shopify-section',
      },
      {
        id: 'main-cart-footer',
        section: document.getElementById('main-cart-footer')?.dataset?.id || 'main-cart-footer',
        selector: '.js-contents',
      },
    ];
  }

  // 🔥 FIXED: Only trigger once and instantly
  triggerGiftCheck() {
    if (window.freeGiftManager && !window.freeGiftManager.isProcessing) {
      // Use microtask for instant execution
      Promise.resolve().then(() => {
        window.freeGiftManager.forceReAddGift();
      });
    }
  }

  // 🔥 NEW: Instant gift check without any delay
  instantGiftCheck() {
    if (window.freeGiftManager) {
      Promise.resolve().then(() => {
        window.freeGiftManager.forceReAddGift();
      });
    }
  }

  updateQuantity(line, quantity, event, name, variantId) {
    const quantityInput = this.querySelector(`#Quantity-${line}`) || this.querySelector(`#Drawer-quantity-${line}`);
    const isGift = quantityInput?.dataset?.isGift === 'true';
    
    // Block manual modification of gift items
    if (isGift && quantity !== 0) {
      this.dispatchCartErrorEvent('Gift items cannot be modified manually', 'GIFT_MODIFICATION_ERROR');
      return;
    }

    const eventTarget = event?.currentTarget instanceof CartRemoveButton ? 'clear' : 'change';
    const cartPerformanceUpdateMarker = CartPerformance.createStartingMarker(`${eventTarget}:user-action`);

    this.enableLoading(line);

    const action = quantity === 0 ? 'remove' : 'update';
    const lineVariantId = variantId || quantityInput?.dataset?.quantityVariantId;
    const lineKey = quantityInput?.dataset?.quantityLineKey;
    const linesUpdateDeferred = this.createCartLinesUpdateEvent(action, lineVariantId, quantity, lineKey);

    const sectionsToRender = this.getSectionsToRender();

    const body = JSON.stringify({
      line,
      quantity,
      sections: sectionsToRender.map((section) => section.section),
      sections_url: window.location.pathname,
    });

    fetch(`${routes.cart_change_url}`, { ...fetchConfig(), ...{ body } })
      .then((response) => {
        return response.text();
      })
      .then((state) => {
        const parsedState = JSON.parse(state);

        if (parsedState.errors) {
          this.dispatchCartErrorEvent(parsedState.errors, 'INVALID');
          linesUpdateDeferred?.reject(new Error(parsedState.errors));
        } else {
          this.resolveCartLinesUpdate(linesUpdateDeferred, parsedState);
        }

        CartPerformance.measure(`${eventTarget}:paint-updated-sections`, () => {
          const quantityElement =
            document.getElementById(`Quantity-${line}`) || document.getElementById(`Drawer-quantity-${line}`);
          const items = document.querySelectorAll('.cart-item');

          if (parsedState.errors) {
            if (quantityElement) {
              quantityElement.value = quantityElement.getAttribute('value');
            }
            this.updateLiveRegions(line, parsedState.errors);
            return;
          }

          this.classList.toggle('is-empty', parsedState.item_count === 0);
          const cartDrawerWrapper = document.querySelector('cart-drawer');
          const cartFooter = document.getElementById('main-cart-footer');

          if (cartFooter) cartFooter.classList.toggle('is-empty', parsedState.item_count === 0);
          if (cartDrawerWrapper) cartDrawerWrapper.classList.toggle('is-empty', parsedState.item_count === 0);

          sectionsToRender.forEach((section) => {
            const elementToReplace =
              document.getElementById(section.id)?.querySelector(section.selector) ||
              document.getElementById(section.id);
            if (elementToReplace) {
              elementToReplace.innerHTML = this.getSectionInnerHTML(
                parsedState.sections[section.section],
                section.selector
              );
            }
          });
          
          const updatedValue = parsedState.items[line - 1] ? parsedState.items[line - 1].quantity : undefined;
          let message = '';
          if (items.length === parsedState.items.length && updatedValue !== parseInt(quantityElement?.value)) {
            if (typeof updatedValue === 'undefined') {
              message = window.cartStrings.error;
            } else {
              message = window.cartStrings.quantityError.replace('[quantity]', updatedValue);
            }
          }
          this.updateLiveRegions(line, message);

          const lineItem =
            document.getElementById(`CartItem-${line}`) || document.getElementById(`CartDrawer-Item-${line}`);
          if (lineItem && lineItem.querySelector(`[name="${name}"]`)) {
            cartDrawerWrapper
              ? trapFocus(cartDrawerWrapper, lineItem.querySelector(`[name="${name}"]`))
              : lineItem.querySelector(`[name="${name}"]`).focus();
          } else if (parsedState.item_count === 0 && cartDrawerWrapper?.querySelector('.drawer__inner-empty')) {
            trapFocus(cartDrawerWrapper.querySelector('-empty'), cartDrawerWrapper.querySelector('a'));
          } else if (document.querySelector('.cart-item') && cartDrawerWrapper) {
            trapFocus(cartDrawerWrapper, document.querySelector('.cart-item__name'));
          }
        });

        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: parsedState, variantId: variantId });
        
        // ⚡ INSTANT: Trigger gift check immediately after cart update
        // Use the elapsed time to determine if we should check instantly or with minimal delay
        // The fetch interceptor already starts reconciliation from parsedState.
        // This direct no-delay call also supports custom cart implementations.
        if (window.freeGiftManager) window.freeGiftManager.handleCartUpdate(parsedState);
      })
      .catch((e) => {
        this.querySelectorAll('.loading__spinner').forEach((overlay) => overlay.classList.add('hidden'));
        const errors = document.getElementById('cart-errors') || document.getElementById('CartDrawer-CartErrors');
        if (errors) errors.textContent = window.cartStrings.error;
        this.dispatchCartErrorEvent(window.cartStrings.error, 'SERVICE_UNAVAILABLE');
        linesUpdateDeferred?.reject(e);
      })
      .finally(() => {
        this.disableLoading(line);
        CartPerformance.measureFromMarker(`${eventTarget}:user-action`, cartPerformanceUpdateMarker);
      });
  }

  createCartLinesUpdateEvent(action, variantId, quantity, lineKey) {
    const { CartLinesUpdateEvent } = window.StandardEvents || {};
    if (!CartLinesUpdateEvent || !variantId) return null;
    if (!lineKey) return null;

    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action,
        context: 'cart',
        lines: [{ id: lineKey, quantity }],
        promise: deferred.promise,
      })
    );
    return deferred;
  }

  resolveCartLinesUpdate(deferred, parsedState) {
    if (!deferred) return;
    const { CartLinesUpdateEvent } = window.StandardEvents || {};
    if (!CartLinesUpdateEvent) return;

    deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(parsedState) });
  }

  dispatchCartErrorEvent(message, code) {
    const { CartErrorEvent } = window.StandardEvents || {};
    if (!CartErrorEvent) return;
    this.dispatchEvent(new CartErrorEvent({ error: message, code }));
  }

  updateLiveRegions(line, message) {
    const lineItemError =
      document.getElementById(`Line-item-error-${line}`) || document.getElementById(`CartDrawer-LineItemError-${line}`);
    if (lineItemError) lineItemError.querySelector('.cart-item__error-text').textContent = message;

    this.lineItemStatusElement.setAttribute('aria-hidden', true);

    const cartStatus =
      document.getElementById('cart-live-region-text') || document.getElementById('CartDrawer-LiveRegionText');
    if (cartStatus) {
      cartStatus.setAttribute('aria-hidden', false);
      setTimeout(() => {
        cartStatus.setAttribute('aria-hidden', true);
      }, 1000);
    }
  }

  getSectionInnerHTML(html, selector) {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector)?.innerHTML || '';
  }

  enableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    if (mainCartItems) mainCartItems.classList.add('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    [...cartItemElements, ...cartDrawerItemElements].forEach((overlay) => overlay.classList.remove('hidden'));

    if (document.activeElement) document.activeElement.blur();
    this.lineItemStatusElement.setAttribute('aria-hidden', false);
  }

  disableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    if (mainCartItems) mainCartItems.classList.remove('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    cartItemElements.forEach((overlay) => overlay.classList.add('hidden'));
    cartDrawerItemElements.forEach((overlay) => overlay.classList.add('hidden'));
  }
}

if (!customElements.get('cart-items')) {
  customElements.define('cart-items', CartItems);
}

if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          'input',
          debounce((event) => {
            const newNote = event.target.value;
            const noteDeferred = this.dispatchNoteUpdateEvent(newNote);

            const body = JSON.stringify({ note: newNote });
            fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } })
              .then((r) => r.json())
              .then((cart) => {
                if (!cart || cart.errors) {
                  throw Object.assign(new Error(cart?.errors), { code: 'INVALID' });
                }

                if (noteDeferred) {
                  const { CartNoteUpdateEvent } = window.StandardEvents || {};
                  if (CartNoteUpdateEvent) {
                    noteDeferred.resolve({ cart: CartNoteUpdateEvent.createCartFromAjaxResponse(cart) });
                  }
                }
                CartPerformance.measureFromEvent('note-update:user-action', event);
              })
              .catch((e) => {
                noteDeferred?.reject(e);
                const { CartErrorEvent } = window.StandardEvents || {};
                if (CartErrorEvent) {
                  this.dispatchEvent(
                    new CartErrorEvent({
                      error: e.message || 'Note update failed',
                      code: e.code || 'SERVICE_UNAVAILABLE',
                    })
                  );
                }
              });
          }, ON_CHANGE_DEBOUNCE_TIMER)
        );
      }

      dispatchNoteUpdateEvent(newNote) {
        const { CartNoteUpdateEvent } = window.StandardEvents || {};
        if (!CartNoteUpdateEvent) return null;

        const context = this.closest('dialog') || this.closest('cart-drawer') ? 'dialog' : 'cart';
        const deferred = CartNoteUpdateEvent.createPromise();

        this.dispatchEvent(
          new CartNoteUpdateEvent({
            context,
            note: newNote,
            promise: deferred.promise,
          })
        );

        return deferred;
      }
    }
  );
}
  document.addEventListener('DOMContentLoaded', function() {
    'use strict';

    // ============================================
    // TIER DISCOUNT BANNER - DYNAMIC UPDATES
    // ============================================
    
    function updateTierBanner() {
      var banner = document.getElementById("tier-discount-banner");
      var message = document.getElementById("tier-discount-message");
      
      if (!banner || !message) {
        console.warn('Tier banner elements not found');
        return;
      }
      
      try {
        var eligibleCount = 0;
        var highestDiscount = 0;
        var subtotal = 0;
        var totalItems = 0;
        
        // Get all cart items
        var cartItems = document.querySelectorAll('.cart-item');
        
        cartItems.forEach(function(item) {
          // Skip gift items
          var isGift = item.classList.contains('cart-item--gift') || 
                       item.getAttribute('data-gift') === 'true';
          if (isGift) return;
          
          totalItems++;
          
          // Get quantity
          var qtyInput = item.querySelector('input.quantity__input');
          var quantity = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
          
          // Get price
          var priceEl = item.querySelector('.cart-item__price, .price');
          if (priceEl) {
            var priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
            subtotal += (parseFloat(priceText) || 0) * quantity;
          }
          
          // Detect discount percentage from item text
          var itemText = item.textContent || '';
          var match = itemText.match(/(\d+)%\s*OFF/i);
          if (match) {
            var percent = parseInt(match[1]);
            if ([15, 20, 25].includes(percent)) {
              highestDiscount = Math.max(highestDiscount, percent);
              eligibleCount += quantity;
            }
          }
          
          // Check for discount badge
          if (highestDiscount === 0) {
            var discountBadge = item.querySelector('.badge--sale, .discount-badge, .sale-badge');
            if (discountBadge) {
              var badgeText = discountBadge.textContent || '';
              var badgeMatch = badgeText.match(/(\d+)%/);
              if (badgeMatch) {
                var percent = parseInt(badgeMatch[1]);
                if ([15, 20, 25].includes(percent)) {
                  highestDiscount = Math.max(highestDiscount, percent);
                  eligibleCount += quantity;
                }
              }
            }
          }
        });
        
        // If no discount found, check cart footer
        if (highestDiscount === 0) {
          var cartFooter = document.querySelector('.cart-drawer__footer, .cart__footer');
          if (cartFooter) {
            var footerText = cartFooter.textContent || '';
            var match = footerText.match(/(\d+)%\s*OFF/i);
            if (match) {
              var percent = parseInt(match[1]);
              if ([15, 20, 25].includes(percent)) {
                highestDiscount = percent;
                // Count eligible products
                var allItems = document.querySelectorAll('.cart-item:not(.cart-item--gift)');
                allItems.forEach(function(item) {
                  var qtyInput = item.querySelector('input.quantity__input');
                  var qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
                  eligibleCount += qty;
                });
              }
            }
          }
        }
        
        // ============================================
        // DYNAMIC MESSAGE LOGIC
        // ============================================
        var nonGiftItems = document.querySelectorAll('.cart-item:not(.cart-item--gift)');
        
        // If no discount found or no items, hide banner
        if (highestDiscount === 0 || nonGiftItems.length === 0) {
          banner.style.display = "none";
          banner.style.visibility = "hidden";
          message.innerHTML = "";
          return;
        }
        
        // Show banner
        banner.style.display = "flex";
        banner.style.visibility = "visible";
        banner.className = banner.className.replace('tier-unlocked', '');
        
        var html = '';
        var isMaxUnlocked = false;
        
        // Count eligible products (items with discounts)
        var eligibleProducts = 0;
        document.querySelectorAll('.cart-item:not(.cart-item--gift)').forEach(function(item) {
          var itemText = item.textContent || '';
          var hasDiscount = itemText.match(/(15|20|25)%\s*OFF/i);
          if (hasDiscount) {
            var qtyInput = item.querySelector('input.quantity__input');
            var qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;
            eligibleProducts += qty;
          }
        });
        
        console.log('📊 Tier Banner:', {
          eligibleProducts: eligibleProducts,
          highestDiscount: highestDiscount,
          subtotal: subtotal,
          totalItems: totalItems
        });
        
        // ============================================
        // GENERATE DYNAMIC MESSAGE
        // ============================================
        
        if (highestDiscount === 25 || eligibleProducts >= 3) {
          // MAXIMUM TIER - 25% OFF
          isMaxUnlocked = true;
          banner.classList.add('tier-unlocked');
          html = `
            <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">🏆</span>
                <div>
                  <span class="tier-title" style="font-size:18px;font-weight:700;color:#1a1a1a;">
                    🎉 Congratulations!
                  </span>
                </div>
                <span class="tier-badge" style="background:#ffc107;color:#1a1a1a;">MAXIMUM</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
                <span style="font-size:20px;font-weight:700;color:#28a745;">25% OFF</span>
                <span style="font-size:14px;color:#555;">applied to <strong>${eligibleProducts}</strong> eligible product${eligibleProducts > 1 ? 's' : ''}</span>
              </div>
              <div style="font-size:14px;color:#666;margin-top:2px;">
                🎊 You've unlocked the maximum discount!
              </div>
            </div>
          `;
          
        } else if (highestDiscount === 20 || eligibleProducts >= 2) {
          // TIER 2 - 20% OFF
          html = `
            <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:24px;">🎉</span>
                <div>
                  <span class="tier-title" style="font-size:18px;font-weight:700;color:#1a1a1a;">
                    <span class="highlight" style="color:#28a745;">20% OFF</span> Applied
                  </span>
                </div>
                <span class="tier-badge" style="background:#28a745;color:white;">2nd Tier</span>
              </div>
              <div style="font-size:15px;color:#333;margin-top:2px;">
                <strong>${eligibleProducts}</strong> eligible product${eligibleProducts > 1 ? 's' : ''} in cart
              </div>
              <div class="tier-next" style="font-size:14px;color:#555;margin-top:2px;">
                🚀 Add <strong>1</strong> more eligible product to unlock <strong style="color:#28a745;">25% OFF</strong>
              </div>
            </div>
          `;
          
        } else if (highestDiscount === 15 || eligibleProducts >= 1) {
          // TIER 1 - 15% OFF
          html = `
            <div style="display:flex;flex-direction:column;gap:4px;width:100%;">
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:24px;">🎉</span>
                <div>
                  <span class="tier-title" style="font-size:18px;font-weight:700;color:#1a1a1a;">
                    <span class="highlight" style="color:#28a745;">15% OFF</span> Applied
                  </span>
                </div>
                <span class="tier-badge" style="background:#28a745;color:white;">1st Tier</span>
              </div>
              <div style="font-size:15px;color:#333;margin-top:2px;">
                <strong>${eligibleProducts}</strong> eligible product${eligibleProducts > 1 ? 's' : ''} in cart
              </div>
              <div class="tier-next" style="font-size:14px;color:#555;margin-top:2px;">
                🚀 Add <strong>1</strong> more eligible product to unlock <strong style="color:#28a745;">20% OFF</strong>
              </div>
            </div>
          `;
        }
        
        message.innerHTML = html;
        console.log('✅ Tier banner updated dynamically');
        
      } catch (error) {
        console.error('Tier banner error:', error);
      }
    }

    // ============================================
    // FORCE UPDATE
    // ============================================
    function forceUpdateTierBanner() {
      requestAnimationFrame(function() {
        updateTierBanner();
      });
    }

    // ============================================
    // INITIALIZE
    // ============================================
    function initTierBanner() {
      console.log('🔵 Initializing Tier Discount Banner...');
      
      // Initial update
      setTimeout(forceUpdateTierBanner, 500);
      setTimeout(forceUpdateTierBanner, 1000);

      // Listen for cart updates
      document.addEventListener('cart:updated', function() {
        console.log('📦 Cart updated, updating tier banner...');
        setTimeout(forceUpdateTierBanner, 100);
        setTimeout(forceUpdateTierBanner, 300);
        setTimeout(forceUpdateTierBanner, 600);
      });

      // Listen for quantity changes
      document.addEventListener('change', function(e) {
        if (e.target.classList.contains('quantity__input')) {
          console.log('📦 Quantity changed, updating tier banner...');
          setTimeout(forceUpdateTierBanner, 200);
          setTimeout(forceUpdateTierBanner, 500);
        }
      });

      // Listen for cart drawer open
      document.addEventListener('click', function(e) {
        var trigger = e.target.closest('[aria-controls="CartDrawer"]') || 
                      e.target.closest('#cart-icon-bubble');
        if (trigger) {
          console.log('📦 Cart drawer opened, updating tier banner...');
          setTimeout(forceUpdateTierBanner, 300);
          setTimeout(forceUpdateTierBanner, 700);
        }
      });

      // MutationObserver for DOM changes
      var observer = new MutationObserver(function() {
        var banner = document.getElementById("tier-discount-banner");
        if (banner && banner.style.display !== 'flex') {
          setTimeout(forceUpdateTierBanner, 100);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // ============================================
    // START
    // ============================================
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTierBanner);
    } else {
      initTierBanner();
    }

  });

