import { z } from 'zod';

export const Uuid = z.uuid({ error: 'Identificador inválido.' });

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }));
