import { randomKeyNaked } from '@/utils/randomKeyNaked';

const PORT_PROXY_SLUG_PATTERN = /^pp_[A-Za-z0-9_-]{16,64}$/;

export function makePortProxySlug(): string {
    return `pp_${randomKeyNaked(24)}`;
}

export function isValidPortProxySlug(slug: string): boolean {
    return PORT_PROXY_SLUG_PATTERN.test(slug);
}
