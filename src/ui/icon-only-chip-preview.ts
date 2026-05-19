import { getOwnerDocument } from '../core/dom-compat';

type IconOnlyPreviewChip = HTMLElement & {
	_operonCloseOnOutside?: (event: Event) => void;
	_operonCloseOnEscape?: (event: Event) => void;
	_operonCloseDocument?: Document;
};

export function bindIconOnlyChipPreview(chip: HTMLElement): void {
	chip.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (chip.classList.contains('is-peek-open')) {
			closeIconOnlyChipPreview(chip);
			return;
		}
		openIconOnlyChipPreview(chip);
	});
}

export function bindAdaptiveIconOnlyExpansion(chip: HTMLElement, _label?: string, _taskColor?: string | null): void {
	const openHover = (): void => {
		chip.classList.add('is-hover-open');
	};
	const closeHover = (): void => {
		if (chip.classList.contains('is-peek-open')) return;
		chip.classList.remove('is-hover-open');
	};
	chip.addEventListener('mouseenter', openHover);
	chip.addEventListener('mouseleave', closeHover);
	chip.addEventListener('focusin', openHover);
	chip.addEventListener('focusout', closeHover);
}

export function shouldOpenIconOnlyChipPreview(chip: HTMLElement): boolean {
	return !chip.classList.contains('is-peek-open') && !chip.matches(':hover');
}

export function openIconOnlyChipPreview(chip: HTMLElement): void {
	closeIconOnlyChipPreview(chip);
	chip.classList.add('is-peek-open');
	const closeOnOutside = (event: Event): void => {
		if (chip.contains(event.target as Node)) return;
		closeIconOnlyChipPreview(chip);
	};
	const closeOnEscape = (event: Event): void => {
		if (!('key' in event) || event.key !== 'Escape') return;
		closeIconOnlyChipPreview(chip);
	};
	const ownerDocument = getOwnerDocument(chip);
	const typed = chip as IconOnlyPreviewChip;
	typed._operonCloseOnOutside = closeOnOutside;
	typed._operonCloseOnEscape = closeOnEscape;
	typed._operonCloseDocument = ownerDocument;
	ownerDocument.addEventListener('pointerdown', closeOnOutside, true);
	ownerDocument.addEventListener('keydown', closeOnEscape, true);
}

export function closeIconOnlyChipPreview(chip: HTMLElement): void {
	chip.classList.remove('is-peek-open');
	chip.classList.remove('is-hover-open');
	const typed = chip as IconOnlyPreviewChip;
	const ownerDocument = typed._operonCloseDocument ?? getOwnerDocument(chip);
	if (typed._operonCloseOnOutside) {
		ownerDocument.removeEventListener('pointerdown', typed._operonCloseOnOutside, true);
	}
	if (typed._operonCloseOnEscape) {
		ownerDocument.removeEventListener('keydown', typed._operonCloseOnEscape, true);
	}
	delete typed._operonCloseOnOutside;
	delete typed._operonCloseOnEscape;
	delete typed._operonCloseDocument;
}

export function closeIconOnlyChipPreviewsForRoot(root: ParentNode): void {
	const rootNode = root as Node;
	const chips = Array.from(root.querySelectorAll<HTMLElement>('.operon-inline-compact-chip.is-peek-open'));
	for (const chip of chips) {
		if (rootNode.contains(chip)) {
			closeIconOnlyChipPreview(chip);
		}
	}
}
