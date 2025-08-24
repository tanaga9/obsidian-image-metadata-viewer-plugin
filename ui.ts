import { App, Modal, TFile, Setting, Notice } from "obsidian";
import type { ImageMeta } from "./parser";

async function copyToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        new Notice("Copied");
    } catch (e) {
        console.error(e);
        new Notice("Copy failed");
    }
}

export class ImageMetaModal extends Modal {
    constructor(app: App, private file: TFile, private meta: ImageMeta) { super(app); }

    onOpen() {
        const { contentEl } = this;
        this.titleEl.setText(`Image Metadata: ${this.file.name}`);

        const fields: any = this.meta.fields as any;
        const isComfy = fields && (fields["generator"] === "ComfyUI" || fields["prompt_json"] || fields["workflow_json"]);

        if (isComfy) {
            // Prompts (if available)
            const pos = typeof fields["prompt"] === "string" ? String(fields["prompt"]) : null;
            const neg = typeof fields["negative_prompt"] === "string" ? String(fields["negative_prompt"]) : null;
            if (pos) {
                const headerP = contentEl.createDiv({ cls: "imgmeta-header" });
                headerP.createEl("h4", { text: "Positive Prompt" });
                const copyP = headerP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
                const taP = contentEl.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
                taP.setAttr("readonly", "true"); taP.setAttr("spellcheck", "false"); taP.setAttr("wrap", "soft"); taP.value = pos;
                copyP.onclick = () => copyToClipboard(taP.value ?? "");
            }
            if (neg) {
                const headerN = contentEl.createDiv({ cls: "imgmeta-header" });
                headerN.createEl("h4", { text: "Negative Prompt" });
                const copyN = headerN.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
                const taN = contentEl.createEl("textarea", { cls: "imgmeta-textarea imgmeta-textarea--prompt" });
                taN.setAttr("readonly", "true"); taN.setAttr("spellcheck", "false"); taN.setAttr("wrap", "soft"); taN.value = neg;
                copyN.onclick = () => copyToClipboard(taN.value ?? "");
            }

            // Prompt JSON
            if (fields["prompt_json"]) {
                const detailsP = contentEl.createEl("details", { cls: "imgmeta-details" });
                const sumP = detailsP.createEl("summary");
                sumP.setText("Prompt JSON");
                // Copy in summary so it works when collapsed
                const copyPS = sumP.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
                const boxPJ = detailsP.createDiv({ cls: "imgmeta-prebox" });
                const taPJ = boxPJ.createEl("textarea", { cls: "imgmeta-textarea" });
                taPJ.setAttr("readonly", "true"); taPJ.setAttr("spellcheck", "false"); taPJ.setAttr("wrap", "soft");
                taPJ.value = JSON.stringify(fields["prompt_json"], null, 2);
                copyPS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyToClipboard(taPJ.value ?? ""); };
                // Export button
                new Setting(detailsP).addButton((b) => b.setButtonText("Export prompt.json").onClick(async () => {
                    await this.exportJson("prompt", JSON.stringify(fields["prompt_json"], null, 2));
                }));
            }

            // Workflow JSON
            if (fields["workflow_json"]) {
                const detailsW = contentEl.createEl("details", { cls: "imgmeta-details" });
                const sumW = detailsW.createEl("summary");
                sumW.setText("Workflow JSON");
                const copyWS = sumW.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
                const boxWJ = detailsW.createDiv({ cls: "imgmeta-prebox" });
                const taWJ = boxWJ.createEl("textarea", { cls: "imgmeta-textarea" });
                taWJ.setAttr("readonly", "true"); taWJ.setAttr("spellcheck", "false"); taWJ.setAttr("wrap", "soft");
                taWJ.value = JSON.stringify(fields["workflow_json"], null, 2);
                copyWS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyToClipboard(taWJ.value ?? ""); };
                new Setting(detailsW).addButton((b) => b.setButtonText("Export workflow.json").onClick(async () => {
                    await this.exportJson("workflow", JSON.stringify(fields["workflow_json"], null, 2));
                }));
            }

            // Raw chunks
            const detailsRaw = contentEl.createEl("details", { cls: "imgmeta-details" });
            const sumR = detailsRaw.createEl("summary");
            sumR.setText("Raw chunks (tEXt/iTXt/zTXt)");
            const rawBox = detailsRaw.createDiv({ cls: "imgmeta-prebox" });
            const rawTa = rawBox.createEl("textarea", { cls: "imgmeta-textarea" });
            rawTa.setAttr("readonly", "true"); rawTa.setAttr("spellcheck", "false"); rawTa.setAttr("wrap", "soft");
            rawTa.value = JSON.stringify(this.meta.raw, null, 2);
            const rawCopyS = sumR.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
            rawCopyS.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyToClipboard(rawTa.value ?? ""); };
            return;
        }

        // Default (non-Comfy or no structured data): show parameters if available, else fields JSON
        const isA1111 = (typeof (this.meta.fields as any)["parameters_raw"] === "string") || (this.meta.raw && typeof this.meta.raw["parameters"] === "string");
        let btn: HTMLButtonElement;
        let ta: HTMLTextAreaElement;
        if (isA1111) {
            const header = contentEl.createDiv({ cls: "imgmeta-header" });
            header.createEl("h4", { text: "Parameters" });
            btn = header.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
            ta = contentEl.createEl("textarea", { cls: "imgmeta-textarea" });
        } else {
            const ctr = contentEl.createDiv({ cls: "imgmeta-controls" });
            btn = ctr.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
            ta = contentEl.createEl("textarea", { cls: "imgmeta-textarea" });
        }
        ta.setAttr("readonly", "true");
        ta.setAttr("spellcheck", "false");
        ta.setAttr("wrap", "soft");
        const a1111 = (typeof (this.meta.fields as any)["parameters_raw"] === "string")
            ? String((this.meta.fields as any)["parameters_raw"]) : null;
        const fallback = JSON.stringify(this.meta.fields, null, 2);
        ta.value = a1111 ?? this.meta.raw["parameters"] ?? fallback;
        btn.onclick = () => copyToClipboard(ta.value ?? "");

        // Removed redundant Copy JSON/Copy raw buttons; per-section Copy covers use-cases.

        const details = contentEl.createEl("details", { cls: "imgmeta-details" });
        const sumD = details.createEl("summary");
        sumD.setText("Raw chunks (tEXt/iTXt/zTXt)");
        const pre2box = details.createDiv({ cls: "imgmeta-prebox" });
        const ta2 = pre2box.createEl("textarea", { cls: "imgmeta-textarea" });
        ta2.setAttr("readonly", "true");
        ta2.setAttr("spellcheck", "false");
        ta2.setAttr("wrap", "soft");
        ta2.value = JSON.stringify(this.meta.raw, null, 2);
        const btn2 = sumD.createEl("button", { cls: "imgmeta-inline-btn", text: "Copy" });
        btn2.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); copyToClipboard(ta2.value ?? ""); };
    }

    private async exportJson(kind: "prompt" | "workflow", content: string) {
        try {
            const base = this.file.basename;
            const folder = this.file.parent?.path ?? "";
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
