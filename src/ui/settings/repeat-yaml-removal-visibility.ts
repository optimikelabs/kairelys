export interface RepeatSeriesYamlRemovalVisibilityEntry {
	sourceFormat: 'inline' | 'yaml';
	yamlPropertyValueRemovalConfigured: boolean;
}

export interface RepeatSeriesYamlRemovalVisibilityContext {
	currentFormat: 'inline' | 'yaml' | null;
}

export function shouldRenderRepeatSeriesYamlRemovalRow(
	entry: RepeatSeriesYamlRemovalVisibilityEntry,
	context: RepeatSeriesYamlRemovalVisibilityContext,
): boolean {
	if (!entry.yamlPropertyValueRemovalConfigured) return false;
	return entry.sourceFormat === 'yaml' || context.currentFormat === 'yaml';
}
