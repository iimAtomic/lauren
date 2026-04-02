(function () {
  const STORAGE_KEY = "maisonMonaAdminKey";

  const msgEl = document.getElementById("admin-msg");
  const form = document.getElementById("product-form");
  const editIdEl = document.getElementById("edit-id");
  const formTitle = document.getElementById("form-title");
  const submitBtn = document.getElementById("submit-btn");
  const cancelEdit = document.getElementById("cancel-edit");
  const tbody = document.getElementById("products-tbody");
  const keyInput = document.getElementById("admin-key");

  const fields = {
    name: document.getElementById("field-name"),
    description: document.getElementById("field-desc"),
    category: document.getElementById("field-cat"),
    sub_category: document.getElementById("field-sub"),
    price: document.getElementById("field-price"),
    image_url: document.getElementById("field-image-url"),
    file: document.getElementById("field-image-file"),
  };

  function getKey() {
    return localStorage.getItem(STORAGE_KEY) || "";
  }

  function setKey(k) {
    localStorage.setItem(STORAGE_KEY, k.trim());
  }

  keyInput.value = getKey();

  document.getElementById("save-key").addEventListener("click", () => {
    setKey(keyInput.value);
    showMsg("Clé enregistrée localement.", "ok");
  });

  function headersJson() {
    const k = getKey();
    return {
      "Content-Type": "application/json",
      "X-Admin-Key": k,
    };
  }

  function headersUpload() {
    const k = getKey();
    return { "X-Admin-Key": k };
  }

  function showMsg(text, type) {
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
    const r = await fetch("/api/upload", { method: "POST", headers: headersUpload(), body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Upload échoué");
    return j.url;
  }

  async function loadProducts() {
    const r = await fetch("/api/products");
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
    const r = await fetch("/api/products/" + encodeURIComponent(id));
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
      const r = await fetch(url, {
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
      const r = await fetch("/api/products/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: headersJson(),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Erreur");
      showMsg("Produit supprimé.", "ok");
      await loadProducts();
    } catch (err) {
      showMsg(err.message || "Erreur", "err");
    }
  }

  loadProducts();
})();
