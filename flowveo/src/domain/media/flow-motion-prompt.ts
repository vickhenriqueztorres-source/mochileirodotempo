import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigValidationError } from '../../shared/errors.js';

interface RootCharacterLock {
  mandatoryFlowVideoPromptPrefix: string;
  mandatoryFlowVoicePromptTemplate: string;
}

function loadRootCharacterLock(): RootCharacterLock {
  const candidates = [
    path.resolve('D:/CANAL 9/CHARACTER_LOCK_FLOW.json'),
    path.resolve(process.cwd(), 'CHARACTER_LOCK_FLOW.json'),
    path.resolve(process.cwd(), '..', 'CHARACTER_LOCK_FLOW.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as RootCharacterLock;
      } catch {
        // fallback below
      }
    }
  }
  return {
    mandatoryFlowVideoPromptPrefix:
      'IDENTITY LOCK (100% match to first frame): Preserve exact facial geometry, blue-grey eyes, neat short brown mustache with 1-day stubble, washed dark navy-blue cap (#263340) with no logo, matte burnt-terracotta Gore-Tex jacket (#9E472A), charcoal chest straps, and mustard-ochre yellow backpack cover (#D99B26) without any facial or clothing morphing.',
    mandatoryFlowVoicePromptTemplate:
      'VOICE LOCK (consistent 25-year-old Brazilian male vlogger, medium-baritone pitch, natural casual cadence), speaking in Brazilian Portuguese with exact lip-sync',
  };
}

export const FLOW_CONTINUITY_ANCHOR_POV =
  'Strict visual continuity with the reference first frame: preserve exact photorealistic iPhone 0.5x ultra-wide optics, exact character facial geometry, blue-grey eyes, neat brown mustache with 1-day stubble, washed dark navy-blue cap (#263340) with no logo, matte burnt-terracotta Gore-Tex jacket (#9E472A), charcoal chest straps, and mustard-ochre yellow backpack cover (#D99B26) without morphing.';

const MODERATION_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bblood\b/gi, 'dark soot'],
  [/\bstrike\b/gi, 'impact'],
  [/\bstrikes\b/gi, 'impacts'],
  [/\bbound\b/gi, 'fastened'],
  [/\brope\b/gi, 'hemp cord'],
  [/\bkill\b/gi, 'overwhelm'],
  [/\bkills\b/gi, 'overwhelms'],
  [/\bmonster\b/gi, 'colossal figure'],
  [/\bsmash\b/gi, 'break heavily'],
  [/\bsmashes\b/gi, 'breaks heavily'],
  [/\bshatter\b/gi, 'crack apart'],
  [/\bshatters\b/gi, 'cracks apart'],
  [/\bslaughter\b/gi, 'devastation'],
  [/\bcorpse\b/gi, 'fallen figure'],
  [/\bcorpses\b/gi, 'fallen figures'],
  [/\bhorror\b/gi, 'dread'],
  [/\bagony\b/gi, 'exhaustion'],
  [/\bscream\b/gi, 'shout'],
  [/\bweapon\b/gi, 'wooden staff'],
  [/\bblind\b/gi, 'obscure'],
  [/\bstab\b/gi, 'pierce'],
  [/\bdestroy\b/gi, 'collapse'],
  [/\bsacrileg\w*\b/gi, 'ancient'],
  [/\bbolt\b/gi, 'flash'],
  [/\bexplod\w*\b/gi, 'billow'],
  [/\bdrown\w*\b/gi, 'submerge'],
  [/\bflesh\b/gi, 'skin'],
  [/\bprey\b/gi, 'target'],
];

export interface BuiltFlowMotionPrompt {
  promptText: string;
  promptDigestSha256: string;
  sanitizedReplacementsApplied: number;
}

export function buildFlowMotionPromptFromStartFrame(params: {
  rawMotionPrompt: string;
  povAction?: string;
  ptBrDialogue?: string;
}): BuiltFlowMotionPrompt {
  const rootLock = loadRootCharacterLock();
  let base = (params.rawMotionPrompt || '').trim();
  if (!base && params.povAction) {
    base = `First-person POV iPhone 0.5x ultra-wide realistic handheld motion: ${params.povAction.trim()}`;
  }
  if (!base) {
    throw new ConfigValidationError(
      'Prompt de movimento para o Start Frame nao pode ser vazio.'
    );
  }

  let sanitizedCount = 0;
  let cleaned = base;
  for (const [pattern, replacement] of MODERATION_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, () => {
      sanitizedCount += 1;
      return replacement;
    });
  }

  // Prepend Root Identity Lock if not already present
  if (!cleaned.includes('IDENTITY LOCK')) {
    cleaned = `${rootLock.mandatoryFlowVideoPromptPrefix} ${cleaned}`;
  }

  // Append Voice Lock + PT-BR Dialogue
  if (params.ptBrDialogue && params.ptBrDialogue.trim().length > 0) {
    const cleanSpeech = params.ptBrDialogue
      .replace(/the user provided a specific script in the prompt\.?/gi, '')
      .replace(/["\r\n]+/g, ' ')
      .trim();
    cleaned = `${cleaned.replace(/[. ]+$/, '')}. ${rootLock.mandatoryFlowVoicePromptTemplate}: "${cleanSpeech}".`;
  }

  // Append Continuity Anchor
  if (!cleaned.toLowerCase().includes('strict visual continuity')) {
    cleaned = `${cleaned.replace(/[. ]+$/, '')}. ${FLOW_CONTINUITY_ANCHOR_POV}`;
  }

  const finalPrompt = cleaned.slice(0, 1200).trim();
  const promptDigestSha256 = crypto
    .createHash('sha256')
    .update(finalPrompt, 'utf8')
    .digest('hex');

  return {
    promptText: finalPrompt,
    promptDigestSha256,
    sanitizedReplacementsApplied: sanitizedCount,
  };
}

export const buildFlowMotionPrompt = buildFlowMotionPromptFromStartFrame;
