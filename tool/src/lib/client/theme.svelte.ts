import type { ThemeName } from '../config';

const KEY = 'sdv-theme';

function stored(): ThemeName | undefined {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : undefined;
	} catch {
		return undefined;
	}
}

class ThemeState {
	current = $state<ThemeName>('light');

	/** Stored choice, else the design's configured default, else the OS preference. */
	init(configured: ThemeName) {
		const prefersDark =
			typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
		this.set(stored() ?? (configured === 'dark' || prefersDark ? 'dark' : 'light'), false);
	}

	set(theme: ThemeName, remember = true) {
		this.current = theme;
		document.documentElement.dataset.theme = theme;
		if (!remember) return;
		try {
			localStorage.setItem(KEY, theme);
		} catch {
			// Storage can be unavailable (private mode); the choice then lasts for the session.
		}
	}

	toggle() {
		this.set(this.current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
