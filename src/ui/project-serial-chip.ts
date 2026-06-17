import type { ProjectSerialDisplay } from '../core/project-serials';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import type { KeyMapping } from '../types/settings';
import {
	createInlineTaskCompactChipElement,
	type InlineTaskCompactChipEntry,
} from './compact-task-layout';

export function createProjectSerialChipElement(
	display: ProjectSerialDisplay,
	extraClasses = '',
	options?: { keyMappings?: KeyMapping[]; owner?: Node | null },
): HTMLElement {
	const entry: InlineTaskCompactChipEntry = {
		key: 'projectSerial',
		label: display.label,
		icon: getConfiguredKeyMappingIcon('operonId', options?.keyMappings ?? []) || 'fingerprint',
		iconOnly: false,
		interactive: false,
		colorRole: 'default',
		linkTarget: null,
		previewLinkTarget: null,
	};
	const chip = createInlineTaskCompactChipElement(
		entry,
		`operon-project-serial-chip ${extraClasses}`.trim(),
		{ forceFull: true, owner: options?.owner },
	);
	return chip;
}
