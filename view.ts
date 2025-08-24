import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { parseImageMeta } from "./parser";

export const VIEW_TYPE_IMGMETA = "imgmeta-view";

export class ImageMetaView extends ItemView {
  private searchBarEl: HTMLDivElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchCountEl: HTMLSpanElement | null = null;
  private searchPrevEl: HTMLButtonElement | null = null;
  private searchNextEl: HTMLButtonElement | null = null;
  private searchCaseEl: HTMLButtonElement | null = null;
  private searchQuery: string = "";
  private searchCaseSensitive: boolean = false;
  private searchEnabled: boolean = false;
  private matches: { el: HTMLTextAreaElement; start: number; end: number }[] = [];
  private matchIndex: number = -1;
  private bodyEl: HTMLElement | null = null;
  private highlightedEl: HTMLTextAreaElement | null = null;
  private overlayMap: WeakMap<HTMLTextAreaElement, HTMLDivElement> = new WeakMap();

  constructor(leaf: WorkspaceLeaf, private appRef: any) { super(leaf); }
  getViewType() { return VIEW_TYPE_IMGMETA; }
  getDisplayText() { return "Image Metadata"; }
  getIcon() { return "info"; }

  async onOpen() {
    // Key handling scoped to this view's container
    this.contentEl.addEventListener("keydown", this.onKeydown, { capture: true });
    await this.renderForFile(this.app.workspace.getActiveFile());
  }

  async onClose() {
    this.contentEl.removeEventListener("keydown", this.onKeydown, { capture: true } as any);
  }

  async renderForFile(file: TFile | null) {
    const container = this.contentEl;
    container.empty();
    container.addClass("imgmeta-side");

    // Body container
    const body = container.createDiv({ cls: "imgmeta-body" });
    this.bodyEl = body;
    const copyWithNotice = async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        new Notice("Copied");
      } catch (e) {
        console.error(e);
        new Notice("Copy failed");
      }
    };

    if (!file || !(file instanceof TFile)) {
      const title = body.createEl("div", { cls: "imgmeta-title" });
      title.setText("Image Metadata");
      // Search bar under title
      this.buildSearchBar(body);
      body.createEl("div", { text: "No active file" });
      this.setSearchEnabled(false);
      this.recomputeMatches();
      return;
    }
    const ext = file.extension.toLowerCase();
    if (!["png","jpg","jpeg","webp"].includes(ext)) {
      const title = body.createEl("div", { cls: "imgmeta-title" });
      title.setText(file.name);
      // Search bar under title
      this.buildSearchBar(body);
      body.createEl("div", { text: `Not an image file: ${file.name}` });
      this.setSearchEnabled(false);
      this.recomputeMatches();
      return;
    }

    try {
      const buf = await this.app.vault.adapter.readBinary(file.path);
      const meta = await parseImageMeta(buf, ext);

      const title = body.createEl("div", { cls: "imgmeta-title" });
      title.setText(file.name);
      // Search bar under title
      this.buildSearchBar(body);

      const fields: any = meta.fields as any;
      const isComfy = fields && (fields["generator"] === "ComfyUI" || fields["prompt_json"] || fields["workflow_json"]);

      if (isComfy) {
        this.setSearchEnabled(false);
        const pos = typeof fields["prompt"] === "string" ? String(fields["prompt"]) : null;
        const neg = typeof fields["negative_prompt"] === "string" ? String(fields["negative_prompt"]) : null;
        if (pos) {
          const headerP = body.createDiv({ cls: "imgmeta-header" });
          headerP.createEl("h4", { text: "Positive Prompt" });
          const copyP = headerP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const taP = body.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
          taP.setAttr("readonly", "true"); taP.setAttr("spellcheck", "false"); taP.setAttr("wrap", "soft"); taP.value = pos;
          copyP.onclick = () => copyWithNotice(taP.value ?? "");
        }
        if (neg) {
          const headerN = body.createDiv({ cls: "imgmeta-header" });
          headerN.createEl("h4", { text: "Negative Prompt" });
          const copyN = headerN.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const taN = body.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
          taN.setAttr("readonly", "true"); taN.setAttr("spellcheck", "false"); taN.setAttr("wrap", "soft"); taN.value = neg;
          copyN.onclick = () => copyWithNotice(taN.value ?? "");
        }

        if (fields["prompt_json"]) {
          const detailsP = body.createEl("details", { cls: "imgmeta-details" });
          const sumP = detailsP.createEl("summary");
          sumP.setText("Prompt JSON");
          const copyPS = sumP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const boxPJ = detailsP.createDiv({ cls: "imgmeta-prebox" });
          const taPJ = boxPJ.createEl("textarea", { cls: "imgmeta-textarea" });
          taPJ.setAttr("readonly", "true"); taPJ.setAttr("spellcheck", "false"); taPJ.setAttr("wrap", "soft");
          taPJ.value = JSON.stringify(fields["prompt_json"], null, 2);
          copyPS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(taPJ.value ?? ""); };
          const exportP = detailsP.createEl("button", { text: "Export prompt.json" });
          exportP.onclick = async () => { await this.exportJson(file, "prompt", taPJ.value); };
        }

        if (fields["workflow_json"]) {
          const detailsW = body.createEl("details", { cls: "imgmeta-details" });
          const sumW = detailsW.createEl("summary");
          sumW.setText("Workflow JSON");
          const copyWS = sumW.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const boxWJ = detailsW.createDiv({ cls: "imgmeta-prebox" });
          const taWJ = boxWJ.createEl("textarea", { cls: "imgmeta-textarea" });
          taWJ.setAttr("readonly", "true"); taWJ.setAttr("spellcheck", "false"); taWJ.setAttr("wrap", "soft");
          taWJ.value = JSON.stringify(fields["workflow_json"], null, 2);
          copyWS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(taWJ.value ?? ""); };
          const exportW = detailsW.createEl("button", { text: "Export workflow.json" });
          exportW.onclick = async () => { await this.exportJson(file, "workflow", taWJ.value); };
        }

        // Raw chunks hidden in sidebar view (kept in modal)
      } else {
        const isA1111 = (typeof (meta.fields as any)["parameters_raw"] === "string") || (meta.raw && typeof meta.raw["parameters"] === "string");
        let btn: HTMLButtonElement;
        if (isA1111) {
          this.setSearchEnabled(true);
          const header = body.createDiv({ cls: "imgmeta-header" });
          header.createEl("h4", { text: "Parameters" });
          btn = header.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const wrap = body.createDiv({ cls: "imgmeta-textwrap" });
          // Overlay for highlight (above textarea, pointer-events: none)
          const overlay = wrap.createDiv({ cls: "imgmeta-overlay" });
          const overlayInner = overlay.createDiv({ cls: "imgmeta-overlay-content" });
          const ta = wrap.createEl("textarea", { cls: "imgmeta-textarea imgmeta-search-target" });
          ta.setAttr("readonly", "true");
          ta.setAttr("spellcheck", "false");
          ta.setAttr("wrap", "soft");
          const a1111 = (typeof (meta.fields as any)["parameters_raw"] === "string")
            ? String((meta.fields as any)["parameters_raw"]) : null;
          const fallback = JSON.stringify(meta.fields, null, 2);
          const paramsText = a1111 ?? meta.raw["parameters"] ?? fallback;
          ta.value = paramsText;
          // Initialize overlay content without highlight
          overlayInner.textContent = paramsText;
          // Sync scroll
          const sync = () => {
            (overlayInner as HTMLElement).style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
          };
          ta.addEventListener("scroll", sync);
          // initial
          sync();
          this.overlayMap.set(ta, overlayInner as HTMLDivElement);
          btn.onclick = () => copyWithNotice(ta.value ?? "");
        } else {
          this.setSearchEnabled(false);
          const ctr = body.createDiv({ cls: "imgmeta-controls" });
          btn = ctr.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const ta = body.createEl("textarea", { cls: "imgmeta-textarea" });
          ta.setAttr("readonly", "true");
          ta.setAttr("spellcheck", "false");
          ta.setAttr("wrap", "soft");
          const a1111 = (typeof (meta.fields as any)["parameters_raw"] === "string")
            ? String((meta.fields as any)["parameters_raw"]) : null;
          const fallback = JSON.stringify(meta.fields, null, 2);
          ta.value = a1111 ?? meta.raw["parameters"] ?? fallback;
          btn.onclick = () => copyWithNotice(ta.value ?? "");
        }

        // Raw chunks hidden in sidebar view (kept in modal)
      }
      // Recompute matches after rendering
      this.recomputeMatches();
    } catch (e) {
      console.error(e);
      new Notice("Failed to read metadata");
      this.setSearchEnabled(false);
      this.recomputeMatches();
    }
  }

  private async exportJson(file: TFile, kind: "prompt" | "workflow", content: string) {
    try {
      const base = file.basename;
      const folder = file.parent?.path ?? "";
      const suffix = kind === "prompt" ? ".prompt.json" : ".workflow.json";
      let target = (folder ? folder + "/" : "") + base + suffix;
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(target)) {
        target = (folder ? folder + "/" : "") + base + `.${kind}.${i}.json`;
        i++;
      }
      await this.app.vault.create(target, content);
      new Notice(`Exported: ${target}`);
    } catch (e) {
      console.error(e);
      new Notice("Export failed");
    }
  }

  // --- In-pane search implementation ---
  private buildSearchBar(container: HTMLElement) {
    // Reuse if already exists (e.g., re-render for another file)
    this.searchBarEl = container.createDiv({ cls: "imgmeta-searchbar" });
    const input = this.searchBarEl.createEl("input", { type: "text" });
    input.placeholder = "Find (parameters)";
    input.value = this.searchQuery;
    this.searchInputEl = input;

    const count = this.searchBarEl.createEl("span", { cls: "imgmeta-search-count" });
    this.searchCountEl = count as HTMLSpanElement;

    const caseBtn = this.searchBarEl.createEl("button", { cls: "imgmeta-inline-btn", text: "Aa" });
    caseBtn.setAttr("aria-label", "Toggle case sensitive");
    this.searchCaseEl = caseBtn;

    const prev = this.searchBarEl.createEl("button", { cls: "imgmeta-inline-btn", text: "Prev" });
    const next = this.searchBarEl.createEl("button", { cls: "imgmeta-inline-btn", text: "Next" });
    this.searchPrevEl = prev; this.searchNextEl = next;

    caseBtn.onclick = () => {
      this.searchCaseSensitive = !this.searchCaseSensitive;
      caseBtn.classList.toggle("is-active", this.searchCaseSensitive);
      this.recomputeMatches(false);
    };
    prev.onclick = () => this.findPrev();
    next.onclick = () => this.findNext();

    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      // Update counts without moving focus away from input
      this.recomputeMatches(false);
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (ev.shiftKey) this.findPrev(); else this.findNext();
      }
    });
    // Initialize case button visual state
    if (this.searchCaseSensitive) caseBtn.classList.add("is-active");
    this.updateCount();
    // Initialize disabled/enabled state
    this.setSearchEnabled(this.searchEnabled);
  }

  private onKeydown = (ev: KeyboardEvent) => {
    const isCmdOrCtrl = (ev.ctrlKey || ev.metaKey) && !ev.altKey;
    // Open search: Cmd/Ctrl+F
    if (isCmdOrCtrl && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      ev.stopPropagation();
      this.openSearchBar();
      return;
    }
    // Navigate: F3/Shift+F3
    if (ev.key === "F3") {
      ev.preventDefault();
      ev.shiftKey ? this.findPrev() : this.findNext();
      return;
    }
  };

  openSearchBar() {
    if (!this.searchBarEl) this.buildSearchBar(this.contentEl);
    if (!this.searchEnabled) return; // don't focus when disabled
    this.searchInputEl?.focus();
    this.searchInputEl?.select();
    // Do not focus matches when opening; keep caret in input
    this.recomputeMatches(false);
  }

  private collectTargets(): HTMLTextAreaElement[] {
    const root = this.contentEl;
    const nodes = Array.from(root.querySelectorAll<HTMLTextAreaElement>("textarea.imgmeta-search-target"));
    return nodes;
  }

  private escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
  }

  private renderOverlayFor(target: HTMLTextAreaElement, ranges: { start: number; end: number; isCurrent?: boolean }[] | null) {
    const overlayInner = this.overlayMap.get(target);
    if (!overlayInner) return;
    const text = target.value ?? "";
    if (!ranges || ranges.length === 0) {
      overlayInner.textContent = text;
      return;
    }
    const rs = [...ranges].sort((a,b) => a.start - b.start);
    let pos = 0;
    const parts: string[] = [];
    for (const r of rs) {
      if (r.start > pos) parts.push(this.escapeHtml(text.slice(pos, r.start)));
      const mid = this.escapeHtml(text.slice(r.start, r.end));
      const cls = r.isCurrent ? "imgmeta-hit-range is-current" : "imgmeta-hit-range";
      parts.push(`<span class=\"${cls}\">${mid}</span>`);
      pos = r.end;
    }
    if (pos < text.length) parts.push(this.escapeHtml(text.slice(pos)));
    overlayInner.innerHTML = parts.join("");
  }

  private renderAllOverlays(currentIndex: number | null) {
    const groups = new Map<HTMLTextAreaElement, { start: number; end: number; isCurrent?: boolean }[]>();
    this.matches.forEach((m, idx) => {
      const arr = groups.get(m.el) ?? [];
      arr.push({ start: m.start, end: m.end, isCurrent: currentIndex === idx });
      groups.set(m.el, arr);
    });
    const targets = this.collectTargets();
    for (const t of targets) {
      const ranges = groups.get(t) ?? null;
      this.renderOverlayFor(t, ranges);
    }
  }

  private normalize(text: string): string {
    return this.searchCaseSensitive ? text : text.toLowerCase();
  }

  private recomputeMatches(focus: boolean = false) {
    const q = this.searchQuery || "";
    // If search is disabled, just clear UI
    if (!this.searchEnabled) {
      const targets0 = this.collectTargets();
      for (const t of targets0) this.renderOverlayFor(t, null);
      this.matches = [];
      this.matchIndex = -1;
      this.updateCount();
      return;
    }
    const targets = this.collectTargets();
    for (const t of targets) this.renderOverlayFor(t, null);
    this.matches = [];
    if (!focus) this.matchIndex = -1;
    if (!q.trim()) {
      this.updateCount();
      if (this.highlightedEl) { this.highlightedEl.classList.remove("imgmeta-hit"); this.highlightedEl = null; }
      return;
    }
    const nq = this.normalize(q);
    for (const ta of targets) {
      const text = ta.value ?? "";
      const nt = this.normalize(text);
      let from = 0;
      while (true) {
        const idx = nt.indexOf(nq, from);
        if (idx === -1) break;
        this.matches.push({ el: ta, start: idx, end: idx + q.length });
        from = idx + Math.max(1, q.length);
      }
    }
    this.updateCount();
    if (this.matches.length > 0) {
      if (this.matchIndex < 0 || this.matchIndex >= this.matches.length) this.matchIndex = 0;
      // Render faint highlight for all, optionally mark current
      this.renderAllOverlays(focus ? this.matchIndex : null);
      if (focus) this.focusCurrentMatch();
    } else {
      if (this.highlightedEl) { this.highlightedEl.classList.remove("imgmeta-hit"); this.highlightedEl = null; }
    }
  }

  private focusCurrentMatch() {
    if (this.matchIndex < 0 || this.matchIndex >= this.matches.length) return;
    const m = this.matches[this.matchIndex];
    // Open any <details> ancestors
    let p: HTMLElement | null = m.el.parentElement;
    while (p) {
      if (p.tagName.toLowerCase() === "details") {
        (p as HTMLDetailsElement).open = true;
      }
      p = p.parentElement;
    }
    if (this.highlightedEl && this.highlightedEl !== m.el) {
      this.highlightedEl.classList.remove("imgmeta-hit");
    }
    m.el.classList.add("imgmeta-hit");
    this.highlightedEl = m.el;
    try { m.el.setSelectionRange(m.start, m.end); } catch { /* ignore */ }
    // Re-render overlays to mark current distinctly and bring into view
    this.renderAllOverlays(this.matchIndex);
    this.ensureCurrentVisible(m.el);
    m.el.scrollIntoView({ block: "nearest" });
    this.updateCount();
  }

  private ensureCurrentVisible(ta: HTMLTextAreaElement) {
    const overlayInner = this.overlayMap.get(ta);
    const overlay = overlayInner?.parentElement as HTMLElement | undefined;
    if (!overlayInner || !overlay) return;
    const current = overlayInner.querySelector<HTMLElement>(".imgmeta-hit-range.is-current");
    if (!current) return;
    const rSpan = current.getBoundingClientRect();
    const rOverlay = overlay.getBoundingClientRect();
    let newTop = ta.scrollTop;
    let newLeft = ta.scrollLeft;
    const padY = 8; // matches textarea padding
    const padX = 12;
    if (rSpan.top < rOverlay.top + padY) {
      newTop += (rSpan.top - (rOverlay.top + padY));
    } else if (rSpan.bottom > rOverlay.bottom - padY) {
      newTop += (rSpan.bottom - (rOverlay.bottom - padY));
    }
    if (rSpan.left < rOverlay.left + padX) {
      newLeft += (rSpan.left - (rOverlay.left + padX));
    } else if (rSpan.right > rOverlay.right - padX) {
      newLeft += (rSpan.right - (rOverlay.right - padX));
    }
    newTop = Math.max(0, Math.round(newTop));
    newLeft = Math.max(0, Math.round(newLeft));
    if (newTop !== ta.scrollTop) ta.scrollTop = newTop;
    if (newLeft !== ta.scrollLeft) ta.scrollLeft = newLeft;
  }

  findNext() {
    if (this.matches.length === 0) return;
    if (this.matchIndex === -1) this.matchIndex = 0; else this.matchIndex = (this.matchIndex + 1) % this.matches.length;
    this.focusCurrentMatch();
  }

  findPrev() {
    if (this.matches.length === 0) return;
    if (this.matchIndex === -1) this.matchIndex = 0; else this.matchIndex = (this.matchIndex - 1 + this.matches.length) % this.matches.length;
    this.focusCurrentMatch();
  }

  private updateCount() {
    if (!this.searchCountEl) return;
    const total = this.matches.length;
    const current = this.matchIndex >= 0 ? (this.matchIndex + 1) : 0;
    this.searchCountEl.textContent = this.searchEnabled ? (total > 0 ? `${current}/${total}` : "0/0") : "–";
  }

  private setSearchEnabled(enabled: boolean) {
    this.searchEnabled = enabled;
    if (!this.searchBarEl) return;
    this.searchBarEl.classList.toggle("is-disabled", !enabled);
    if (this.searchInputEl) {
      this.searchInputEl.disabled = !enabled;
    }
    if (this.searchPrevEl) this.searchPrevEl.disabled = !enabled;
    if (this.searchNextEl) this.searchNextEl.disabled = !enabled;
    if (this.searchCaseEl) this.searchCaseEl.disabled = !enabled;
    this.updateCount();
  }
}
