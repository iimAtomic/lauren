(function () {
  const FETCH_CRED = { credentials: "include" };

  const msgEl = document.getElementById("admin-msg");
  const loginScreen = document.getElementById("admin-login-screen");
  const adminApp = document.getElementById("admin-app");
  const loginPwd = document.getElementById("admin-password");
  const loginBtn = document.getElementById("admin-login-btn");
  const loginErr = document.getElementById("admin-login-error");
  const logoutBtn = document.getElementById("admin-logout");

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

  function showLoggedOut() {
    if (loginScreen) loginScreen.hidden = false;
    if (adminApp) adminApp.hidden = true;
    if (loginPwd) loginPwd.value = "";
    if (loginErr) {
      loginErr.hidden = true;
      loginErr.textContent = "";
    }
  }

  function showLoggedIn() {
    if (loginScreen) loginScreen.hidden = true;
    if (adminApp) adminApp.hidden = false;
    loadProducts();
    loadHeroSettings();
  }

  async function fetchCred(url, opts = {}) {
    const r = await fetch(url, { ...FETCH_CRED, ...opts });
    if (r.status === 401 && adminApp && !adminApp.hidden) {
      showLoggedOut();
      showMsg("Session expirée ou accès refusé. Reconnectez-vous.", "err");
      throw new Error("401");
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
    const r = await fetchCred("/api/upload", { method: "POST", body: fd });
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

  async function loadHeroSettings() {
    try {
      const r = await fetchCred("/api/site-settings/raw");
      if (!r.ok) return;
      const j = await r.json();
      const row = j.heroImages || [];
      for (let i = 0; i < 4; i++) {
        document.getElementById("hero-url-" + i).value = row[i] || "";
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
    } catch {
      /* ignore */
    }
  }

  async function loadProducts() {
    try {
      const r = await fetchCred("/api/products");
      if (!r.ok) {
        tbody.innerHTML = "";
        return;
      }
      const list = await r.json();
      tbody.innerHTML = "";
      list.forEach((p) => {
        const tr = document.createElement("tr");
        const thumb = p.image_url
          ? `<img class="thumb" src="${escapeAttr(p.image_url)}" alt="" />`
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

      tbody.querySelectorAll(".btn-edit").forEach((btn) => {
        btn.addEventListener("click", () => startEdit(btn.getAttribute("data-id")));
      });
      tbody.querySelectorAll(".btn-del").forEach((btn) => {
        btn.addEventListener("click", () => removeProduct(btn.getAttribute("data-id")));
      });
    } catch {
      tbody.innerHTML = "";
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
    const r = await fetch("/api/products/" + encodeURIComponent(id), FETCH_CRED);
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
      const r = await fetchCred(url, {
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
      if (err.message !== "401") showMsg(err.message || "Erreur", "err");
    }
  });

  async function removeProduct(id) {
    if (!confirm("Supprimer ce produit ?")) return;
    showMsg("", "");
    try {
      const r = await fetchCred("/api/products/" + encodeURIComponent(id), {
        method: "DELETE",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur");
      showMsg("Produit supprimé.", "ok");
      await loadProducts();
    } catch (err) {
      if (err.message !== "401") showMsg(err.message || "Erreur", "err");
    }
  }

  document.getElementById("save-hero").addEventListener("click", async () => {
    showMsg("", "");
    const urls = [];
    for (let i = 0; i < 4; i++) {
      let u = document.getElementById("hero-url-" + i).value.trim();
      const fileEl = document.getElementById("hero-file-" + i);
      const f = fileEl && fileEl.files && fileEl.files[0];
      if (f) {
        try {
          u = await uploadFile(f);
          document.getElementById("hero-url-" + i).value = u;
          fileEl.value = "";
        } catch (err) {
          showMsg(err.message || "Erreur upload (hero)", "err");
          return;
        }
      }
      urls.push(u);
    }
    try {
      const r = await fetchCred("/api/site-settings", {
        method: "PUT",
        headers: headersJson(),
        body: JSON.stringify({ heroImages: urls }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur serveur");
      showMsg("Images du hero enregistrées.", "ok");
      for (let i = 0; i < 4; i++) updateHeroPreview(i);
    } catch (err) {
      if (err.message !== "401") showMsg(err.message || "Erreur", "err");
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
        const r = await fetchCred("/api/site-settings", {
          method: "PUT",
          headers: headersJson(),
          body: JSON.stringify({ shopCategories: payload }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Erreur serveur");
        showMsg("Catégories enregistrées.", "ok");
        await loadHeroSettings();
      } catch (err) {
        if (err.message !== "401") showMsg(err.message || "Erreur", "err");
      }
    });
  }

  async function tryLogin() {
    if (loginErr) {
      loginErr.hidden = true;
      loginErr.textContent = "";
    }
    const pwd = loginPwd ? loginPwd.value : "";
    if (!pwd.trim()) {
      if (loginErr) {
        loginErr.textContent = "Saisissez le mot de passe.";
        loginErr.hidden = false;
      }
      return;
    }
    try {
      const r = await fetch("/api/admin/login", {
        ...FETCH_CRED,
        method: "POST",
        headers: headersJson(),
        body: JSON.stringify({ password: pwd }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (loginErr) {
          loginErr.textContent = j.error || "Connexion impossible.";
          loginErr.hidden = false;
        }
        return;
      }
      showLoggedIn();
      showMsg("Connecté. Session valable 1 heure.", "ok");
    } catch {
      if (loginErr) {
        loginErr.textContent = "Erreur réseau.";
        loginErr.hidden = false;
      }
    }
  }

  if (loginBtn) loginBtn.addEventListener("click", tryLogin);
  if (loginPwd) {
    loginPwd.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryLogin();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      showMsg("", "");
      try {
        await fetch("/api/admin/logout", { ...FETCH_CRED, method: "POST" });
      } catch {
        /* ignore */
      }
      showLoggedOut();
      showMsg("Vous êtes déconnecté.", "ok");
    });
  }

  async function boot() {
    try {
      const r = await fetch("/api/admin/session", FETCH_CRED);
      const j = await r.json();
      if (j.authenticated === true) {
        showLoggedIn();
      } else {
        showLoggedOut();
      }
    } catch {
      showLoggedOut();
    }
  }

  boot();
})();
