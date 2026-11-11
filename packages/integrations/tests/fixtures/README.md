# Fixtures dos adaptadores de CNPJ — SINTÉTICOS

Estrutura copiada das respostas reais da OpenCNPJ e da Minha Receita (conferidas em 2026-11-10 com
um CNPJ público de grande empresa). **Todos os valores são inventados** para teste (`"_synthetic": true`):
nomes com "EXEMPLO", CNPJs gerados só para os dígitos verificadores baterem, CPF fictício. O quadro de
sócios, o e-mail e os telefones estão aqui de propósito, para os testes provarem que o adaptador
os descarta.

# Fixture da busca Tavily — SINTÉTICO

`tavily-search.json` copia a estrutura da resposta real de `POST https://api.tavily.com/search`
(conferida em 2026-11-10 com duas buscas de validação; ver ADR-0012). **Todos os valores são
inventados** (`"_synthetic": true`), com domínios reservados `example.com`/`example.org`. O telefone (DDD 20, que não existe) e o
e-mail no trecho, o endereço `javascript:` e o perfil de rede social estão aqui de propósito, para os
testes provarem que o adaptador mascara dados pessoais e descarta endereços inválidos.
