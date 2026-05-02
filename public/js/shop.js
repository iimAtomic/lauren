(function () {
  const API = "/api/products";
  const PLACEHOLDER =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect fill="#f7f7f5" width="400" height="400"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9a9a8e" font-family="sans-serif" font-size="14">Maison Mona</text></svg>'
    );

  let allProducts = [];
  let filtered = [];
  let perPage = 12;
  let sortMode = "default";
  let gridCols = "4";
  let categoryKeyword = "";
  let searchQuery = "";

  const gridEl = document.getElementById("product-grid");
  const emptyEl = document.getElementById("shop-empty");
  const searchInput = document.getElementById("shop-search");
  const sortSelect = document.getElementById("sort-select");
  const isShopPage = Boolean(gridEl && emptyEl);
  const cartCountEl = document.getElementById("cart-count");
  const cartTotalEl = document.getElementById("cart-total-label");
  const cartBackdrop = document.getElementById("cart-backdrop");
  const cartPanel = document.getElementById("cart-panel");
  const cartLinesEl = document.getElementById("cart-lines");
  const cartEmptyEl = document.getElementById("cart-empty");
  const cartPanelTotalEl = document.getElementById("cart-panel-total");
  const cartWaBtn = document.getElementById("cart-whatsapp-btn");
  const cartWaHint = document.getElementById("cart-wa-hint");
  const cartCloseBtn = document.getElementById("cart-close");
  const navPanier = document.getElementById("nav-panier");

  let whatsappDigits = "";

  function formatPrice(n) {
    const v = Number(n) || 0;
    return (
      v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " CFA"
    );
  }

  function getCart() {
    try {
      return JSON.parse(localStorage.getItem("maisonMonaCart") || "[]");
    } catch {
      return [];
    }
  }

  function setCart(items) {
    localStorage.setItem("maisonMonaCart", JSON.stringify(items));
    updateCartUi();
  }

  function updateCartUi() {
    const cart = getCart();
    const n = cart.reduce((s, i) => s + (i.qty || 1), 0);
    const total = cart.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
    if (cartCountEl) cartCountEl.textContent = String(n);
    if (cartTotalEl) cartTotalEl.textContent = formatPrice(total);
    renderCartPanel();
  }

  function openCart() {
    if (!cartBackdrop || !cartPanel) return;
    cartBackdrop.hidden = false;
    cartPanel.classList.add("is-open");
    cartPanel.setAttribute("aria-hidden", "false");
    document.body.classList.add("cart-open");
    renderCartPanel();
  }

  function closeCart() {
    if (!cartBackdrop || !cartPanel) return;
    cartBackdrop.hidden = true;
    cartPanel.classList.remove("is-open");
    cartPanel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("cart-open");
  }

  function removeFromCart(productId) {
    const cart = getCart().filter((c) => c.id !== productId);
    setCart(cart);
  }

  function buildWhatsAppMessage(cart) {
    const lines = cart.map((item) => {
      const qty = item.qty || 1;
      const name = item.name || "Produit";
      return qty > 1 ? "• " + qty + "× " + name : "• " + name;
    });
    return (
      "Bonjour, je suis intéressé par l'ensemble des articles sélectionnés :\n\n" +
      lines.join("\n") +
      "\n\nMerci."
    );
  }

  function renderCartPanel() {
    if (!cartLinesEl || !cartEmptyEl || !cartPanelTotalEl) return;
    const cart = getCart();
    const total = cart.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
    cartPanelTotalEl.textContent = formatPrice(total);

    if (cart.length === 0) {
      cartEmptyEl.hidden = false;
      cartLinesEl.innerHTML = "";
      if (cartWaBtn) cartWaBtn.disabled = true;
      if (cartWaHint) {
        cartWaHint.hidden = true;
        cartWaHint.textContent = "";
      }
      return;
    }

    cartEmptyEl.hidden = true;
    cartLinesEl.innerHTML = cart
      .map((item) => {
        const qty = item.qty || 1;
        const unit = Number(item.price) || 0;
        const lineTotal = unit * qty;
        const id = escapeAttr(item.id);
        return (
          '<div class="cart-line" role="listitem">' +
          '<div class="cart-line-left">' +
          '<p class="cart-line-name">' +
          escapeHtml(item.name || "Produit") +
          "</p>" +
          '<p class="cart-line-meta">' +
          qty +
          " × " +
          escapeHtml(formatPrice(unit)) +
          "</p>" +
          '<button type="button" class="cart-line-remove" data-remove-id="' +
          id +
          '">Retirer</button>' +
          "</div>" +
          '<p class="cart-line-price">' +
          escapeHtml(formatPrice(lineTotal)) +
          "</p>" +
          "</div>"
        );
      })
      .join("");

    cartLinesEl.querySelectorAll("[data-remove-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCart(btn.getAttribute("data-remove-id"));
      });
    });

    const hasWa = Boolean(whatsappDigits && whatsappDigits.length >= 8);
    if (cartWaBtn) {
      cartWaBtn.disabled = !hasWa;
    }
    if (cartWaHint) {
      cartWaHint.hidden = true;
      cartWaHint.textContent = "";
    }
  }

  function submitOrderWhatsApp() {
    const cart = getCart();
    if (cart.length === 0) return;
    if (!whatsappDigits || whatsappDigits.length < 8) {
      alert("Numéro WhatsApp indisponible pour le moment. Réessayez plus tard.");
      return;
    }
    let text = buildWhatsAppMessage(cart);
    const maxLen = 1800;
    if (text.length > maxLen) {
      text = text.slice(0, maxLen - 20) + "\n… (message tronqué)";
    }
    const url =
      "https://wa.me/" + whatsappDigits + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function matchesCategory(p, kw) {
    if (!kw) return true;
    const hay = `${p.category || ""} ${p.sub_category || ""}`.toLowerCase();
    return hay.includes(kw.toLowerCase());
  }

  function matchesSearch(p, q) {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      (p.name && p.name.toLowerCase().includes(t)) ||
      (p.description && p.description.toLowerCase().includes(t)) ||
      (p.category && p.category.toLowerCase().includes(t))
    );
  }

  function applyFilters() {
    if (!isShopPage) return;
    filtered = allProducts.filter(
      (p) => matchesCategory(p, categoryKeyword) && matchesSearch(p, searchQuery)
    );
    sortList();
    render();
  }

  function sortList() {
    const list = [...filtered];
    if (sortMode === "price-asc") {
      list.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortMode === "price-desc") {
      list.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else if (sortMode === "name-asc") {
      list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));
    }
    filtered = list;
  }

  function render() {
    if (!gridEl || !emptyEl) return;
    const slice = filtered.slice(0, perPage);
    emptyEl.hidden = slice.length > 0;
    gridEl.innerHTML = "";

    gridEl.className = "product-grid";
    if (gridCols === "list") {
      gridEl.classList.add("list-view");
    } else {
      gridEl.classList.add("cols-" + gridCols);
    }

    slice.forEach((p) => {
      const article = document.createElement("article");
      article.className =
        "product-card" + (gridCols === "list" ? " list-view" : "");
      article.setAttribute("role", "listitem");

      const imgUrl = p.image_url && p.image_url.trim() ? p.image_url : PLACEHOLDER;
      const meta =
        (p.category || "").toUpperCase() +
        (p.sub_category
          ? ' <span class="sub">' + escapeHtml(p.sub_category) + "</span>"
          : "");

      article.innerHTML = `
        <div class="product-image-wrap">
          <img src="${escapeAttr(imgUrl)}" alt="${escapeAttr(p.name || "")}" loading="lazy" width="400" height="400" />
        </div>
        <div class="product-body">
          <h2 class="product-name">${escapeHtml(p.name || "")}</h2>
          <p class="product-meta">${meta}</p>
          <p class="product-price"><span class="currency">${formatPrice(p.price)}</span></p>
          <button type="button" class="btn-cart" data-id="${escapeAttr(p._id)}">Précommander</button>
        </div>
      `;
      const imgEl = article.querySelector("img");
      if (imgEl) {
        imgEl.addEventListener("error", function () {
          this.src = PLACEHOLDER;
        });
      }
      gridEl.appendChild(article);
    });

    gridEl.querySelectorAll(".btn-cart").forEach((btn) => {
      btn.addEventListener("click", () => addToCart(btn.getAttribute("data-id")));
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function addToCart(id) {
    const p = allProducts.find((x) => x._id === id);
    if (!p) return;
    const cart = getCart();
    const i = cart.findIndex((c) => c.id === id);
    if (i >= 0) cart[i].qty = (cart[i].qty || 1) + 1;
    else cart.push({ id, name: p.name, price: p.price || 0, qty: 1 });
    setCart(cart);
  }

  if (isShopPage) {
    document.querySelectorAll(".toolbar-show button[data-per]").forEach((btn) => {
      btn.addEventListener("click", () => {
        perPage = parseInt(btn.getAttribute("data-per"), 10);
        document.querySelectorAll(".toolbar-show button[data-per]").forEach((b) =>
          b.classList.toggle("is-active", b === btn)
        );
        render();
      });
    });

    document.querySelectorAll(".toolbar-views button[data-cols]").forEach((btn) => {
      btn.addEventListener("click", () => {
        gridCols = btn.getAttribute("data-cols");
        document.querySelectorAll(".toolbar-views button[data-cols]").forEach((b) =>
          b.classList.toggle("is-active", b === btn)
        );
        render();
      });
    });

    const categoryFilterEl = document.getElementById("category-filter");
    if (categoryFilterEl) {
      categoryFilterEl.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-cat]");
        if (!a) return;
        e.preventDefault();
        const raw = a.getAttribute("data-cat");
        categoryKeyword = raw === null || raw === "" ? "" : String(raw);
        categoryFilterEl.querySelectorAll("a").forEach((link) =>
          link.classList.toggle("is-active", link === a)
        );
        applyFilters();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        searchQuery = searchInput.value;
        applyFilters();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        sortMode = sortSelect.value;
        applyFilters();
      });
    }
  }

  const headerCartBtn = document.getElementById("header-cart-btn");
  if (headerCartBtn) {
    headerCartBtn.addEventListener("click", () => {
      openCart();
    });
  }

  if (cartBackdrop) {
    cartBackdrop.addEventListener("click", closeCart);
  }
  if (cartCloseBtn) {
    cartCloseBtn.addEventListener("click", closeCart);
  }
  if (cartWaBtn) {
    cartWaBtn.addEventListener("click", submitOrderWhatsApp);
  }
  if (navPanier) {
    navPanier.addEventListener("click", (e) => {
      e.preventDefault();
      openCart();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cartPanel && cartPanel.classList.contains("is-open")) {
      closeCart();
    }
  });

  async function loadOrderContact() {
    try {
      const r = await fetch("/api/order-contact");
      if (!r.ok) return;
      const j = await r.json();
      whatsappDigits = (j.whatsapp && String(j.whatsapp).replace(/\D/g, "")) || "";
    } catch {
      whatsappDigits = "";
    }
    renderCartPanel();
  }

  async function load() {
    try {
      const r = await fetch(API);
      if (!r.ok) throw new Error("Erreur réseau");
      allProducts = await r.json();
    } catch {
      allProducts = [];
    }
    applyFilters();
  }

  async function loadSiteSettingsShop() {
    try {
      const r = await fetch("/api/site-settings");
      if (!r.ok) return;
      const j = await r.json();

      const nav = document.getElementById("category-filter");
      if (nav && Array.isArray(j.shopCategories)) {
        const links = [
          '<a href="#" data-cat="" class="' +
            (categoryKeyword === "" ? "is-active" : "") +
            '">Tout</a>',
        ];
        j.shopCategories.forEach((c) => {
          const slug = String(c.slug || "").trim();
          if (!slug) return;
          const activeCls = categoryKeyword === slug ? "is-active" : "";
          links.push(
            '<a href="#" data-cat="' +
              escapeAttr(slug) +
              '" class="' +
              activeCls +
              '">' +
              escapeHtml(c.label || slug) +
              "</a>"
          );
        });
        nav.innerHTML = links.join("");
      }
    } catch {
      /* conserve les images du HTML */
    }
  }

  updateCartUi();
  loadOrderContact();
  loadSiteSettingsShop();
  if (isShopPage) {
    load();
  }
})();
