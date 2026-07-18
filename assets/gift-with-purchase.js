
(function () {
 const GIFT_TIERS = [
  { threshold: 199900, variantId: 42928272048199, label: "1 CT Diamond Gift" },    // >= $1999.00
  { threshold: 149900, variantId: 42928272015431, label: "0.75 CT Diamond Gift" }, // >= $1499.00
  { threshold:  99900, variantId: 42928271982663, label: "0.50 CT Diamond Gift" }, // >= $999.00
];
  

  const GIFT_PROPERTY_KEY = "_gift_tier"; 
  const DEBOUNCE_MS = 400;

  let isProcessing = false;
  let debounceTimer = null;

  async function getCart() {
    const res = await fetch("/cart.js", { headers: { Accept: "application/json" } });
    return res.json();
  }

  function getEligibleTier(subtotalCents) {
    // Sorted high-to-low: first match wins (top tier beats lower ones)
    return GIFT_TIERS.find((t) => subtotalCents >= t.threshold) || null;
  }

  function findCurrentGiftLine(cart) {
    return cart.items.find((item) => item.properties && item.properties[GIFT_PROPERTY_KEY]);
  }

  function calcSubtotalExcludingGifts(cart) {
    return cart.items.reduce((sum, item) => {
      if (item.properties && item.properties[GIFT_PROPERTY_KEY]) return sum;
      return sum + item.line_price;
    }, 0);
  }

  async function removeGiftLine(cart) {
    const giftLine = findCurrentGiftLine(cart);
    if (!giftLine) return;
    await fetch("/cart/change.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: giftLine.key, quantity: 0 }),
    });
  }

  async function addGiftLine(tier) {
    await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          {
            id: tier.variantId,
            quantity: 1,
            properties: { [GIFT_PROPERTY_KEY]: tier.label },
          },
        ],
      }),
    });
  }

  async function syncGifts() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const cart = await getCart();
      const subtotal = calcSubtotalExcludingGifts(cart);
      const eligibleTier = getEligibleTier(subtotal);
      const currentGiftLine = findCurrentGiftLine(cart);
      const currentGiftLabel = currentGiftLine?.properties?.[GIFT_PROPERTY_KEY];

      // Case 1: no tier eligible, but a gift is in cart -> remove it
      if (!eligibleTier && currentGiftLine) {
        await removeGiftLine(cart);
        document.dispatchEvent(new CustomEvent("gift:removed"));
        return;
      }

      // Case 2: eligible tier exists, but wrong (or no) gift present -> swap
      if (eligibleTier && currentGiftLabel !== eligibleTier.label) {
        if (currentGiftLine) await removeGiftLine(cart);
        await addGiftLine(eligibleTier);
        document.dispatchEvent(new CustomEvent("gift:added", { detail: eligibleTier }));
        return;
      }

      // Case 3: already correct -> do nothing (avoids infinite loop)
    } catch (err) {
      console.error("Gift sync failed:", err);
    } finally {
      isProcessing = false;
    }
  }

  function debouncedSync() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncGifts, DEBOUNCE_MS);
  }

  // --- Hook into cart update events ---
  // Dawn / Dawn-based themes dispatch 'cart:update' or similar on the document.
  // Adjust the event name(s) below to match your theme (see cart-drawer.js in your theme's assets).
  document.addEventListener("cart:update", debouncedSync);
  document.addEventListener("cart:refresh", debouncedSync);

  // Fallback: also listen to native form submissions that hit /cart/add
  document.addEventListener("submit", (e) => {
    if (e.target.matches('form[action*="/cart/add"]')) {
      setTimeout(debouncedSync, DEBOUNCE_MS);
    }
  });

  // Run once on page load in case cart already qualifies
  document.addEventListener("DOMContentLoaded", debouncedSync);
})();