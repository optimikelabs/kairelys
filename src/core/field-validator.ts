/**
 * Field value validation for Operon task fields.
 * Validates parsed values against their declared types.
 * Based on Spec Sections 0.2 and 6.
 */

import { CANONICAL_KEY_MAP, PRIORITY_VALUES, ValueType } from '../types/keys';

export interface ValidationError {
	key: string;
	value: string;
	expectedType: ValueType;
	message: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_FULL_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DATETIME_SHORT_REGEX = /^\d{1,2}:\d{2}$/;
const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;
const PRIORITY_VALUE_SET = new Set<string>(PRIORITY_VALUES);

/**
 * Validate a single field value against its expected type.
 * Returns null if valid, or a ValidationError if invalid.
 */
export function validateFieldValue(key: string, value: string): ValidationError | null {
	const def = CANONICAL_KEY_MAP.get(key);
	if (!def) return null; // Unknown keys always pass (preserved as-is)

	if (!value.trim()) return null; // Empty values are valid (optional fields)

	switch (def.type) {
		case 'date':
			if (!DATE_REGEX.test(value)) {
				return { key, value, expectedType: 'date', message: `Expected YYYY-MM-DD format, got "${value}"` };
			}
			break;

		case 'datetime':
			if (!DATETIME_FULL_REGEX.test(value) && !DATETIME_SHORT_REGEX.test(value)) {
				return { key, value, expectedType: 'datetime', message: `Expected YYYY-MM-DDTHH:mm or HH:mm format, got "${value}"` };
			}
			break;

		case 'number':
			if (isNaN(Number(value))) {
				return { key, value, expectedType: 'number', message: `Expected numeric value, got "${value}"` };
			}
			break;

			case 'text':
				// Specific enum validations
				if (key === 'priority' && !PRIORITY_VALUE_SET.has(value)) {
					return { key, value, expectedType: 'text', message: `Expected one of ${PRIORITY_VALUES.join(', ')}, got "${value}"` };
				}
			if (key === 'taskColor' && value && !HEX_COLOR_REGEX.test(value)) {
				return { key, value, expectedType: 'text', message: `Expected RRGGBB hex color, got "${value}"` };
			}
			break;

		case 'list':
			// Lists are always valid as text; individual items could be validated further
			break;
	}

	return null;
}

/**
 * Validate all fields in a record. Returns array of errors (empty if all valid).
 */
export function validateFields(fields: Record<string, string>): ValidationError[] {
	const errors: ValidationError[] = [];
	for (const [key, value] of Object.entries(fields)) {
		const error = validateFieldValue(key, value);
		if (error) errors.push(error);
	}
	return errors;
}
