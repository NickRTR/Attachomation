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

		const folders = this.plugin.app.vault.getAllFolders().map(folder => folder.path)

		new Setting(this.containerEl)
			.setName("Journal Folder")
			.setDesc("The parent folder where your journal entries are stored.")
			.addSearch((search) => {
				new FolderSuggest(this.app, search.inputEl)
				search.setPlaceholder("Select a folder")
					.setValue(this.plugin.settings.journalFolder)
					.onChange(async value => {
						this.plugin.settings.journalFolder = folders[value]
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
						this.plugin.settings.attachmentsFolder = folders[value]
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
						this.plugin.settings.journalAttachmentsFolder = folders[value]
						await this.plugin.saveSettings()
					})
			})
	}
}
