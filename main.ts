import { App, Modal, Notice, Plugin, TFile, WorkspaceLeaf, addIcon } from "obsidian";
import { parseImageMeta } from "./parser";
import { ImageMetaModal } from "./ui";
import { ImageMetaView, VIEW_TYPE_IMGMETA } from "./view";

const ICON_ID = "imgmeta-icon";

addIcon(ICON_ID, `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 4h16v16H4z" fill="none" stroke="currentColor"/><path d="M7 10h10M7 14h6" stroke="currentColor"/></svg>`);

export default class ImageMetadataViewerPlugin extends Plugin {
    async onload() {
        // Register persistent right sidebar view
        this.registerView(
            VIEW_TYPE_IMGMETA,
            (leaf) => new ImageMetaView(leaf, this.app)
        );

        // Ribbon: open modal (generic label)
        this.addRibbonIcon(ICON_ID, "Show image metadata (modal)", async () => {
            await this.showCurrentFileMetadata();
        });

        // Command: open modal for current file
        this.addCommand({
            id: "imgmeta-show-modal",
            name: "Show metadata for current file (Modal)",
            callback: async () => this.showCurrentFileMetadata()
        });

        // Command: open/focus right sidebar view
        this.addCommand({
            id: "imgmeta-open-side-view",
            name: "Open right sidebar metadata view",
            callback: () => this.activateView()
        });

        // Update right pane when file changes (use public API)
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMETA);
                if (file && file instanceof TFile && this.isImage(file)) {
                    // Auto-open the view if not present
                    if (leaves.length === 0) {
                        await this.activateView();
                    }
                }
                const updateLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMETA);
                for (const leaf of updateLeaves) {
                    if (leaf.view instanceof ImageMetaView) {
                        await (leaf.view as ImageMetaView).renderForFile(file ?? null);
                    }
                }
            })
        );

        // File menu item
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && this.isImage(file)) {
                    // Open modal
                    menu.addItem((item) =>
                        item
                            .setTitle("Show image metadata")
                            .setIcon(ICON_ID)
                            .onClick(async () => this.openForFile(file))
                    );
                    // Open right sidebar view
                    menu.addItem((item) =>
                        item
                            .setTitle("Show image metadata (right sidebar)")
                            .setIcon(ICON_ID)
                            .onClick(async () => this.activateView(file))
                    );
                }
            })
        );

        // Make embedded images clickable to open right view
        this.registerMarkdownPostProcessor((el, ctx) => {
            const attach = (target: HTMLElement, linkpath: string | null) => {
                if (!linkpath) return;
                const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
                if (!dest || !(dest instanceof TFile) || !this.isImage(dest)) return;
                target.addEventListener("click", async (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    await this.activateView(dest);
                });
                target.addClass("imgmeta-clickable");
                target.setAttr("title", "Show image metadata on right");
            };

            // Internal embeds and image embeds generally carry a src attribute we can resolve
            el.querySelectorAll<HTMLElement>("span.internal-embed, span.image-embed").forEach((span) => {
                const src = span.getAttr("src") || span.getAttribute("src") || span.getAttribute("data-src");
                attach(span, src);
            });

            // Fallback: raw <img> tags (standard Markdown images)
            el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
                const parent = img.closest<HTMLElement>("span.internal-embed, span.image-embed");
                if (parent) return; // already handled above
                // Some themes add data-src with vault-relative path
                const linkpath = (img.getAttribute("data-src") || img.getAttribute("src") || "").trim();
                // If src is an app:// resource, we likely can't resolve; rely on data-src when present
                if (linkpath && !linkpath.startsWith("app://")) {
                    attach(img, linkpath);
                }
            });
        });
    }

    onunload() { }

    private isImage(file: TFile) {
        const ext = file.extension.toLowerCase();
        return ["png", "jpg", "jpeg", "webp"].includes(ext);
    }

    private async showCurrentFileMetadata() {
        const file = this.app.workspace.getActiveFile();
        if (!file) return new Notice("No active file");
        if (!(file instanceof TFile) || !this.isImage(file)) return new Notice("Not an image file");
        await this.openForFile(file);
    }

    private async openForFile(file: TFile) {
        try {
            const buf = await this.app.vault.adapter.readBinary(file.path);
            const meta = await parseImageMeta(buf, file.extension.toLowerCase());
            new ImageMetaModal(this.app, file, meta).open();
        } catch (e) {
            console.error(e);
            new Notice("Failed to read metadata");
        }
    }

    async activateView(file?: TFile) {
        let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMETA)[0];
        if (!leaf) {
            leaf = this.app.workspace.getRightLeaf(false);
        }
        if (!leaf) return;
        await leaf.setViewState({ type: VIEW_TYPE_IMGMETA, active: true });
        this.app.workspace.revealLeaf(leaf);
        const activeOrProvided = file ?? this.app.workspace.getActiveFile();
        if (leaf.view instanceof ImageMetaView) {
            await (leaf.view as ImageMetaView).renderForFile(activeOrProvided ?? null);
        }
    }
    // Removed private DOM traversal helper; using workspace.getLeavesOfType instead
}
