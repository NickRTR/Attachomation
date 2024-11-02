import { FileManager, Notice, Plugin, TFile, TFolder } from "obsidian"
import { AttachomationSettingTab } from "src/settings"
import { FileApprovalModal } from "src/modals"

interface AttachomationSettings {
	journalFolder: string;
	attachmentsFolder: string;
	journalAttachmentsFolder: string;
}

const DEFAULT_SETTINGS: AttachomationSettings = {
	journalFolder: "1. Journal",
	attachmentsFolder: "0. Framework/Attachments",
	journalAttachmentsFolder: "0. Framework/Attachments/Journal"
}

export default class Attachomation extends Plugin {
	settings: AttachomationSettings
	fileManager: FileManager

	async onload() {
		await this.loadSettings()
		this.addSettingTab(new AttachomationSettingTab(this.app, this))

		this.addRibbonIcon("workflow", "Attachomation", async () => {
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

	async getAttachments(content: string) {
		const attachments = content.match(/!\[\[.*\]\]/g) ?? []

		const validAttachments = []
		for (const attachment of attachments) {
			const file = this.app.vault.getAbstractFileByPath(`${this.settings.attachmentsFolder}/${attachment.slice(3, -2)}`)
			if (file instanceof TFile) {
				if (file.basename.match(/^[A-Za-z]{3}_\d+$/)) {
					validAttachments.push(file)
				} else {
					await new Promise((resolve) => {
						new FileApprovalModal(this.app, file.name, (approved) => {
							if (approved) validAttachments.push(file)
							resolve(true)
						}).open()
					})
				}
			}
		}
		return validAttachments
	}

	async renameFile(file: TFile, folderPath: string, newFileName: string,) {
		try {
			await this.fileManager.renameFile(file, `${folderPath}/${newFileName}`)
			this.removeLinkUpdatedNotice()
		} catch(error) {
			if (error.code === "ENOENT") {
				new Notice("Created missing folders for attachments.")
				await this.app.vault.createFolder(folderPath)
				await this.renameFile(file, folderPath, newFileName)
			} else {
				new Notice(`File "${file.basename}" has to be managed manually 🚨`, 10000)
			}
			return
		}
		return "success"
	}

	removeLinkUpdatedNotice() {
		const notices = document.querySelectorAll(".notice")
		notices.forEach(notice => {
			if (notice.innerText === "Updated 1 link in 1 file.") {
				notice.remove()
			}
		})
	}

	async attachomation() {
        new Notice("Running Attachomation 🚀")

        const journalFolder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder)
        if (!journalFolder || !(journalFolder instanceof TFolder)) {
            new Notice("Journal folder not found!")
            return
        }

        const journalEntries = journalFolder.children.filter((entry) => entry instanceof TFile) as TFile[]

        let managedAttachments = 0
        let managedEntries = 0

        for (const entry of journalEntries) {
            if (!entry.basename.match(/^\d{2}\.\d{2}\.\d{4}$/)) continue

			const content = await this.app.vault.read(entry)

			if (content.includes("tp.file.cursor")) continue

            const attachments = await this.getAttachments(content)

            const date = new Date(entry.basename.split(".").reverse().join("-"))
            const month = (date.getMonth() + 1).toString().padStart(2, "0")
            const monthName = date.toLocaleString("en-US", { month: "long" })

            if (attachments) {
                for (let i = 0; i < attachments.length; i++) {
                    if (!attachments[i]) return
                    const attachmentCount = attachments.length > 1 ? ` ${i + 1}` : ""
                    const folderPath = `${this.settings.journalAttachmentsFolder}/${date.getFullYear()}/${month} ${monthName}`
                    const newFileName = `${entry.basename}${attachmentCount}.${attachments[i].extension}`
                    const res = await this.renameFile(attachments[i], folderPath, newFileName)
                    if (res === "success") managedAttachments++
                }
            }

            const folderPath = `${this.settings.journalFolder}/${date.getFullYear()}/${month} ${monthName}`
            const newFileName = `${entry.basename}.md`
            const res = await this.renameFile(entry, folderPath, newFileName)
            if (res === "success") managedEntries++
        }

        new Notice(`Attachomation complete ✅\n\nManaged journal entries: ${managedEntries}\nManages attachments: ${managedAttachments}`)
    }
}
