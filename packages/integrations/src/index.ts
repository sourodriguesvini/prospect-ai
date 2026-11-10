/**
 * Adaptadores de serviços externos (ADR-0001): implementam portas de `@prospector/application`.
 * Só a raiz de composição da web importa este pacote. Toda integração nova segue a skill
 * `integracao-externa` e o checklist de termos do doc 05.
 */
export { createCnpjLookup, type CnpjLookupOptions } from './cnpj/lookup';
export {
  minhaReceita,
  openCnpj,
  type CnpjProviderAdapter,
  type ProviderResult,
} from './cnpj/providers';
export { USER_AGENT, getJson, type Fetch, type HttpOutcome } from './http';
