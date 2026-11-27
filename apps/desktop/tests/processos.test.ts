import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ehServidorDoProspector,
  encontrarNode,
  lerProcesso,
  portaEmUso,
  processoVivo,
  versaoPrincipal,
} from '../src/processos';

const SERVIDOR = 'D:\\Prospector\\app\\apps\\web\\server.js';

describe('ehServidorDoProspector', () => {
  it('só aceita o node.exe rodando o server.js desta instalação', () => {
    const linha = `"C:\\Program Files\\nodejs\\node.exe" ${SERVIDOR}`;
    expect(ehServidorDoProspector({ pid: 10, nome: 'node.exe', linha }, SERVIDOR)).toBe(true);
    expect(
      ehServidorDoProspector({ pid: 10, nome: 'NODE.EXE', linha: linha.toUpperCase() }, SERVIDOR),
    ).toBe(true);
  });

  it('recusa outro programa, outro servidor ou linha de comando ilegível', () => {
    expect(ehServidorDoProspector(null, SERVIDOR)).toBe(false);
    expect(
      ehServidorDoProspector(
        { pid: 10, nome: 'python.exe', linha: `python ${SERVIDOR}` },
        SERVIDOR,
      ),
    ).toBe(false);
    expect(
      ehServidorDoProspector(
        { pid: 10, nome: 'node.exe', linha: 'node C:\\outro\\apps\\web\\server.js' },
        SERVIDOR,
      ),
    ).toBe(false);
    expect(ehServidorDoProspector({ pid: 10, nome: 'node.exe', linha: '' }, SERVIDOR)).toBe(false);
    // O server.js desta instalação como argumento de outro script não é o servidor.
    expect(
      ehServidorDoProspector(
        { pid: 10, nome: 'node.exe', linha: `node C:\\outro.js ${SERVIDOR}` },
        SERVIDOR,
      ),
    ).toBe(false);
    expect(
      ehServidorDoProspector(
        { pid: 10, nome: 'node.exe', linha: `node ${SERVIDOR}.bak` },
        SERVIDOR,
      ),
    ).toBe(false);
  });

  it('aceita o caminho do server.js entre aspas (instalação em pasta com espaço)', () => {
    const servidor = 'D:\\Meus Programas\\Prospector\\app\\apps\\web\\server.js';
    const linha = `"C:\\Program Files\\nodejs\\node.exe" "${servidor}"`;
    expect(ehServidorDoProspector({ pid: 10, nome: 'node.exe', linha }, servidor)).toBe(true);
  });
});

describe('lerProcesso', () => {
  it('lê a saída do PowerShell e recusa formatos inesperados', () => {
    expect(lerProcesso('{"pid":35664,"nome":"node.exe","linha":"node server.js"}\r\n')).toEqual({
      pid: 35664,
      nome: 'node.exe',
      linha: 'node server.js',
    });
    expect(lerProcesso('{"pid":7,"nome":null,"linha":null}')).toEqual({
      pid: 7,
      nome: '',
      linha: '',
    });
    expect(lerProcesso('')).toBeNull();
    expect(lerProcesso('Get-NetTCPConnection : erro')).toBeNull();
    expect(lerProcesso('{"pid":"7"}')).toBeNull();
    expect(lerProcesso('{"pid":-1}')).toBeNull();
    expect(lerProcesso('[1,2]')).toBeNull();
  });
});

describe('encontrarNode', () => {
  it('procura node.exe nas pastas do PATH, na ordem', () => {
    const existe = (caminho: string) => caminho === 'C:\\nvm\\v24\\node.exe';
    expect(encontrarNode({ PATH: 'C:\\Windows;"C:\\nvm\\v24";C:\\outro' }, existe)).toBe(
      'C:\\nvm\\v24\\node.exe',
    );
  });

  it('usa a pasta padrão do Node quando o PATH não tem', () => {
    const existe = (caminho: string) => caminho === 'C:\\Program Files\\nodejs\\node.exe';
    expect(encontrarNode({ Path: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }, existe)).toBe(
      'C:\\Program Files\\nodejs\\node.exe',
    );
    expect(encontrarNode({ PATH: '' }, () => false)).toBeNull();
  });
});

describe('versaoPrincipal', () => {
  it('lê a versão principal do node --version', () => {
    expect(versaoPrincipal('v24.21.0\n')).toBe(24);
    expect(versaoPrincipal('22.1.0')).toBe(22);
    expect(versaoPrincipal('sem versão')).toBeNull();
  });
});

describe('portaEmUso e processoVivo', () => {
  let servidor: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolver) =>
      servidor ? servidor.close(() => resolver()) : resolver(),
    );
    servidor = null;
  });

  it('vê uma porta ouvindo e a mesma porta livre depois de fechar', async () => {
    servidor = createServer();
    await new Promise<void>((resolver) => servidor!.listen(0, '127.0.0.1', resolver));
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
    expect(await portaEmUso(porta)).toBe(true);
    await new Promise<void>((resolver) => servidor!.close(() => resolver()));
    servidor = null;
    expect(await portaEmUso(porta)).toBe(false);
  });

  it('o próprio processo está vivo', () => {
    expect(processoVivo(process.pid)).toBe(true);
  });
});
