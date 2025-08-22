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

      const box = container.createDiv({ cls: "imgmeta-prebox" });
      const btn = box.createEl("button", { cls: "imgmeta-copy", text: "Copy" });
      const ta = box.createEl("textarea", { cls: "imgmeta-textarea" });
      ta.setAttr("readonly", "true");
      ta.setAttr("spellcheck", "false");
      ta.setAttr("wrap", "off");
      const a1111 = (typeof (meta.fields as any)["parameters_raw"] === "string")
        ? String((meta.fields as any)["parameters_raw"]) : null;
      const fallback = JSON.stringify(meta.fields, null, 2);
      ta.value = a1111 ?? meta.raw["parameters"] ?? fallback;
      btn.onclick = () => copyWithNotice(ta.value ?? "");

      const details = container.createEl("details", { cls: "imgmeta-details" });
      details.createEl("summary", { text: "Raw chunks (tEXt/iTXt/zTXt)" });
      const pre2box = details.createDiv({ cls: "imgmeta-prebox" });
      const btn2 = pre2box.createEl("button", { cls: "imgmeta-copy", text: "Copy" });
      const ta2 = pre2box.createEl("textarea", { cls: "imgmeta-textarea" });
      ta2.setAttr("readonly", "true");
      ta2.setAttr("spellcheck", "false");
      ta2.setAttr("wrap", "off");
      ta2.value = JSON.stringify(meta.raw, null, 2);
      btn2.onclick = () => copyWithNotice(ta2.value ?? "");
    } catch (e) {
      console.error(e);
      new Notice("Failed to read metadata");
    }
  }
}
