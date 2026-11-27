import { z } from 'zod';

/**
 * Link interno do app: começa com uma barra só. "//site" e "/\site" o navegador leva para outro
 * endereço, então não passam.
 */
export const InternalHref = z.string().regex(/^\/(?![/\\])/, 'link interno do app');
