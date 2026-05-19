import { CANONICAL_KEY_MAP } from '../types/keys';
import { t } from '../core/i18n';
import { KeyMapping } from '../types/settings';

export function getKeyMappingDescription(mapping: KeyMapping): string {
	const translationKey = `keyMappingsDesc_${mapping.canonicalKey}`;
	const translated = t('settings', translationKey);
	if (translated !== translationKey) return translated;

	return CANONICAL_KEY_MAP.get(mapping.canonicalKey)?.description
		?? t('settings', 'keyMappingsCustomDescriptionFallback');
}
