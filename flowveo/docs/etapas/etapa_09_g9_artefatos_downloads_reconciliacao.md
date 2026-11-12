# Subetapa 09 (Gate G9) — Artifact Store, Verificação de Mídia, Reconciliação e Retomada Segura

- **Gate:** `G9` — *Cadeia completa `job -> intent -> submission -> result -> artifact` verificada e reconciliável entre banco e filesystem (Release B aceita)*
- **Requisitos atendidos:** `OBJ-05`, `OBJ-06`, `J06`, `J07`, `BC-12`, `BC-13`, `BC-14`, `BC-15`, `BC-16`, `S-08` | Arquitetura §18, §20

---

## 1. Objetivo
Construir o `ArtifactStore` seguro (nomes internos gerados pelo sistema, proteção estrita contra path traversal e symlinks, download em diretório de staging no mesmo filesystem e finalização por rename atômico), o `DownloadVerifier` (validação de existência, tamanho mínimo, assinatura binária Magic Bytes MP4/WebM `ftyp`, SHA-256 e inspeção opcional via `ffprobe` com `execFile` sem shell e com timeout), o `LocalArtifactReconciler` (detecção de arquivos órfãos, staging abandonado e registros `MISSING`), e o `RecoveryService` (`flow reconcile`, `flow resume`, `flow artifacts reconcile`) que retoma jobs interrompidos sem nunca regenerar vídeo para corrigir falha de download.

---

## 2. Passo a Passo de Implementação

### Passo 9.1 — Artifact Store e Anti-Traversal (`src/infrastructure/artifacts/artifact-store.ts`)
- Cadeia obrigatória persistida no SQLite (`artifacts` e `artifact_links`):
  `jobId -> submissionIntentId -> remoteSubmissionId -> remoteResultId -> downloadPermitId -> artifactId` (`BC-13`).
- Tentativa de registrar ou finalizar um artefato sem qualquer elo dessa cadeia é rejeitada.
- Nome do arquivo no disco é gerado internamente (`art_<artifactId>_<resultIndex>.mp4`); o nome sugerido pelo navegador/servidor remoto é sanitizado e salvo apenas como metadado (`remoteFilenameSanitized`).
- Verificação de segurança de caminho (`S-08`):
  - Resolve `realpath` do diretório base `runtime/artifacts` e `runtime/downloads/staging`.
  - Rejeita qualquer caminho contendo `..`, caracteres nulos ou que resolva fora de `runtime/artifacts`.
  - Verifica `fs.lstatSync` e rejeita symlinks/junctions inesperados.
- Fluxo atômico de escrita:
  1. Registra artefato como `PLANNED` no SQLite antes de iniciar download.
  2. Atualiza para `DOWNLOADING` e grava em `runtime/downloads/staging/<artifactId>.part`.
  3. Ao concluir stream, move por `fs.renameSync` (mesmo filesystem) para `runtime/artifacts/<jobId>/<internalName>.mp4` e atualiza para `DOWNLOADED`.

### Passo 9.2 — Download Verifier e Inspeção Técnica Segura (`src/infrastructure/artifacts/download-verifier.ts`)
- Verifica o arquivo `DOWNLOADED` (`VERIFYING -> VERIFIED | REJECTED`):
  1. Existência física, não ser symlink, tamanho `> minBytes` configurado.
  2. Verificação de Magic Bytes do contêiner (ex.: box ISO BMFF `ftyp` nos bytes 4..8 para MP4/MOV, rejeitando páginas HTML de erro salvas com extensão `.mp4`).
  3. Cálculo de hash `sha256`.
  4. Quando `ffprobe` estiver habilitado/disponível: executa via `child_process.execFile('ffprobe', [...], { shell: false, timeout: 10000 })` (nunca usa shell — Arquitetura §18) e valida codec, duração `> 0`, largura e altura (`BC-14`).
- Retry de download interrompido (`BC-16`): rebaixa apenas a ação de `DOWNLOAD` apontando para o **mesmo `remoteResultId` já pronto**, com limite de tentativas (`maxDownloadRetries: 2`). **Jamais** cria nova `SubmissionIntent` para corrigir falha de download.

### Passo 9.3 — Reconciliação Local e Retomada Segura (`src/infrastructure/artifacts/local-reconciler.ts`, `src/application/recovery-service.ts`)
- `LocalArtifactReconciler.reconcile()`:
  - Encontra arquivos em `runtime/artifacts` que não possuem registro `VERIFIED`/`DOWNLOADED` no banco → classifica como `ORPHAN_FILE` (nunca anexa arquivo órfão a um job por semelhança de nome — Arquitetura §18).
  - Encontra arquivos `.part` antigos em `staging` → limpa ou marca tentativa de download como interrompida.
  - Encontra registros `VERIFIED`/`DOWNLOADED` no banco cujo arquivo físico sumiu do disco → marca artefato como `MISSING` (`BC-15`).
- `RecoveryService.resumeJob(jobId)`:
  - Invalida todas as permissões antigas, executa preflight completo, lê o estado atual real da página (`FlowReader.inspectResults()`), reconcilia resultados que já ficaram `READY` (mesmo sem ter observado `PROCESSING`), baixa os pendentes ou pausa em `NEEDS_REVIEW` se a correlação for ambígua.

---

## 3. Baterias Obrigatórias de Teste (Gate G9)

1. **Testes Unitários (`tests/unit/g9-artifact-chain-and-verifier.test.ts`)**:
   - Rejeição de artefato sem vínculo com `remoteResultId` ou pertencente a outro `jobId`.
   - Rejeição de arquivo corrompido (ex.: texto HTML `"502 Bad Gateway"` salvo como `.mp4`) pela checagem de Magic Bytes `ftyp`.
2. **Testes de Segurança (`tests/security/g9-path-traversal-and-ffprobe-noshell.test.ts`)**:
   - Tentativa de injetar `remoteFilename` como `../../Windows/System32/cmd.exe`, `..\secret.mp4` ou`; rm -rf / #.mp4` → nome remoto é neutralizado como metadado e o arquivo físico usa exclusivamente o nome interno seguro dentro de `runtime/artifacts`.
   - Tentativa de apontar diretório de destino para um symlink externo → bloqueado imediatamente.
   - Verificação de que `DownloadVerifier` invoca `execFile` com `shell: false`.
3. **Testes de Caos (`tests/chaos/g9-download-crash-and-orphan-reconcile.test.ts`)**:
   - **Queda entre download no staging, rename e commit no SQLite:**
     - Caso A: crash com `.part` no staging → reconciliador detecta `.part` incompleto e agenda retry de download do mesmo `remoteResultId` (zero nova geração).
     - Caso B: crash após `rename` para `runtime/artifacts` mas antes do commit no SQLite → reconciliador identifica arquivo órfão e **não** o associa cegamente por nome.
     - Caso C: arquivo `VERIFIED` deletado externamente do disco → reconciliador detecta divergência e muda status para `MISSING`.
   - **Download tecnicamente válido, mas do resultado errado (`remoteResultId` divergente):** rejeitado pela verificação de vínculo da cadeia (`BC-13`).
4. **Testes de Estresse (`tests/stress/g9-parallel-hash-and-reconcile.test.ts`)**:
   - Reconciliação e verificação SHA-256 + Magic Bytes de 200 arquivos e registros mistos (válidos, órfãos, `.part` e ausentes) validando precisão de 100%.
