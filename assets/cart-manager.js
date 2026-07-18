// ============================================
// PART 1: Cart Rate Limiter
// ============================================
class CartRateLimiter {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.delay = 500;
    this.maxRetries = 3;
  }

  async addToCart(formData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ formData, resolve, reject, retries: 0 });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const item = this.queue.shift();
    try {
      const result = await this.executeAddToCart(item.formData);
      item.resolve(result);
    } catch (error) {
      if (error.message.includes('429') && item.retries < this.maxRetries) {
        item.retries++;
        const delay = this.delay * Math.pow(2, item.retries);
        console.log(`Retrying add to cart (attempt ${item.retries}) in ${delay}ms`);
        setTimeout(() => {
          this.queue.unshift(item);
          this.processing = false;
          this.processQueue();
        }, delay);
        return;
      }
      item.reject(error);
    }

    this.processing = false;
    setTimeout(() => this.processQueue(), this.delay);
  }

  async executeAddToCart(formData) {
    const response = await fetch('/cart/add.js', {
      method: 'POST',
      body: formData
    });

    if (response.status === 429) {
      throw new Error('429 Too Many Requests');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }
}

// ============================================
// PART 2: Free Gift Manager
// ============================================
class FreeGiftManager {
  constructor() {
    this.tiers = {
      tier1: { threshold: 999, variantId: '42928271982663', label: '0.50 CT Diamond' },
      tier2: { threshold: 1499, variantId: '42928272015431', label: '0.75 CT Diamond' },
      tier3: { threshold: 1999, variantId: '42928272048199', label: '1 CT Diamond' }
    };
    
    this.giftInCart = false;
    this.currentTier = 0;
    this.isProcessing = false;
    
    this.updateCurrencyRates();
    this.setupEventListeners();
  }

  updateCurrencyRates() {
    const currency = this.getCurrentCurrency();
    const rates = {
      'USD': 1,
      'INR': 83,
      'EUR': 0.92,
      'GBP': 0.79
    };
    
    const rate = rates[currency] || 1;
    
    Object.keys(this.tiers).forEach(key => {
      this.tiers[key].threshold = Math.round(this.tiers[key].threshold * rate);
    });
  }

  getCurrentCurrency() {
    return document.querySelector('[data-currency]')?.dataset.currency || 'USD';
  }

  setupEventListeners() {
    document.addEventListener('cart-updated', (e) => {
      this.handleCartUpdate(e.detail?.cart);
    });
    
    document.addEventListener('cart-update', (e) => {
      setTimeout(() => {
        this.handleCartUpdateFromDOM();
      }, 500);
    });
    
    setTimeout(() => {
      this.handleCartUpdateFromDOM();
    }, 1000);
  }

  async handleCartUpdateFromDOM() {
    if (this.isProcessing) return;
    
    try {
      const response = await fetch('/cart.js');
      const cart = await response.json();
      this.handleCartUpdate(cart);
    } catch (error) {
      console.error('Error fetching cart:', error);
    }
  }

  async handleCartUpdate(cart) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      const cartData = cart || await this.getCartData();
      if (!cartData) return;
      
      let total = 0;
      let giftItems = [];
      let nonGiftItems = [];
      
      cartData.items.forEach(item => {
        const isGift = this.isGiftItem(item);
        if (isGift) {
          giftItems.push(item);
        } else {
          nonGiftItems.push(item);
          total += item.final_price / 100;
        }
      });
      
      this.giftInCart = giftItems.length > 0;
      const eligibleTier = this.getEligibleTier(total);
      this.currentTier = eligibleTier;
      
      if (eligibleTier > 0 && !this.giftInCart) {
        await this.addGift(eligibleTier);
      } else if (eligibleTier === 0 && this.giftInCart) {
        await this.removeGifts(giftItems);
      } else if (this.giftInCart) {
        await this.verifyGiftMatchesTier(giftItems, eligibleTier);
      }
      
    } catch (error) {
      console.error('Error handling cart update:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // ... rest of FreeGiftManager methods ...
}

// ============================================
// PART 3: Product Form
// ============================================
if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      // ... product form code ...
    }
  );
}

// ============================================
// PART 4: Initialize Everything
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  window.cartRateLimiter = new CartRateLimiter();
  window.freeGiftManager = new FreeGiftManager();
});