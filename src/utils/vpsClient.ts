import { App, TFile } from "obsidian"

export interface VpsConfig {
	endpointUrl: string
	authToken?: string
}

export class VpsClient {
	private app: App
	private config: VpsConfig

	constructor(app: App, config: VpsConfig) {
		this.app = app
		this.config = config
	}

	async uploadFile(
		vaultFile: TFile,
		remoteDir: string,
		remoteFileName?: string,
	): Promise<{ url: string }> {
		const arrayBuf = await this.app.vault.readBinary(vaultFile)
		const blob = new Blob([arrayBuf])

		const form = new FormData()
		form.append("file", blob, remoteFileName ?? vaultFile.name)
		form.append("dir", remoteDir) // e.g. /YYYY/MM/DD
		if (remoteFileName) form.append("filename", remoteFileName)

		const headers: Record<string, string> = {}
		if (this.config.authToken) headers["Authorization"] = `Bearer ${this.config.authToken}`

		const resp = await fetch(this.config.endpointUrl, {
			method: "POST",
			headers,
			body: form,
		})
		if (!resp.ok) {
			const text = await resp.text().catch(() => "")
			throw new Error(`VPS upload failed: ${resp.status} ${text}`)
		}
		const data = await resp.json().catch(() => ({}))
		const url = data.url as string | undefined
		return { url: url || "" }
	}
}
