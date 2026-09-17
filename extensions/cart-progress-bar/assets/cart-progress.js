/*
 * Cart Progress Rewards: storefront script.
 *
 * Every [data-cart-progress] element carries the merchant's config and the
 * cart as it was when Liquid rendered the page. We draw from that immediately,
 * then keep the bar live without touching theme code: themes change the cart
 * through the Ajax Cart API (/cart/add, /cart/change, /cart/update, /cart/clear),
 * so we watch fetch/XHR for those requests and re-read /cart.js afterwards.
 */
(function () {
  if (window.__cartProgressRewards) return; // block + embed both load this file
  window.__cartProgressRewards = true;

  var CART_MUTATION = /\/cart\/(add|change|update|clear)(\.js|\.json)?$/;
  var refreshTimer;

  function roots() {
    return document.querySelectorAll("[data-cart-progress]");
  }

  function readState(root) {
    try {
      return JSON.parse(root.dataset.config);
    } catch (error) {
      return null;
    }
  }

  function formatMoney(cents, currency, locale) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency,
      }).format(cents / 100);
    } catch (error) {
      return (cents / 100).toFixed(2);
    }
  }

  function render(root, cart) {
    var state = readState(root);
    if (!state) return;
    var config = state.config;

    // Tiers are saved in the shop's currency; the cart is in the customer's
    // (presentment) currency. Shopify exposes the conversion rate for Markets.
    var rate = Number(window.Shopify && Shopify.currency && Shopify.currency.rate) || 1;
    var tiers = (config.tiers || [])
      .map(function (tier) {
        return { label: tier.label, cents: Math.round(tier.threshold * 100 * rate) };
      })
      .filter(function (tier) {
        return tier.cents > 0;
      })
      .sort(function (a, b) {
        return a.cents - b.cents;
      });
    if (tiers.length === 0) return;

    var total = cart.total_price;
    root.hidden = root.dataset.hideWhenEmpty === "true" && cart.item_count === 0;

    var max = tiers[tiers.length - 1].cents;
    var percent = Math.min(100, Math.round((total / max) * 100));
    var next = tiers.find(function (tier) {
      return total < tier.cents;
    });

    var message = config.messages.complete;
    if (next) {
      var template = total > 0 ? config.messages.inProgress : config.messages.empty;
      message = template
        .split("{amount}")
        .join(formatMoney(next.cents - total, cart.currency, state.locale))
        .split("{reward}")
        .join(next.label);
    }

    // textContent, not innerHTML: messages are merchant-entered text.
    root.querySelector(".cart-progress__message").textContent = message;

    var fill = root.querySelector(".cart-progress__fill");
    // The first draw should appear at its true width rather than sliding up
    // from zero; later cart changes animate.
    if (!root.dataset.drawn) {
      root.dataset.drawn = "true";
      fill.style.transition = "none";
      requestAnimationFrame(function () {
        fill.style.transition = "";
      });
    }
    fill.style.width = percent + "%";
    var track = root.querySelector(".cart-progress__track");
    track.setAttribute("aria-valuenow", String(percent));

    track.querySelectorAll(".cart-progress__marker").forEach(function (marker) {
      marker.remove();
    });
    tiers.forEach(function (tier) {
      var marker = document.createElement("span");
      marker.className = "cart-progress__marker" + (total >= tier.cents ? " is-reached" : "");
      marker.style.left = (tier.cents / max) * 100 + "%";
      marker.title = tier.label;
      track.appendChild(marker);
    });
  }

  function renderAll(cart) {
    roots().forEach(function (root) {
      var state = readState(root);
      render(root, cart || (state && state.cart));
    });
  }

  function refresh() {
    var cartUrl = ((window.Shopify && Shopify.routes && Shopify.routes.root) || "/") + "cart.js";
    return window
      .fetch(cartUrl, { headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.json();
      })
      .then(renderAll)
      .catch(function () {});
  }

  // Several cart requests often fire back to back; refresh once after they settle.
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 150);
  }

  function isCartMutation(url) {
    try {
      return CART_MUTATION.test(new URL(url, window.location.origin).pathname);
    } catch (error) {
      return false;
    }
  }

  var originalFetch = window.fetch;
  window.fetch = function (input) {
    var url = input instanceof Request ? input.url : String(input);
    return originalFetch.apply(this, arguments).then(function (response) {
      if (response.ok && isCartMutation(url)) scheduleRefresh();
      return response;
    });
  };

  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isCartMutation(String(url))) {
      this.addEventListener("load", function () {
        if (this.status >= 200 && this.status < 300) scheduleRefresh();
      });
    }
    return originalOpen.apply(this, arguments);
  };

  // Back/forward cache restores an old page, so its embedded cart may be stale.
  window.addEventListener("pageshow", function (event) {
    if (event.persisted) refresh();
  });

  // The theme editor re-renders sections in place when settings change.
  document.addEventListener("shopify:section:load", function () {
    renderAll();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderAll();
    });
  } else {
    renderAll();
  }
})();
