import 'server-only';
import { createTenancyService, type TenancyService } from '@prospector/application';
import { createSupabaseTenancyRepository } from '@prospector/db';
import { cache } from 'react';
import { getSupabase } from './supabase';

/**
 * Raiz de composição da aplicação web: o único lugar que liga serviços de aplicação a
 * adaptadores concretos (`@prospector/db`). Telas e Server Actions recebem serviços daqui.
 */
export interface Services {
  tenancy: TenancyService;
}

export const getServices = cache(async (): Promise<Services> => {
  const supabase = await getSupabase();
  return { tenancy: createTenancyService(createSupabaseTenancyRepository(supabase)) };
});
