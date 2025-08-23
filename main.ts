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
                const target = await this.resolveTargetForView(file ?? null);
                const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMETA);
                if (target) {
                    if (leaves.length === 0) {
                        await this.activateView();
                    }
                }
                const updateLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_IMGMETA);
                for (const leaf of updateLeaves) {
                    if (leaf.view instanceof ImageMetaView) {
                        await (leaf.view as ImageMetaView).renderForFile(target);
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

        // Removed markdown overlay/click behaviors for embedded images to avoid
        // altering default interactions in Markdown views.
    }

    onunload() { }

    private isImage(file: TFile) {
        const ext = file.extension.toLowerCase();
        return ["png", "jpg", "jpeg", "webp"].includes(ext);
    }

    // If a markdown file has exactly one embedded image, resolve it; otherwise null.
    private async resolveTargetForView(file: TFile | null): Promise<TFile | null> {
        if (!file) return null;
        if (this.isImage(file)) return file;
        const ext = file.extension.toLowerCase();
        if (ext !== "md") return null;
        try {
            const cache = this.app.metadataCache.getFileCache(file);
            const candidates: TFile[] = [];
            const pushIfImage = (link: string | undefined) => {
                if (!link) return;
                const dest = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
                if (dest && dest instanceof TFile && this.isImage(dest)) candidates.push(dest);
            };
            // Only consider embeds (e.g., ![[...]] or ![...](...)) which render images
            if (cache?.embeds) {
                for (const e of cache.embeds) pushIfImage((e as any).link);
            }
            // Deduplicate by path
            const uniq = Array.from(new Map(candidates.map(f => [f.path, f])).values());
            if (uniq.length === 1) return uniq[0];
        } catch { /* ignore */ }
        return null;
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
