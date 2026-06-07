/**
 * Абсолютные URL для медиа из /uploads (аватар, картинки постов).
 * В БД храним относительные пути; в ответах API — полный URL (PUBLIC_APP_URL или http://localhost:PORT).
 */
export function publicBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const port = process.env.PORT || '4000';
  return `http://localhost:${port}`;
}

export function toAbsoluteMediaUrl(
  path: string | null | undefined,
): string | null {
  if (path == null || path === '') return null;
  const trimmed = String(path).trim();
  if (trimmed === '') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Кастомные схемы — пресеты-градиенты, не трогаем.
  if (
    trimmed.startsWith('preset:') ||
    trimmed.startsWith('gradient:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  const base = publicBaseUrl();
  const p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${p}`;
}

export function mapPublicUser<T extends { avatar?: string | null; banner?: string | null }>(u: T): T {
  return {
    ...u,
    avatar: toAbsoluteMediaUrl(u.avatar),
    banner: toAbsoluteMediaUrl(u.banner),
  } as T;
}
