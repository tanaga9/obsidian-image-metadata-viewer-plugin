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
      const pre = box.createEl("pre", { cls: "imgmeta-pre" });
      pre.textContent = JSON.stringify(meta.fields, null, 2);
      btn.onclick = () => navigator.clipboard.writeText(pre.textContent ?? "");

      const details = container.createEl("details", { cls: "imgmeta-details" });
      details.createEl("summary", { text: "Raw chunks (tEXt/iTXt/zTXt)" });
      const pre2box = details.createDiv({ cls: "imgmeta-prebox" });
      const btn2 = pre2box.createEl("button", { cls: "imgmeta-copy", text: "Copy" });
      const pre2 = pre2box.createEl("pre");
      pre2.textContent = JSON.stringify(meta.raw, null, 2);
      btn2.onclick = () => navigator.clipboard.writeText(pre2.textContent ?? "");
    } catch (e) {
      console.error(e);
      new Notice("Failed to read metadata");
    }
  }
}
