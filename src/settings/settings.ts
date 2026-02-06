import Attachomation from "@/main"
import { App, PluginSettingTab, Setting } from "obsidian"
import { FolderSuggest } from "./suggestionInput/folderSuggestion"

export class AttachomationSettingTab extends PluginSettingTab {
	plugin: Attachomation

	constructor(app: App, plugin: Attachomation) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const {containerEl} = this

		containerEl.empty()

		containerEl.createEl("h1", {text: "Attachomation Settings"})

		new Setting(this.containerEl)
			.setName("Journal Folder")
			.setDesc("The parent folder where your journal entries are stored.")
			.addSearch((search) => {
				new FolderSuggest(this.app, search.inputEl)
				search.setPlaceholder("Select a folder")
					.setValue(this.plugin.settings.journalFolder)
					.onChange(async value => {
						this.plugin.settings.journalFolder = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName("Attachments Folder")
			.setDesc("The folder where attachments are initially stored.")
			.addSearch((search) => {
				new FolderSuggest(this.app, search.inputEl)
				search.setPlaceholder("Select a folder")
					.setValue(this.plugin.settings.attachmentsFolder)
					.onChange(async value => {
						this.plugin.settings.attachmentsFolder = value
						await this.plugin.saveSettings()
					})
			})
		
		new Setting(containerEl)
			.setName("Journal Attachments Folder")
			.setDesc("The folder where attachments for the journal belong.")
			.addSearch((search) => {
				new FolderSuggest(this.app, search.inputEl)
				search.setPlaceholder("Select a folder")
					.setValue(this.plugin.settings.journalAttachmentsFolder)
					.onChange(async value => {
						this.plugin.settings.journalAttachmentsFolder = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName("Journal Recordings Folder")
			.setDesc("The folder where recordings for the journal belong.")
			.addSearch((search) => {
				new FolderSuggest(this.app, search.inputEl)
				search.setPlaceholder("Select a folder")
					.setValue(this.plugin.settings.journalRecordingsFolder)
					.onChange(async value => {
						this.plugin.settings.journalRecordingsFolder = value
						await this.plugin.saveSettings()
					})
			})

		containerEl.createEl("h2", { text: "Cloud Storage" })
		new Setting(containerEl)
			.setName("Upload Endpoint")
			.setDesc("Full URL to POST uploads (e.g. https://example.com/api/upload)")
			.addText(t => t
				.setPlaceholder("https://your-vps/api/upload")
				.setValue(this.plugin.settings.vpsEndpointUrl || "")
				.onChange(async v => {
					this.plugin.settings.vpsEndpointUrl = v.trim()
					await this.plugin.saveSettings()
				})
			)

		new Setting(containerEl)
			.setName("Auth Token")
			.setDesc("Bearer AUTH token")
			.addText(t => t
				.setPlaceholder("token")
				.setValue(this.plugin.settings.vpsAuthToken || "")
				.onChange(async v => {
					this.plugin.settings.vpsAuthToken = v
					await this.plugin.saveSettings()
				})
			)
	}
}
