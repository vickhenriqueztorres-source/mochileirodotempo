# STATE MACHINES — Máquinas de Estado Separadas e Determinísticas

## 1. Job (`JobPhase` + `JobStatus`)
- **Fases (`JobPhase`):** `PREFLIGHT -> PREPARING -> SUBMITTING -> AWAITING_RESULTS -> COLLECTING -> VERIFYING -> DONE`.
- **Status (`JobStatus`):** `QUEUED`, `ACTIVE`, `PAUSED`, `NEEDS_REVIEW`, `COMPLETED`, `PARTIAL`, `FAILED`, `CANCELLED_LOCAL`.
- **Regra Crítica:** Estado parcial (`PARTIAL`) nunca é classificado como `COMPLETED`. `CANCELLED_LOCAL` interrompe ações locais futuras mas preserva o ledger remoto (`BC-17`).

## 2. SubmissionIntent (`SubmissionIntentStatus`)
- `PLANNED -> RESERVED -> DISPATCHING -> CONFIRMED`
- `PLANNED | RESERVED -> ABORTED` (somente quando o clique comprovadamente não ocorreu)
- `DISPATCHING -> UNKNOWN -> RECONCILING -> CONFIRMED | NEEDS_REVIEW`
- **Regra Crítica:** Após `DISPATCHING`, é proibido transitar para `ABORTED` sem reconciliação.

## 3. RemoteResult (`RemoteResultStatus`)
- `OBSERVED -> PROCESSING -> READY | FAILED_REMOTE`
- `OBSERVED -> READY` (transição direta suportada quando o job é retomado e o resultado já está pronto — `BC-12`).

## 4. Artifact (`ArtifactStatus`)
- `PLANNED -> DOWNLOADING -> DOWNLOADED -> VERIFYING -> VERIFIED | REJECTED`
- `VERIFIED | DOWNLOADED -> MISSING` (quando o arquivo físico desaparece do disco na reconciliação — `BC-15`).

## 5. ExecutionPermit (`PermitStatus`)
- `ISSUED -> CLAIMED -> FINISHED`
- `ISSUED | CLAIMED -> REVOKED | EXPIRED`
