import { App, Modal, Setting } from "obsidian"

export class FileApprovalModal extends Modal {
	constructor(app: App, file: string, onSubmit: (approved: boolean) => void) {
		super(app)
		this.setTitle("File rename approval")
	
		const p = this.contentEl.createEl("p")
		p.appendText("The file \"")
		p.createEl("strong").setText(file)
		p.appendText("\" does not match the default format.")
	
		this.contentEl.createEl("p").setText("Do you want to proceed with the regular process or exclude the file from the automation and handle it yourself?")
	
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Exclude File")
					.setCta()
					.onClick(() => {
						this.close()
						onSubmit(false)
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Proceed")
					.setCta()
					.onClick(() => {
						this.close()
						onSubmit(true)
					})
			)
	}
}
