const SENSITIVE_HEADER_NAMES = new Set([
	'authorization',
	'cookie',
	'proxy-authorization',
	'set-cookie',
	'x-api-key'
]);

export function formatHeaderName(name: string): string {
	return name
		.split('-')
		.map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
		.join('-');
}

export function sanitizeHeaderValue(name: string, value: string): string {
	return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? '[redacted]' : value;
}

export function headersToLogObject(headers: Headers): Record<string, string> {
	const sanitized: Record<string, string> = {};

	headers.forEach((value, name) => {
		sanitized[name] = sanitizeHeaderValue(name, value);
	});

	return sanitized;
}
