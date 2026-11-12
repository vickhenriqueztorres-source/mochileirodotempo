# Subetapa 03 (Gate G3) — Navegador Dedicado, Controller Lock Exclusivo, Navigation Guard e Stop Controller

- **Gate:** `G3` — *Dois controladores nunca operam juntos; navegação não autorizada, CAPTCHA ou perda de sessão pausam imediatamente*
- **Requisitos atendidos:** `A-03`, `A-04`, `A-05`, `A-19`, `A-20`, `S-08`, `S-09` | Arquitetura §7, §20

---

## 1. Objetivo
Garantir exclusão mútua real entre processos e comandos (`ControllerLock` combinando lockfile exclusivo de SO `wx` + lease no SQLite com `controllerEpoch` monotônico), gerenciamento de perfil dedicado fora do Git (`runtime/profile`), guarda de navegação (`NavigationGuard`) que distingue origens de página autorizadas de sub-recursos de rede e bloqueia popups inesperados, detecção de CAPTCHA/sessão expirada/interferência humana (pausando sem tentar contornar), e `StopController` para drenagem segura em `Ctrl+C` (`SIGINT`/`SIGTERM`).

---

## 2. Passo a Passo de Implementação

### Passo 3.1 — Controller Lock e Ownership por Epoch (`src/infrastructure/browser/controller-lock.ts`)
- Lock primário no sistema operacional via criação atômica exclusiva (`fs.openSync(lockPath, 'wx')`) contendo `{ pid, host, controllerEpoch, acquiredAt }`.
- Lease secundário na tabela `controller_leases` do SQLite com incremento estrito de `controllerEpoch`.
- Regra da Arquitetura §7: **Heartbeat vencido sozinho não basta para tomar controle**. Se um novo controlador encontrar lock/lease com heartbeat expirado:
  - Verifica se o `pid` anterior ainda existe no SO (`process.kill(pid, 0)`).
  - Se o processo anterior estiver vivo, recusa aquisição (`ControllerBusyError`).
  - Se o processo anterior morreu sem liberar o lock, exige flag explícita de recuperação (`allowStaleTakeover` durante preflight/reconcile), incrementa `controllerEpoch` e revoga todas as permissões do epoch anterior.

### Passo 3.2 — Navigation Guard (`src/infrastructure/browser/navigation-guard.ts`)
- Valida a URL principal da página (`mainFrame`) contra a allowlist configurada na política (`https://labs.google/fx/...` ou `https://flow.google/...`, além da allowlist específica de login da conta Google quando em modo `login`).
- Não bloqueia indiscriminadamente sub-recursos de CDN/fontes/scripts legítimos (`resourceType !== 'document'`), evitando falsos-positivos (`S-08`).
- Popups inesperados (`page.on('popup')`) fora do fluxo explícito de login pausam imediatamente o controlador com motivo `POLICY` ou `UNKNOWN_STATE`.

### Passo 3.3 — Detecção de Sessão, CAPTCHA e Interferência Humana (`src/infrastructure/browser/flow-driver.ts`)
- Inspeção contínua de sinais de:
  - Sessão deslogada / redirecionamento para login durante operação de trabalho → pausa com `pauseReason: 'AUTH'` (`A-20`).
  - Desafio CAPTCHA / verificação de segurança (`iframe[src*="recaptcha"]`, textos/controles de challenge) → pausa imediata com `pauseReason: 'AUTH'`, **zero tentativa de contorno**.
  - Interferência humana detectável (mudança inesperada de foco/URL/projeto durante `execute`) → invalida `sessionEpoch`, revoga permissões em voo e pausa (`S-09`).
- Proibição estrita no código do `FlowDriver`: nenhum método produtivo pode usar `{ force: true }`, `dispatchEvent` ou cliques via `page.evaluate()` (`S-04`).

### Passo 3.4 — Browser Manager e Stop Controller (`src/infrastructure/browser/browser-manager.ts`, `src/safety/stop-controller.ts`)
- `BrowserManager`: valida que `profileDir` está dentro de `runtime/profile` (rejeita qualquer caminho que aponte para `AppData\Local\Google\Chrome\User Data` pessoal do usuário — `A-03`).
- `StopController`: captura `SIGINT`/`SIGTERM` ou comando `flow stop`, impede agendamento de novas ações, aguarda drenagem com timeout curto e marca ações em voo (`CLAIMED`/`DISPATCHING`) para reconciliação (`A-19`).

---

## 3. Baterias Obrigatórias de Teste (Gate G3)

1. **Testes Unitários (`tests/unit/g3-lock-and-navigation.test.ts`)**:
   - Rejeição de caminhos de perfil pessoal do Chrome (`AppData/Local/Google/Chrome/User Data`).
   - Separação correta no `NavigationGuard` entre navegação de frame principal (`document`) não autorizada (bloqueada) e carregamento de sub-recursos `script`/`stylesheet`/`image` (permitido).
2. **Testes de Segurança (`tests/security/g3-auth-captcha-no-bypass.test.ts`)**:
   - Simulação de tela de CAPTCHA e de sessão expirada: provar que o sistema pausa imediatamente (`PAUSED` / `AUTH`), revoga permissões ativas e realiza **zero** cliques adicionais.
   - Simulação de popup inesperado durante operação: pausa imediata e revogação de contexto.
3. **Testes de Caos (`tests/chaos/g3-stale-owner-and-sigint.test.ts`)**:
   - Heartbeat expirado no SQLite enquanto o PID do processo dono continua ativo → segundo controlador é bloqueado (não rouba o lock).
   - Morte abrupta simulada do processo dono → novo controlador em preflight detecta PID morto, exige recuperação, avança `controllerEpoch` de `1` para `2` e invalida qualquer permissão emitida no epoch `1`.
   - Disparo de `StopController.requestStop('SIGINT')` no meio da fila → próximas ações abortadas e estado persistido com segurança.
4. **Testes de Estresse (`tests/stress/g3-concurrent-controllers.test.ts`)**:
   - 20 instâncias concorrentes tentando adquirir o `ControllerLock` ao mesmo tempo → exatamente **1** adquire ownership e **19** falham de forma limpa (`ControllerBusyError`), sem deadlocks ou corrupção de lockfile.
