(function () {
  const msgEl = document.getElementById("admin-msg");

  const form = document.getElementById("product-form");
  const editIdEl = document.getElementById("edit-id");
  const formTitle = document.getElementById("form-title");
  const submitBtn = document.getElementById("submit-btn");
  const cancelEdit = document.getElementById("cancel-edit");
  const tbody = document.getElementById("products-tbody");
  const categoriesTbody = document.getElementById("categories-tbody");

  /** @type {{ label: string; slug: string }[]} */
  let shopCategoriesState = [];

  function slugifyCategory(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  const fields = {
    name: document.getElementById("field-name"),
    description: document.getElementById("field-desc"),
    category: document.getElementById("field-cat"),
    sub_category: document.getElementById("field-sub"),
    price: document.getElementById("field-price"),
    image_url: document.getElementById("field-image-url"),
    file: document.getElementById("field-image-file"),
  };

  function headersJson() {
    return { "Content-Type": "application/json" };
  }

  /** Une nouvelle tentative après ~1,6 s si gateway timeout ou surcharge (cold start Mongo). */
  async function apiFetch(url, opts = {}) {
    const method = String(opts.method || "GET").toUpperCase();
    let r = await fetch(url, opts);
    if (
      method === "GET" &&
      !opts.__retry &&
      (r.status === 502 || r.status === 503 || r.status === 504)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      return fetch(url, { ...opts, __retry: true });
    }
    return r;
  }

  function showMsg(text, type) {
    if (!msgEl) return;
    msgEl.innerHTML = "";
    if (!text) return;
    const d = document.createElement("div");
    d.className = "msg " + (type === "ok" ? "ok" : "err");
    d.textContent = text;
    msgEl.appendChild(d);
  }

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("image", file);
    const r = await apiFetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Upload échoué");
    return j.url;
  }

  function updateHeroPreview(i) {
    const url = document.getElementById("hero-url-" + i).value.trim();
    const prev = document.getElementById("hero-preview-" + i);
    if (!prev) return;
    if (url) {
      prev.src = url;
      prev.hidden = false;
    } else {
      prev.removeAttribute("src");
      prev.hidden = true;
    }
  }

  function renderCategoriesAdmin() {
    if (!categoriesTbody) return;
    categoriesTbody.innerHTML = "";
    shopCategoriesState.forEach((c, i) => {
      const tr = document.createElement("tr");
      const tdLabel = document.createElement("td");
      const inpLabel = document.createElement("input");
      inpLabel.type = "text";
      inpLabel.className = "cat-label";
      inpLabel.value = c.label;
      inpLabel.addEventListener("input", () => {
        shopCategoriesState[i].label = inpLabel.value;
      });
      tdLabel.appendChild(inpLabel);

      const tdSlug = document.createElement("td");
      const inpSlug = document.createElement("input");
      inpSlug.type = "text";
      inpSlug.className = "cat-slug";
      inpSlug.value = c.slug;
      inpSlug.addEventListener("input", () => {
        shopCategoriesState[i].slug = inpSlug.value;
      });
      tdSlug.appendChild(inpSlug);

      const tdDel = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-danger btn-del";
      btn.textContent = "Supprimer";
      btn.addEventListener("click", () => {
        shopCategoriesState.splice(i, 1);
        renderCategoriesAdmin();
      });
      tdDel.appendChild(btn);

      tr.appendChild(tdLabel);
      tr.appendChild(tdSlug);
      tr.appendChild(tdDel);
      categoriesTbody.appendChild(tr);
    });
  }

  function applyHeroAndCategoriesFromJson(j) {
    const row = j.heroImages || [];
    for (let i = 0; i < 4; i++) {
      const el = document.getElementById("hero-url-" + i);
      if (el) el.value = row[i] || "";
      const fileEl = document.getElementById("hero-file-" + i);
      if (fileEl) fileEl.value = "";
      updateHeroPreview(i);
    }
    if (Array.isArray(j.shopCategories)) {
      shopCategoriesState = j.shopCategories.map((row) => ({
        label: row.label != null ? String(row.label) : "",
        slug: row.slug != null ? String(row.slug) : "",
      }));
      renderCategoriesAdmin();
    }
  }

  async function loadHeroSettings() {
    try {
      const r = await apiFetch("/api/site-settings/raw");
      if (!r.ok) return;
      const j = await r.json();
      applyHeroAndCategoriesFromJson(j);
    } catch {
      /* ignore */
    }
  }

  function renderProductRows(list) {
    tbody.innerHTML = "";
    list.forEach((p) => {
      const tr = document.createElement("tr");
      const thumb = p.image_url
        ? `<img class="thumb" src="${escapeAttr(p.image_url)}" alt="" data-fallback="1" />`
        : "—";
      tr.innerHTML = `
        <td>${thumb}</td>
        <td>${escapeHtml(p.name || "")}</td>
        <td>${escapeHtml([p.category, p.sub_category].filter(Boolean).join(" · "))}</td>
        <td>${formatPrice(p.price)}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-edit" data-id="${escapeAttr(p._id)}">Modifier</button>
          <button type="button" class="btn btn-danger btn-del" data-id="${escapeAttr(p._id)}">Supprimer</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener(
        "error",
        function thumbErr() {
          img.removeEventListener("error", thumbErr);
          img.replaceWith(document.createTextNode("—"));
        },
        { once: true }
      );
    });
    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(btn.getAttribute("data-id")));
    });
    tbody.querySelectorAll(".btn-del").forEach((btn) => {
      btn.addEventListener("click", () => removeProduct(btn.getAttribute("data-id")));
    });
  }

  async function loadProducts() {
    try {
      const r = await apiFetch("/api/products");
      if (!r.ok) {
        tbody.innerHTML = "";
        return;
      }
      const list = await r.json();
      renderProductRows(Array.isArray(list) ? list : []);
    } catch {
      tbody.innerHTML = "";
    }
  }

  /** Un seul appel serveur au chargement : moins de cold starts / risque de 504. */
  async function loadAdminBootstrap() {
    try {
      const r = await apiFetch("/api/admin/bootstrap");
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const msg =
          r.status === 503 || r.status === 504
            ? "Le serveur met du temps à répondre (base de données). Rechargez la page dans quelques secondes."
            : j.error || "Impossible de charger les données admin.";
        showMsg(msg, "err");
        return;
      }
      const j = await r.json();
      applyHeroAndCategoriesFromJson(j);
      renderProductRows(Array.isArray(j.products) ? j.products : []);
    } catch {
      showMsg("Réseau indisponible. Vérifiez votre connexion puis rechargez la page.", "err");
    }
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

  function formatPrice(n) {
    const v = Number(n) || 0;
    return v.toLocaleString("fr-FR") + " CFA";
  }

  function resetForm() {
    editIdEl.value = "";
    formTitle.textContent = "Ajouter un produit";
    submitBtn.textContent = "Enregistrer";
    cancelEdit.hidden = true;
    form.reset();
    fields.file.value = "";
  }

  async function startEdit(id) {
    const r = await apiFetch("/api/products/" + encodeURIComponent(id));
    if (!r.ok) {
      showMsg("Produit introuvable.", "err");
      return;
    }
    const p = await r.json();
    editIdEl.value = p._id;
    formTitle.textContent = "Modifier le produit";
    submitBtn.textContent = "Mettre à jour";
    cancelEdit.hidden = false;
    fields.name.value = p.name || "";
    fields.description.value = p.description || "";
    fields.category.value = p.category || "";
    fields.sub_category.value = p.sub_category || "";
    fields.price.value = p.price != null ? p.price : 0;
    fields.image_url.value = p.image_url || "";
    fields.file.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  cancelEdit.addEventListener("click", resetForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("", "");

    let imageUrl = fields.image_url.value.trim();
    if (fields.file.files && fields.file.files[0]) {
      try {
        imageUrl = await uploadFile(fields.file.files[0]);
        fields.image_url.value = imageUrl;
      } catch (err) {
        showMsg(err.message || "Erreur upload", "err");
        return;
      }
    }

    const body = {
      name: fields.name.value.trim(),
      description: fields.description.value.trim(),
      category: fields.category.value.trim(),
      sub_category: fields.sub_category.value.trim(),
      price: Number(fields.price.value) || 0,
      image_url: imageUrl,
    };

    const editing = editIdEl.value;
    const url = editing ? "/api/products/" + encodeURIComponent(editing) : "/api/products";
    const method = editing ? "PUT" : "POST";

    try {
      const r = await apiFetch(url, {
        method,
        headers: headersJson(),
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur serveur");
      showMsg(editing ? "Produit mis à jour." : "Produit ajouté.", "ok");
      resetForm();
      await loadProducts();
    } catch (err) {
      showMsg(err.message || "Erreur", "err");
    }
  });

  async function removeProduct(id) {
    if (!confirm("Supprimer ce produit ?")) return;
    showMsg("", "");
    try {
      const r = await apiFetch("/api/products/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur");
      showMsg("Produit supprimé.", "ok");
      await loadProducts();
    } catch (err) {
      showMsg(err.message || "Erreur", "err");
    }
  }

  document.getElementById("save-hero").addEventListener("click", async () => {
    showMsg("", "");

    /** Upload des 4 fichiers en parallèle quand présents — beaucoup plus rapide en réseau lent. */
    const slots = Array.from({ length: 4 }, (_, i) => {
      const urlEl = document.getElementById("hero-url-" + i);
      const fileEl = document.getElementById("hero-file-" + i);
      return {
        i,
        urlEl,
        fileEl,
        currentUrl: urlEl ? urlEl.value.trim() : "",
        file: fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null,
      };
    });

    let uploads;
    try {
      uploads = await Promise.all(
        slots.map((s) => (s.file ? uploadFile(s.file) : Promise.resolve(null)))
      );
    } catch (err) {
      showMsg(err.message || "Erreur upload (hero)", "err");
      return;
    }

    const urls = slots.map((s, idx) => {
      const uploaded = uploads[idx];
      if (uploaded) {
        s.urlEl.value = uploaded;
        if (s.fileEl) s.fileEl.value = "";
        return uploaded;
      }
      return s.currentUrl;
    });

    try {
      const r = await apiFetch("/api/site-settings", {
        method: "PUT",
        headers: headersJson(),
        body: JSON.stringify({ heroImages: urls }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur serveur");
      showMsg("Images du hero enregistrées.", "ok");
      for (let i = 0; i < 4; i++) updateHeroPreview(i);
    } catch (err) {
      showMsg(err.message || "Erreur", "err");
    }
  });

  for (let i = 0; i < 4; i++) {
    const inp = document.getElementById("hero-url-" + i);
    if (inp) inp.addEventListener("input", () => updateHeroPreview(i));
  }

  const addCatBtn = document.getElementById("add-category");
  const saveCatBtn = document.getElementById("save-categories");
  const newCatLabel = document.getElementById("new-cat-label");
  const newCatSlug = document.getElementById("new-cat-slug");

  if (addCatBtn && newCatLabel) {
    addCatBtn.addEventListener("click", () => {
      showMsg("", "");
      const label = newCatLabel.value.trim();
      let slug = newCatSlug ? newCatSlug.value.trim() : "";
      if (!label) {
        showMsg("Indiquez un libellé pour la catégorie.", "err");
        return;
      }
      if (!slug) slug = slugifyCategory(label);
      slug = slugifyCategory(slug);
      if (!slug) {
        showMsg("Mot-clé invalide : utilisez des lettres ou chiffres.", "err");
        return;
      }
      if (shopCategoriesState.some((c) => slugifyCategory(c.slug) === slug)) {
        showMsg("Ce mot-clé existe déjà.", "err");
        return;
      }
      shopCategoriesState.push({ label, slug });
      newCatLabel.value = "";
      if (newCatSlug) newCatSlug.value = "";
      renderCategoriesAdmin();
    });
  }

  if (saveCatBtn) {
    saveCatBtn.addEventListener("click", async () => {
      showMsg("", "");
      const payload = shopCategoriesState
        .map((c) => ({
          label: (c.label || "").trim(),
          slug: slugifyCategory(c.slug || c.label),
        }))
        .filter((c) => c.label && c.slug);
      try {
        const r = await apiFetch("/api/site-settings", {
          method: "PUT",
          headers: headersJson(),
          body: JSON.stringify({ shopCategories: payload }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Erreur serveur");
        showMsg("Catégories enregistrées.", "ok");
        await loadHeroSettings();
      } catch (err) {
        showMsg(err.message || "Erreur", "err");
      }
    });
  }

  loadAdminBootstrap();
})();
