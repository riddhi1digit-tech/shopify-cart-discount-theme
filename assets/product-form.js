if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        if (!this.form) return;
        
        this.variantIdInput = this.form.querySelector('[name="id"]');
        if (this.variantIdInput) {
          this.variantIdInput.disabled = false;
        }
        
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton ? this.submitButton.querySelector('span') : null;

        if (document.querySelector('cart-drawer')) {
          this.submitButton?.setAttribute('aria-haspopup', 'dialog');
        }

        this.hideErrors = this.dataset.hideErrors === 'true';
        
        // Initialize error message wrapper
        this.errorMessageWrapper = this.querySelector('.product-form__error-message-wrapper');
        this.errorMessage = this.errorMessageWrapper?.querySelector('.product-form__error-message');
      }

      async onSubmitHandler(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        
        if (!this.submitButton) return;
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        const spinner = this.querySelector('.loading__spinner');
        if (spinner) spinner.classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        this.syncCustomProperties();

        const formData = new FormData(this.form);
        this.appendSelectedProperty(formData, 'Metal Type', '.metal-options .metal-image.is-selected');
        this.appendSelectedProperty(formData, 'Diamond Type', '.diamond-options .diamond-box.is-selected');
        this.appendSelectedProperty(formData, 'Diamond Clarity', '.clarity-options .clarity-box.is-selected');
        
        if (this.cart) {
          const sections = this.cart.getSectionsToRender?.() || [];
          formData.append('sections', sections.map((section) => section.id));
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        const variantId = formData.get('id');
        const quantity = parseInt(formData.get('quantity')) || 1;

        try {
          const response = await this.addToCartWithRetry(config);
          
          if (response.status) {
            // Handle error response
            this.handleErrorMessage(response.description || response.message || 'Error adding to cart');
            this.dispatchCartErrorEvent(response.description || response.message, 'INVALID');
            
            const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
            if (soldOutMessage) {
              this.submitButton.setAttribute('aria-disabled', true);
              if (this.submitButtonText) this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
            }
            this.error = true;
            return;
          }

          // Success - handle cart update
          if (!this.cart) {
            window.location = window.routes.cart_url;
            return;
          }

          // Publish cart update event
          if (!this.error) {
            const event = new CustomEvent('cart-update', {
              detail: {
                source: 'product-form',
                productVariantId: variantId,
                cartData: response
              }
            });
            document.dispatchEvent(event);
          }
          
          this.error = false;
          
          // Handle quick add modal
          const quickAddModal = this.closest('quick-add-modal');
          if (quickAddModal) {
            document.body.addEventListener(
              'modalClosed',
              () => {
                setTimeout(() => {
                  this.cart.renderContents(response);
                }, 100);
              },
              { once: true }
            );
            quickAddModal.hide(true);
          } else {
            this.cart.renderContents(response);
          }

          // Trigger free gift check after cart update
          setTimeout(() => {
            if (window.freeGiftManager) {
              window.freeGiftManager.handleCartUpdateFromDOM();
            }
            // Dispatch custom event for gift check
            document.dispatchEvent(new CustomEvent('cart-updated', {
              detail: { cart: response }
            }));
          }, 300);

        } catch (error) {
          console.error('Add to cart error:', error);
          this.handleErrorMessage(error.message || 'Error adding to cart');
          this.dispatchCartErrorEvent(error.message || 'Network error', 'SERVICE_UNAVAILABLE');
        } finally {
          // Reset button state
          this.submitButton.classList.remove('loading');
          if (this.cart && this.cart.classList.contains('is-empty')) {
            this.cart.classList.remove('is-empty');
          }
          if (!this.error) {
            this.submitButton.removeAttribute('aria-disabled');
          }
          if (spinner) spinner.classList.add('hidden');
        }
      }

      // Add retry logic for rate limiting
      async addToCartWithRetry(config, maxRetries = 3, delay = 1000) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const response = await fetch(`${window.routes.cart_add_url}`, config);
            
            // Check if response is JSON
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await response.json();
              return data;
            }
            
            // If not JSON, it might be HTML (error page)
            if (response.status === 429) {
              // Too Many Requests - wait and retry
              const waitTime = delay * attempt;
              console.log(`Rate limited, retrying in ${waitTime}ms... (Attempt ${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
            
            // Try to parse as text
            const text = await response.text();
            try {
              return JSON.parse(text);
            } catch (e) {
              // If it's HTML, throw error with status
              throw new Error(`Server returned HTML (status: ${response.status}). Please try again.`);
            }
            
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, delay * attempt));
              continue;
            }
            throw error;
          }
        }
        
        throw lastError || new Error('Failed to add to cart after multiple attempts');
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;
        if (!this.errorMessageWrapper) return;

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage && this.errorMessage) {
          this.errorMessage.textContent = typeof errorMessage === 'string' ? errorMessage : 'Error adding to cart';
        }
      }

      // Required by Dawn's product-info component during every variant change.
      // Keeping this API on the customized product form allows price,
      // availability, variant ID, and Add to Cart state to update together.
      toggleSubmitButton(disable = true, text) {
        if (!this.submitButton) return;

        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          this.submitButton.setAttribute('aria-disabled', 'true');
          if (text && this.submitButtonText) this.submitButtonText.textContent = text;
          return;
        }

        this.submitButton.removeAttribute('disabled');
        this.submitButton.removeAttribute('aria-disabled');
        if (this.submitButtonText && window.variantStrings?.addToCart) {
          this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }

      syncCustomProperties() {
        this.syncPropertyInput('Metal Type', '.metal-options .metal-image.is-selected');
        this.syncPropertyInput('Diamond Type', '.diamond-options .diamond-box.is-selected');
        this.syncPropertyInput('Diamond Clarity', '.clarity-options .clarity-box.is-selected');
      }

      syncPropertyInput(propertyName, selectedSelector) {
        const selected = document.querySelector(selectedSelector);
        const value = selected?.dataset?.value || selected?.textContent?.trim() || '';
        document.querySelectorAll(`[name="properties[${propertyName}]"], [data-option-input="${propertyName}"]`).forEach((input) => {
          input.value = value;
        });
      }

      appendSelectedProperty(formData, propertyName, selectedSelector) {
        const selected = document.querySelector(selectedSelector);
        const value = selected?.dataset?.value || selected?.textContent?.trim() || '';
        formData.delete(`properties[${propertyName}]`);
        if (value) formData.append(`properties[${propertyName}]`, value);
      }

      dispatchCartErrorEvent(message, code) {
        const event = new CustomEvent('cart-error', {
          detail: { error: message, code }
        });
        this.dispatchEvent(event);
      }
    }
  );
}
