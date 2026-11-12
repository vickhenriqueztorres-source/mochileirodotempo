import { Command } from 'commander';
import { ReleasePhase } from '../shared/config-schema.js';
import { PolicyDeniedError } from '../shared/errors.js';

export interface CliCommandHandlers {
  init?: () => Promise<string>;
  doctor?: () => Promise<string>;
  sessionOpen?: () => Promise<string>;
  sessionStatus?: () => Promise<string>;
  sessionClose?: () => Promise<string>;
  observe?: () => Promise<string>;
  bootstrap?: (transitionId: string) => Promise<string>;
  explore?: () => Promise<string>;
  mapValidate?: () => Promise<string>;
  mapReport?: () => Promise<string>;
  mapDiff?: () => Promise<string>;
  enqueue?: (jobFile: string) => Promise<string>;
  dryRun?: (jobId: string) => Promise<string>;
  prepare?: (jobId: string) => Promise<string>;
  run?: (jobId: string) => Promise<string>;
  reconcile?: (jobId: string) => Promise<string>;
  resume?: (jobId: string) => Promise<string>;
  artifactsVerify?: (jobId: string) => Promise<string>;
  artifactsReconcile?: () => Promise<string>;
}

/**
 * CLI Oficial de 18+ Comandos (Arquitetura §22 / A-18):
 * Na Release A, comandos de preparacao/execucao (enqueue, prepare, run) permanecem
 * bloqueados por trava de seguranca fechada.
 */
export function buildFlowCli(
  releasePhase: ReleasePhase,
  handlers: CliCommandHandlers = {}
): Command {
  const program = new Command();
  program
    .name('flow')
    .description('Automacao local segura do Google Flow (Fail-Closed Architecture)')
    .version('1.0.0');

  const assertReleaseBOrHigher = (cmdName: string) => {
    if (releasePhase === 'A') {
      throw new PolicyDeniedError(
        `Comando '${cmdName}' bloqueado na Release A (A-18). Homologue o mapa contextual antes de habilitar geracao.`
      );
    }
  };

  program.command('init').description('Inicializa estrutura runtime e SQLite WAL').action(async () => {
    if (handlers.init) await handlers.init();
  });

  program.command('doctor').description('Executa diagnostico completo do ambiente (A-02)').action(async () => {
    if (handlers.doctor) await handlers.doctor();
  });

  const sessionCmd = program.command('session').description('Gerencia sessao dedicada do navegador');
  sessionCmd.command('open').action(async () => {
    if (handlers.sessionOpen) await handlers.sessionOpen();
  });
  sessionCmd.command('status').action(async () => {
    if (handlers.sessionStatus) await handlers.sessionStatus();
  });
  sessionCmd.command('close').action(async () => {
    if (handlers.sessionClose) await handlers.sessionClose();
  });

  program.command('observe').description('Observacao passiva com zero mutacoes (A-06)').action(async () => {
    if (handlers.observe) await handlers.observe();
  });

  program
    .command('bootstrap <transitionId>')
    .description('Bootstrap supervisionado de transicao candidata (A-09)')
    .action(async (transitionId: string) => {
      if (handlers.bootstrap) await handlers.bootstrap(transitionId);
    });

  program
    .command('explore')
    .description('Exploracao autorizada e reversivel de controles (A-10)')
    .action(async () => {
      if (handlers.explore) await handlers.explore();
    });

  const mapCmd = program.command('map').description('Inspeciona e valida o registro contextual do mapa');
  mapCmd.command('validate').action(async () => {
    if (handlers.mapValidate) await handlers.mapValidate();
  });
  mapCmd.command('report').action(async () => {
    if (handlers.mapReport) await handlers.mapReport();
  });
  mapCmd.command('diff').action(async () => {
    if (handlers.mapDiff) await handlers.mapDiff();
  });

  program
    .command('enqueue <jobFile>')
    .description('Enfileira definicao de Job validada')
    .action(async (jobFile: string) => {
      assertReleaseBOrHigher('enqueue');
      if (handlers.enqueue) await handlers.enqueue(jobFile);
    });

  program
    .command('prepare <jobId>')
    .description('Prepara modelo, proporcao, quantidade e prompt sem submeter (BC-02)')
    .action(async (jobId: string) => {
      assertReleaseBOrHigher('prepare');
      if (handlers.prepare) await handlers.prepare(jobId);
    });

  program
    .command('run <jobId>')
    .option('--dry-run', 'Apenas planeja sem tocar na pagina')
    .action(async (jobId: string, opts: { dryRun?: boolean }) => {
      if (opts.dryRun) {
        if (handlers.dryRun) await handlers.dryRun(jobId);
        return;
      }
      assertReleaseBOrHigher('run');
      if (handlers.run) await handlers.run(jobId);
    });

  program
    .command('reconcile <jobId>')
    .description('Reconcilia estado incerto (UNKNOWN) contra observacoes remotas')
    .action(async (jobId: string) => {
      assertReleaseBOrHigher('reconcile');
      if (handlers.reconcile) await handlers.reconcile(jobId);
    });

  program
    .command('resume <jobId>')
    .description('Retoma job pausado apos preflight e reconciliacao')
    .action(async (jobId: string) => {
      assertReleaseBOrHigher('resume');
      if (handlers.resume) await handlers.resume(jobId);
    });

  const artifactsCmd = program.command('artifacts').description('Verifica e reconcilia artefatos locais');
  artifactsCmd.command('verify <jobId>').action(async (jobId: string) => {
    if (handlers.artifactsVerify) await handlers.artifactsVerify(jobId);
  });
  artifactsCmd.command('reconcile').action(async () => {
    if (handlers.artifactsReconcile) await handlers.artifactsReconcile();
  });

  return program;
}
