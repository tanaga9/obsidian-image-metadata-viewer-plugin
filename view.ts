import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { parseImageMeta } from "./parser";

export const VIEW_TYPE_IMGMETA = "imgmeta-view";

export class ImageMetaView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private appRef: any) { super(leaf); }
  getViewType() { return VIEW_TYPE_IMGMETA; }
  getDisplayText() { return "Image Metadata"; }
  getIcon() { return "info"; }

  async onOpen() {
    await this.renderForFile(this.app.workspace.getActiveFile());
  }

  async renderForFile(file: TFile | null) {
    const container = this.contentEl;
    container.empty();
    container.addClass("imgmeta-side");
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
      container.createEl("div", { text: "No active file" });
      return;
    }
    const ext = file.extension.toLowerCase();
    if (!["png","jpg","jpeg","webp"].includes(ext)) {
      container.createEl("div", { text: `Not an image file: ${file.name}` });
      return;
    }

    try {
      const buf = await this.app.vault.adapter.readBinary(file.path);
      const meta = await parseImageMeta(buf, ext);

      const title = container.createEl("div", { cls: "imgmeta-title" });
      title.setText(file.name);

      const fields: any = meta.fields as any;
      const isComfy = fields && (fields["generator"] === "ComfyUI" || fields["prompt_json"] || fields["workflow_json"]);

      if (isComfy) {
        const pos = typeof fields["prompt"] === "string" ? String(fields["prompt"]) : null;
        const neg = typeof fields["negative_prompt"] === "string" ? String(fields["negative_prompt"]) : null;
        if (pos) {
          const headerP = container.createDiv({ cls: "imgmeta-header" });
          headerP.createEl("h4", { text: "Positive Prompt" });
          const copyP = headerP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const taP = container.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
          taP.setAttr("readonly", "true"); taP.setAttr("spellcheck", "false"); taP.value = pos;
          copyP.onclick = () => copyWithNotice(taP.value ?? "");
        }
        if (neg) {
          const headerN = container.createDiv({ cls: "imgmeta-header" });
          headerN.createEl("h4", { text: "Negative Prompt" });
          const copyN = headerN.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const taN = container.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
          taN.setAttr("readonly", "true"); taN.setAttr("spellcheck", "false"); taN.value = neg;
          copyN.onclick = () => copyWithNotice(taN.value ?? "");
        }

        if (fields["prompt_json"]) {
          const detailsP = container.createEl("details", { cls: "imgmeta-details" });
          const sumP = detailsP.createEl("summary");
          sumP.setText("Prompt JSON");
          const copyPS = sumP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const boxPJ = detailsP.createDiv({ cls: "imgmeta-prebox" });
          const taPJ = boxPJ.createEl("textarea", { cls: "imgmeta-textarea" });
          taPJ.setAttr("readonly", "true"); taPJ.setAttr("spellcheck", "false"); taPJ.setAttr("wrap", "off");
          taPJ.value = JSON.stringify(fields["prompt_json"], null, 2);
          copyPS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(taPJ.value ?? ""); };
          const exportP = detailsP.createEl("button", { text: "Export prompt.json" });
          exportP.onclick = async () => { await this.exportJson(file, "prompt", taPJ.value); };
        }

        if (fields["workflow_json"]) {
          const detailsW = container.createEl("details", { cls: "imgmeta-details" });
          const sumW = detailsW.createEl("summary");
          sumW.setText("Workflow JSON");
          const copyWS = sumW.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          const boxWJ = detailsW.createDiv({ cls: "imgmeta-prebox" });
          const taWJ = boxWJ.createEl("textarea", { cls: "imgmeta-textarea" });
          taWJ.setAttr("readonly", "true"); taWJ.setAttr("spellcheck", "false"); taWJ.setAttr("wrap", "off");
          taWJ.value = JSON.stringify(fields["workflow_json"], null, 2);
          copyWS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(taWJ.value ?? ""); };
          const exportW = detailsW.createEl("button", { text: "Export workflow.json" });
          exportW.onclick = async () => { await this.exportJson(file, "workflow", taWJ.value); };
        }

        const detailsRaw = container.createEl("details", { cls: "imgmeta-details" });
        const sumR = detailsRaw.createEl("summary");
        sumR.setText("Raw chunks (tEXt/iTXt/zTXt)");
        const rawBox = detailsRaw.createDiv({ cls: "imgmeta-prebox" });
        const rawTa = rawBox.createEl("textarea", { cls: "imgmeta-textarea" });
        rawTa.setAttr("readonly", "true"); rawTa.setAttr("spellcheck", "false"); rawTa.setAttr("wrap", "off");
        rawTa.value = JSON.stringify(meta.raw, null, 2);
        const rawCopyS = sumR.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
        rawCopyS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(rawTa.value ?? ""); };
      } else {
        const isA1111 = (typeof (meta.fields as any)["parameters_raw"] === "string") || (meta.raw && typeof meta.raw["parameters"] === "string");
        let btn: HTMLButtonElement;
        let ta: HTMLTextAreaElement;
        if (isA1111) {
          const header = container.createDiv({ cls: "imgmeta-header" });
          header.createEl("h4", { text: "Parameters" });
          btn = header.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          ta = container.createEl("textarea", { cls: "imgmeta-textarea" });
        } else {
          const ctr = container.createDiv({ cls: "imgmeta-controls" });
          btn = ctr.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
          ta = container.createEl("textarea", { cls: "imgmeta-textarea" });
        }
        ta.setAttr("readonly", "true");
        ta.setAttr("spellcheck", "false");
        ta.setAttr("wrap", "off");
        const a1111 = (typeof (meta.fields as any)["parameters_raw"] === "string")
          ? String((meta.fields as any)["parameters_raw"]) : null;
        const fallback = JSON.stringify(meta.fields, null, 2);
        ta.value = a1111 ?? meta.raw["parameters"] ?? fallback;
        btn.onclick = () => copyWithNotice(ta.value ?? "");

        const details = container.createEl("details", { cls: "imgmeta-details" });
        const sumD = details.createEl("summary");
        sumD.setText("Raw chunks (tEXt/iTXt/zTXt)");
        const pre2box = details.createDiv({ cls: "imgmeta-prebox" });
        const ta2 = pre2box.createEl("textarea", { cls: "imgmeta-textarea" });
        ta2.setAttr("readonly", "true");
        ta2.setAttr("spellcheck", "false");
        ta2.setAttr("wrap", "off");
        ta2.value = JSON.stringify(meta.raw, null, 2);
        const btn2 = sumD.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
        btn2.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyWithNotice(ta2.value ?? ""); };
      }
    } catch (e) {
      console.error(e);
      new Notice("Failed to read metadata");
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
}
