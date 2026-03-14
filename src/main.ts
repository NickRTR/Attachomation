import { FileManager, Notice, Plugin, TFile, TFolder } from "obsidian"
import { AttachomationSettingTab } from "src/settings/settings"
import { FileApprovalModal } from "src/modals"
import { replaceEmbedsWithUrls } from "./utils/linkReplace"
import { VpsClient } from "./utils/vpsClient"

interface AttachomationSettings {
	journalFolder: string;
	attachmentsFolder: string;
	journalAttachmentsFolder: string;
	journalRecordingsFolder: string;
	vpsEndpointUrl?: string;
	vpsAuthToken?: string;
}

const DEFAULT_SETTINGS: AttachomationSettings = {
	journalFolder: "1. Journal",
	attachmentsFolder: "0. Framework/Attachments",
	journalAttachmentsFolder: "0. Framework/Attachments/1. Journal",
	journalRecordingsFolder: "0. Framework/Attachments/1. Journal/Recordings",
}

export default class Attachomation extends Plugin {
	settings: AttachomationSettings
	fileManager: FileManager
	vps?: VpsClient
	statusEl?: HTMLElement

	setStatus(text: string) {
		if (!this.statusEl) return
		const el: HTMLElement = this.statusEl
		if (typeof el.setText === "function") el.setText(text)
		else this.statusEl.textContent = text
	}

	clearStatus(delayMs = 4000) {
		if (!this.statusEl) return
		setTimeout(() => {
			this.setStatus("")
		}, delayMs)
	}

	async ensureFolder(folderPath: string) {
		const parts = folderPath.split("/").filter(Boolean)
		let current = ""
		for (const part of parts) {
			current = current ? `${current}/${part}` : part
			const exists = this.app.vault.getAbstractFileByPath(current)
			if (!exists) {
				try {
					await this.app.vault.createFolder(current)
				} catch (err) {
					const msg = (err as { message?: string })?.message || ""
					if (!/already exists/i.test(msg)) {
						throw err
					}
				}
			}
		}
	}

	async onload() {
		await this.loadSettings()
		this.addSettingTab(new AttachomationSettingTab(this.app, this))

		this.statusEl = this.addStatusBarItem()

		this.addRibbonIcon("workflow", "Attachomation", async () => {
			await this.attachomation()
		})

		this.addCommand({
			id: "run-attachomation",
			name: "Run Attachomation",
			callback: async () => {
				await this.attachomation()
			},
		})

		this.addCommand({
			id: "backfill-vps-uploads",
			name: "Backfill VPS uploads for managed entries",
			callback: async () => {
				await this.backfillVpsUploads()
			},
		})

		this.fileManager = this.app.fileManager
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		)
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	async getAttachments(entry: TFile, content: string) {
		const attachments: TFile[] = []
		const recordings: TFile[] = []

		const isNamedAttachment = (file: TFile) =>
			file.basename.match(/^[A-Za-z]{3}_\d+$/)

		const isPastedAttachment = (file: TFile) =>
			file.basename.match(/^Pasted .+/i)
		
		const isRecording = (file: TFile) =>
			file.name.match(/^Recording .+\.m4a$/)

		const askApproval = (file: TFile) =>
			new Promise<void>((resolve) => {
				new FileApprovalModal(this.app, file.name, (approved) => {
					if (approved) attachments.push(file)
					resolve()
				}).open()
			})

		const handleFile = async (file: TFile) => {			
			if (isNamedAttachment(file) || isPastedAttachment(file)) attachments.push(file)
			else if (isRecording(file)) recordings.push(file)
			else await askApproval(file)
		}

		const wikiEmbeds = [...(content.match(/!\[\[[^\]]+\]\]/g) ?? [])]
		for (const raw of wikiEmbeds) {
			const inner = raw.slice(3, -2) // strip ![[ and ]]
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				inner,
				entry.path,
			)
			if (resolved instanceof TFile) {
				await handleFile(resolved)
			}
		}

		const mdEmbeds = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
		for (const m of mdEmbeds) {
			const href = m[1]
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				href || "",
				entry.path,
			)
			if (resolved && resolved instanceof TFile) {
				await handleFile(resolved)
			}
		}

		return { attachments, recordings }
	}

	getAllFilesInFolder(folder: TFolder): TFile[] {
		const files: TFile[] = []
		const stack = [...folder.children]
		while (stack.length > 0) {
			const item = stack.pop()
			if (!item) continue
			if (item instanceof TFile) files.push(item)
			else if (item instanceof TFolder) stack.push(...item.children)
		}
		return files
	}

	async getEmbeddedLocalFiles(
		entry: TFile,
		content?: string,
	): Promise<TFile[]> {
		const filesByPath = new Map<string, TFile>()
		const addLink = (link?: string) => {
			if (!link) return
			if (/^https?:\/\//i.test(link)) return
			const resolved = this.app.metadataCache.getFirstLinkpathDest(
				link,
				entry.path,
			)
			if (resolved && resolved instanceof TFile) {
				filesByPath.set(resolved.path, resolved)
			}
		}

		const cache = this.app.metadataCache.getFileCache(entry)
		if (cache?.embeds && cache.embeds.length > 0) {
			for (const e of cache.embeds) addLink(e.link)
			return [...filesByPath.values()]
		}

		const text = content ?? (await this.app.vault.read(entry))
		const wikiEmbeds = [...(text.match(/!\[\[[^\]]+\]\]/g) ?? [])]
		for (const raw of wikiEmbeds) {
			const inner = raw.slice(3, -2)
			addLink(inner)
		}
		const mdEmbeds = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
		for (const m of mdEmbeds) addLink(m[1])

		return [...filesByPath.values()]
	}

	async renameFile(file: TFile, folderPath: string, newFileName: string) {
		const targetPath = `${folderPath}/${newFileName}`
		try {
			await this.fileManager.renameFile(file, targetPath)
			this.removeLinkUpdatedNotice()
		} catch (error) {
			const code = error?.code
			if (code === "ENOENT") {
				await this.ensureFolder(folderPath)
				try {
					await this.fileManager.renameFile(file, targetPath)
				} catch {
					return
				}
			} else {
				return
			}
		}
		const moved = this.app.vault.getAbstractFileByPath(targetPath)
		if (moved && moved instanceof TFile) return moved
		return
	}

	removeLinkUpdatedNotice() {
		const notices = document.querySelectorAll(".notice")
		notices.forEach((notice) => {
			if (notice.textContent === "Updated 1 link in 1 file.") {
				notice.remove()
			}
		})
	}

	formatBytes(bytes: number) {
		if (bytes <= 0) return "0 MB"
		const gb = 1024 ** 3
		const mb = 1024 ** 2
		if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`
		return `${(bytes / mb).toFixed(2)} MB`
	}

	async attachomation() {
		new Notice("Running Attachomation 🚀")
		this.initVpsClient()

		const journalFolder = this.app.vault.getAbstractFileByPath(
			this.settings.journalFolder,
		)
		let journalEntries: TFile[] = []
		if (!journalFolder || !(journalFolder instanceof TFolder)) {
			new Notice("Journal folder not found!")
		} else {
			journalEntries = journalFolder.children.filter(
				(entry) => entry instanceof TFile,
			) as TFile[]
		}

		let managedEntries = 0
		let managedAttachments = 0
		let managedRecordings = 0

		const entriesData: Array<{
			entry: TFile;
			attachments: TFile[];
			recordings: TFile[];
			date: Date;
			month: string;
			monthName: string;
			day: string;
		}> = []
		let totalAttachments = 0
		for (const entry of journalEntries) {
			if (!entry.basename.match(/^\d{2}\.\d{2}\.\d{4}$/)) continue
			const content = await this.app.vault.read(entry)
			if (content.includes("tp.file.cursor")) continue
			const { attachments, recordings } = await this.getAttachments(
				entry,
				content,
			)
			const date = new Date(
				entry.basename.split(".").reverse().join("-"),
			)
			const month = (date.getMonth() + 1).toString().padStart(2, "0")
			const monthName = date.toLocaleString("en-US", { month: "long" })
			const day = date.getDate().toString().padStart(2, "0")
			entriesData.push({
				entry,
				attachments,
				recordings,
				date,
				month,
				monthName,
				day,
			})
			totalAttachments += attachments.length
		}

		let uploadedCount = 0
		let uploadedBytes = 0

		try {
			const getPercent = () =>
				totalAttachments
					? Math.floor((uploadedCount / totalAttachments) * 100)
					: 100
			const updateStatus = () =>
				this.setStatus(`🚀 Attachomation: ${getPercent()}%`)

			for (const data of entriesData) {
				const {
					entry,
					attachments,
					recordings,
					date,
					month,
					monthName,
					day,
				} = data
				if (!entry.basename.match(/^\d{2}\.\d{2}\.\d{4}$/)) continue

				if (attachments && attachments.length) {
					const attachmentsDest = `${this.settings.journalAttachmentsFolder}/${date.getFullYear()}/${month} ${monthName}`
					await this.ensureFolder(attachmentsDest)
					const movedAttachments: TFile[] = []

					for (let i = 0; i < attachments.length; i++) {
						const file = attachments[i]
						if (!file) continue
						const attachmentCount =
							attachments.length > 1 ? ` ${i + 1}` : ""
						const newFileName = `${entry.basename}${attachmentCount}.${file.extension}`
						const moved = await this.renameFile(
							file,
							attachmentsDest,
							newFileName,
						)
						if (moved) {
							managedAttachments++
							movedAttachments.push(moved)
						}
					}

					if (movedAttachments.length) {
						const uploadedMap = new Map<string, string>()
						if (!this.vps) {
							new Notice(
								"VPS upload not configured. Attachomation aborted for this entry.",
							)
							return
						}
						updateStatus()
						for (const file of movedAttachments) {
							const remoteDir = `/${date.getFullYear()}/${month}/${day}`
							updateStatus()
							try {
								const { url } = await this.vps.uploadFile(
									file,
									remoteDir,
									file.name,
								)
								uploadedMap.set(file.path, url)
								uploadedBytes += file.stat.size
								uploadedCount++
								updateStatus()
							} catch (e) {
								console.error("VPS upload error", e)
								new Notice(
									`Upload failed for ${file.name} in ${entry.basename}. Attachomation aborted for this entry.`,
								)
								return
							}
						}

						if (uploadedMap.size > 0) {
							await replaceEmbedsWithUrls(
								this.app,
								entry,
								uploadedMap,
							)
						}
					}
				}

				if (recordings && recordings.length) {
					const recordingsDest = `${this.settings.journalRecordingsFolder}/${date.getFullYear()}/${month} ${monthName}`
					await this.ensureFolder(recordingsDest)
					for (let i = 0; i < recordings.length; i++) {
						const rec = recordings[i]
						if (!rec) continue
						const recordingCount =
							recordings.length > 1 ? ` ${i + 1}` : ""
						const newFileName = `${entry.basename}${recordingCount}.${rec.extension}`
						const moved = await this.renameFile(
							rec,
							recordingsDest,
							newFileName,
						)
						if (moved) managedRecordings++
					}
				}

				const folderPath = `${this.settings.journalFolder}/${date.getFullYear()}/${month} ${monthName}`
				const newFileName = `${entry.basename}.md`
				const moved = await this.renameFile(
					entry,
					folderPath,
					newFileName,
				)
				if (moved) managedEntries++
			}
		} finally {
			new Notice(
				`Attachomation complete ✅\n\nManaged journal entries: ${managedEntries}\nManaged attachments: ${managedAttachments}\nManaged recordings: ${managedRecordings}\nUploaded media: ${this.formatBytes(uploadedBytes)}`,
				10000,
			)
			this.clearStatus()
		}
	}

	async backfillVpsUploads() {
		new Notice("Backfilling VPS uploads 🚀")
		this.initVpsClient()
		if (!this.vps) {
			new Notice("VPS upload not configured. Backfill aborted.")
			return
		}

		const journalFolder = this.app.vault.getAbstractFileByPath(
			this.settings.journalFolder,
		)
		if (!journalFolder || !(journalFolder instanceof TFolder)) {
			new Notice("Journal folder not found!")
			return
		}

		const isInManagedYearFolder = (entry: TFile) => {
			const base = journalFolder.path.replace(/\/+$/, "")
			if (!entry.path.startsWith(`${base}/`)) return false
			const relative = entry.path.slice(base.length + 1)
			const firstSegment = relative.split("/")[0]
			return /^\d{4}$/.test(firstSegment || "")
		}

		const journalEntries = this.getAllFilesInFolder(journalFolder).filter(
			(entry) =>
				entry.basename.match(/^\d{2}\.\d{2}\.\d{4}$/) &&
				isInManagedYearFolder(entry),
		)

		const entriesData: Array<{
			entry: TFile;
			files: TFile[];
			date: Date;
			month: string;
			day: string;
		}> = []
		let totalFiles = 0

		const isBackfillMedia = (file: TFile) =>
			/^\d{2}\.\d{2}\.\d{4}( \d+)?$/.test(file.basename) &&
			file.extension.toLowerCase() !== "m4a"

		for (const entry of journalEntries) {
			const content = await this.app.vault.read(entry)
			if (content.includes("tp.file.cursor")) continue
			const files = (
				await this.getEmbeddedLocalFiles(entry, content)
			).filter(isBackfillMedia)
			if (!files.length) continue
			const date = new Date(
				entry.basename.split(".").reverse().join("-"),
			)
			if (Number.isNaN(date.getTime())) continue
			const month = (date.getMonth() + 1).toString().padStart(2, "0")
			const day = date.getDate().toString().padStart(2, "0")
			entriesData.push({ entry, files, date, month, day })
			totalFiles += files.length
		}

		let uploadedCount = 0
		let uploadedBytes = 0
		let failedUploads = 0
		let updatedEntries = 0
		let processedEntries = 0
		const uploadedUrlByPath = new Map<string, string>()

		const updateStatus = () =>
			this.setStatus(
				`☁️ Backfill uploads: ${uploadedCount}/${totalFiles || 0}`,
			)
		updateStatus()

		try {
			for (const data of entriesData) {
				const { entry, files, date, month, day } = data
				processedEntries++
				const uploadedMap = new Map<string, string>()

				for (const file of files) {
					const cached = uploadedUrlByPath.get(file.path)
					if (cached) {
						uploadedMap.set(file.path, cached)
						continue
					}

					const remoteDir = `/${date.getFullYear()}/${month}/${day}`
					try {
						const { url } = await this.vps.uploadFile(
							file,
							remoteDir,
							file.name,
						)
						uploadedMap.set(file.path, url)
						uploadedUrlByPath.set(file.path, url)
						uploadedCount++
						uploadedBytes += file.stat.size
						updateStatus()
					} catch (e) {
						failedUploads++
						console.error("VPS upload error", e)
						console.error(
							`Failed to upload ${file.path} for entry ${entry.path}`,
						)
					}
				}

				if (uploadedMap.size > 0) {
					try {
						await replaceEmbedsWithUrls(
							this.app,
							entry,
							uploadedMap,
						)
						updatedEntries++
					} catch (e) {
						console.error("Failed to update note links", e)
					}
				}
			}
		} finally {
			new Notice(
				`Backfill complete ✅\n\nProcessed entries: ${processedEntries}\nUpdated entries: ${updatedEntries}\nUploaded files: ${uploadedCount}\nFailed uploads: ${failedUploads}\nUploaded media: ${this.formatBytes(uploadedBytes)}`,
				10000,
			)
			this.clearStatus()
		}
	}

	initVpsClient() {
		if (this.settings.vpsEndpointUrl) {
			this.vps = new VpsClient(this.app, {
				endpointUrl: this.settings.vpsEndpointUrl,
				authToken: this.settings.vpsAuthToken,
			})
		}
	}
}
