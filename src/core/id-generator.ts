/**
 * Operon ID generator.
 * Generates 7-character lowercase alphanumeric IDs.
 * Based on Spec Section 15.
 *
 * Character set: [a-z0-9] (36 chars)
 * Total combinations: 36^7 = ~78 billion
 * Collision probability at 5,000 tasks: effectively zero
 */

const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 7;
const REPEAT_SERIES_PREFIX = 'rs';
const REPEAT_SERIES_SUFFIX_LENGTH = 5;

/** Optional provider for existing IDs — set once at plugin init. */
let existingIdsProvider: (() => Set<string>) | null = null;

/**
 * Register a function that returns the set of existing operonIds.
 * Called once during plugin initialization to enable collision checking.
 */
export function setExistingIdsProvider(provider: () => Set<string>): void {
	existingIdsProvider = provider;
}

/**
 * Generate a random 7-character operonId.
 * If an existingIdsProvider is registered, checks for collisions (up to 100 attempts).
 */
export function generateOperonId(): string {
	const maxAttempts = existingIdsProvider ? 100 : 1;
	for (let i = 0; i < maxAttempts; i++) {
		let id = '';
		for (let j = 0; j < ID_LENGTH; j++) {
			id += CHARSET[Math.floor(Math.random() * CHARSET.length)];
		}
		if (!existingIdsProvider) return id;
		if (!existingIdsProvider().has(id)) return id;
	}
	throw new Error('Failed to generate unique operonId after 100 attempts');
}

/**
 * Generate a unique operonId that doesn't collide with existing IDs.
 * @param existingIds - Set of already-used IDs to check against
 * @param maxAttempts - Maximum generation attempts before throwing
 */
export function generateUniqueOperonId(existingIds: Set<string>, maxAttempts: number = 100): string {
	for (let i = 0; i < maxAttempts; i++) {
		const id = generateOperonId();
		if (!existingIds.has(id)) return id;
	}
	throw new Error(`Failed to generate unique operonId after ${maxAttempts} attempts`);
}

export function generateRepeatSeriesId(existingIds?: Set<string>, maxAttempts: number = 100): string {
	for (let i = 0; i < maxAttempts; i++) {
		let suffix = '';
		for (let j = 0; j < REPEAT_SERIES_SUFFIX_LENGTH; j++) {
			suffix += CHARSET[Math.floor(Math.random() * CHARSET.length)];
		}
		const id = `${REPEAT_SERIES_PREFIX}${suffix}`;
		if (!existingIds || !existingIds.has(id)) return id;
	}
	throw new Error(`Failed to generate unique repeatSeriesId after ${maxAttempts} attempts`);
}

/**
 * Validate an operonId format.
 * Must be exactly 7 characters, lowercase alphanumeric only.
 */
export function isValidOperonId(id: string): boolean {
	return /^[a-z0-9]{7}$/.test(id);
}

export function isValidRepeatSeriesId(id: string): boolean {
	return /^rs[a-z0-9]{5}$/.test(id);
}
