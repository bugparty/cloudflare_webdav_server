/**
 * MIME type utilities for WebDAV server.
 */

/**
 * Common MIME types mapped by file extension.
 */
const MIME_TYPES: Record<string, string> = {
	// Text
	'.txt': 'text/plain',
	'.html': 'text/html',
	'.htm': 'text/html',
	'.css': 'text/css',
	'.csv': 'text/csv',
	'.ics': 'text/calendar',

	// JavaScript/JSON
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.json': 'application/json',
	'.jsonc': 'application/json',

	// Images
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.bmp': 'image/bmp',

	// Audio/Video
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.mpeg': 'video/mpeg',
	'.mpg': 'video/mpeg',
	'.webm': 'video/webm',
	'.avi': 'video/x-msvideo',
	'.mov': 'video/quicktime',
	'.wav': 'audio/wav',
	'.flac': 'audio/flac',
	'.ogg': 'audio/ogg',

	// Documents
	'.pdf': 'application/pdf',
	'.doc': 'application/msword',
	'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'.ppt': 'application/vnd.ms-powerpoint',
	'.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'.odt': 'application/vnd.oasis.opendocument.text',
	'.ods': 'application/vnd.oasis.opendocument.spreadsheet',
	'.odp': 'application/vnd.oasis.opendocument.presentation',

	// Archives
	'.zip': 'application/zip',
	'.tar': 'application/x-tar',
	'.gz': 'application/gzip',
	'.rar': 'application/vnd.rar',
	'.7z': 'application/x-7z-compressed',

	// Fonts
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.eot': 'application/vnd.ms-fontobject',

	// Code/Data
	'.xml': 'application/xml',
	'.yaml': 'application/x-yaml',
	'.yml': 'application/x-yaml',
	'.toml': 'application/toml',

	// macOS specific
	'.dmg': 'application/x-apple-diskimage',
	'.app': 'application/x-app',

	// Other
	'.md': 'text/markdown',
	'.rtf': 'application/rtf',
	'.psd': 'image/vnd.adobe.photoshop',
	'.ai': 'application/postscript',
	'.eps': 'application/postscript',
};

/**
 * Get MIME type from file path.
 */
export function getMimeType(path: string): string {
	const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
	return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Detect MIME type from content (simple detection).
 * Returns null if cannot detect.
 */
export function detectMimeTypeFromContent(content: ArrayBuffer): string | null {
	// Check for common file signatures
	const bytes = new Uint8Array(content.slice(0, 16));

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
		return 'image/png';
	}

	// JPEG: FF D8 FF
	if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
		return 'image/jpeg';
	}

	// GIF: 47 49 46 38
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
		return 'image/gif';
	}

	// PDF: 25 50 44 46
	if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
		return 'application/pdf';
	}

	// ZIP: 50 4B 03 04 or 50 4B 05 06 or 50 4B 07 08
	if (bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
		return 'application/zip';
	}

	// MP4: various signatures starting at offset 4
	if (bytes.length >= 12) {
		const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
		if (['ftyp', 'moov', 'mdat'].includes(boxType)) {
			return 'video/mp4';
		}
	}

	// Check if content looks like text
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(content.slice(0, 1024));
		// If it decodes successfully and contains printable characters, it's likely text
		if (/^[\x20-\x7E\n\r\t]+$/.test(text)) {
			return 'text/plain';
		}
	} catch {
		// Not valid UTF-8, likely binary
	}

	return null;
}
