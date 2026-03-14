import { App, TFile } from "obsidian"

function isImageExt(ext: string): boolean {
	return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(
		ext.toLowerCase(),
	)
}

function isVideoExt(ext: string): boolean {
	return ["mp4", "webm", "mov", "m4v"].includes(ext.toLowerCase())
}

export async function replaceEmbedsWithUrls(
	app: App,
	note: TFile,
	fileUrlMap: Map<string, string>,
): Promise<void> {
	const cache = app.metadataCache.getFileCache(note)
	let content = await app.vault.read(note)

	// Use positions if embeds exist; fall back to simple replacement
	const embeds = cache?.embeds ?? []
	if (embeds.length > 0) {
		// Replace from end to start to keep positions valid
		const sorted = embeds
			.slice()
			.sort((a, b) => b.position.start.offset - a.position.start.offset)
		for (const e of sorted) {
			const start = trimBlankLinesAboveEmbed(content, e.position.start.offset)
			const link = e.link // could be path or basename
			const targetPath = resolveTargetPath(app, note, link)
			if (!targetPath) continue
			const url = fileUrlMap.get(targetPath)
			if (!url) continue
			const ext = (targetPath.split(".").pop() || "").toLowerCase()
			const isImage = isImageExt(ext)
			const isVideo = isVideoExt(ext)
			const replacement = isImage
				? `![${link}](${url})`
				: isVideo
					? `<video src="${url}" controls preload="metadata" style="max-width: 100%"></video>`
					: `[${link}](${url})`
			content = spliceContent(
				content,
				start,
				e.position.end.offset,
				replacement,
			)
		}
	} else {
		// Fallback: replace wikilinks matching keys
		for (const [path, url] of fileUrlMap.entries()) {
			const base = path.split("/").pop()!
			const pattern = new RegExp(
				`!\\\\?\\\\[\\\\[(${escapeRegex(base)}|${escapeRegex(path)})\\\\]\\\\]`,
				"g",
			)
			const ext = (base.split(".").pop() || "").toLowerCase()
			const isImage = isImageExt(ext)
			const isVideo = isVideoExt(ext)
			const replacement = isImage
				? `![$1](${url})`
				: isVideo
					? `<video src="${url}" controls preload="metadata" style="max-width: 100%"></video>`
					: `[$1](${url})`
			content = content.replace(pattern, replacement)
		}
	}

	await app.vault.modify(note, content)
}


function trimBlankLinesAboveEmbed(content: string, start: number): number {
	const before = content.slice(0, start)
	const trimmed = before.replace(/(?:\r?\n[\t ]*){2,}$/, "\n")
	return trimmed.length
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function spliceContent(
	src: string,
	start: number,
	end: number,
	insert: string,
): string {
	return src.slice(0, start) + insert + src.slice(end)
}

function resolveTargetPath(
	app: App,
	note: TFile,
	link: string,
): string | undefined {
	// Obsidian resolves links relative to the note
	const resolved = app.metadataCache.getFirstLinkpathDest(link, note.path)
	return resolved?.path
}
