import { App, Modal, TFile, Setting } from "obsidian";
import type { ImageMeta } from "./parser";

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
}

export class ImageMetaModal extends Modal {
    constructor(app: App, private file: TFile, private meta: ImageMeta) { super(app); }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(`Image Metadata: ${this.file.name}`);

        const box = contentEl.createDiv({ cls: "imgmeta-prebox" });
        const btn = box.createEl("button", { cls: "imgmeta-copy", text: "Copy" });
        const ta = box.createEl("textarea", { cls: "imgmeta-textarea" });
        ta.setAttr("readonly", "true");
        ta.setAttr("spellcheck", "false");
        ta.setAttr("wrap", "off");
        ta.value = JSON.stringify(this.meta.fields, null, 2);
        btn.onclick = () => copyToClipboard(ta.value ?? "");

        new Setting(contentEl)
            .addButton((b) => b.setButtonText("Copy JSON").onClick(() => {
                copyToClipboard(JSON.stringify(this.meta.fields, null, 2));
            }))
            .addButton((b) => b.setButtonText("Copy raw").onClick(() => {
                copyToClipboard(JSON.stringify(this.meta.raw, null, 2));
            }));

        const details = contentEl.createEl("details", { cls: "imgmeta-details" });
        details.createEl("summary", { text: "Raw chunks (tEXt/iTXt/zTXt)" });
        const pre2box = details.createDiv({ cls: "imgmeta-prebox" });
        const btn2 = pre2box.createEl("button", { cls: "imgmeta-copy", text: "Copy" });
        const ta2 = pre2box.createEl("textarea", { cls: "imgmeta-textarea" });
        ta2.setAttr("readonly", "true");
        ta2.setAttr("spellcheck", "false");
        ta2.setAttr("wrap", "off");
        ta2.value = JSON.stringify(this.meta.raw, null, 2);
        btn2.onclick = () => copyToClipboard(ta2.value ?? "");
    }
}
