import { FileManager, Notice, Plugin, TFile, TFolder } from "obsidian"
import { AttachomationSettingTab } from "settings"

interface AttachomationSettings {
	journalFolder: string;
	attachmentsFolder: string;
	journalAttachmentsFolder: string;
}

const DEFAULT_SETTINGS: AttachomationSettings = {
	journalFolder: "Journal",
	attachmentsFolder: "Attachments",
	journalAttachmentsFolder: "Framework/Attachments/Journal"
}

export default class Attachomation extends Plugin {
	settings: AttachomationSettings
	fileManager: FileManager

	async onload() {
		await this.loadSettings()
		this.addSettingTab(new AttachomationSettingTab(this.app, this))

		this.addRibbonIcon("workflow", "Attachomation", async (evt: MouseEvent) => {
			await this.attachomation()
		})

		this.addCommand({
			id: "run-attachomation",
			name: "Run Attachomation",
			callback: async () => {
				await this.attachomation()
			}
		})

		this.fileManager = new FileManager(this.app)
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	async getAttachments(entry: TFile) {
		const content = await this.app.vault.read(entry)
		const attachments = content.match(/!\[\[.*\]\]/g) ?? []
		return attachments
			.map(attachment => this.app.vault.getAbstractFileByPath(`${this.settings.attachmentsFolder}/${attachment.slice(3, -2)}`))
			.filter(file => file instanceof TFile)
	}

	async renameFile(file: TFile, folderPath: string, newFileName: string,) {
		try {
			await this.fileManager.renameFile(file, `${folderPath}/${newFileName}`)
		} catch {
			new Notice("Created missing folders for attachments.")
			await this.app.vault.createFolder(folderPath)
			await this.fileManager.renameFile(file, `${folderPath}/${newFileName}`)
		}
	}

	async attachomation() {
		new Notice("Running Attachomation 🚀")

		const journalFolder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder)
		if (!journalFolder || !(journalFolder instanceof TFolder)) {
			new Notice("Journal folder not found!")
			return
		}

		const journalEntries = journalFolder.children.filter((entry) => entry instanceof TFile) as TFile[]

		for (const entry of journalEntries) {
			const attachments = await this.getAttachments(entry)

			const date = new Date(entry.basename.split(".").reverse().join("-"))
			const month = (date.getMonth() + 1).toString().padStart(2, "0")
			const monthName = date.toLocaleString("en-US", { month: "long" })

			if (attachments) {
				for (let i = 0; i < attachments.length; i++) {
					if (!attachments[i]) return
					const attachmentCount = attachments.length > 1 ? " " + i + 1 : ""
					const folderPath = `${this.settings.journalAttachmentsFolder}/${date.getFullYear()}/${month} ${monthName}`
					const newFileName = `${entry.basename}${attachmentCount}.${attachments[i].extension}`
					await this.renameFile(attachments[i], folderPath, newFileName)
				}
			}

			const folderPath = `${this.settings.journalFolder}/${date.getFullYear()}/${month} ${monthName}`
			const newFileName = `${entry.basename}.md`
			await this.renameFile(entry, folderPath, newFileName)
		}

		new Notice("Attachomation complete ✅")
	}
}
