import { writable, derived, get } from 'svelte/store';
import { fa } from './fa';
import { en } from './en';

export type Locale = 'fa' | 'en';

const initialLocale: Locale = (typeof localStorage !== 'undefined' && (localStorage.getItem('hermes_locale') as Locale)) || 'fa';

export const locale = writable<Locale>(initialLocale);

export const direction = derived(locale, ($locale) => ($locale === 'fa' ? 'rtl' : 'ltr'));

locale.subscribe((newLocale) => {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('hermes_locale', newLocale);
    }
});

export function t(key: string, fallback?: string): string {
    const currentLocale = get(locale);
    const dict = currentLocale === 'fa' ? fa : en;
    return dict[key] || fallback || key;
}
