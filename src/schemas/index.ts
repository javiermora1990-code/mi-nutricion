import type { z } from 'zod';
import { aiProposalSchema, type AiProposalDocument } from './aiProposal';
import { backupSchema, encryptedBackupSchema, type BackupDocument, type EncryptedBackupDocument } from './backup';
import { SCHEMA_IDS, type SchemaId } from './common';
import { profileContextSchema, type ProfileContextDocument } from './profileContext';
import { purchaseProposalSchema, type PurchaseProposalDocument } from './purchaseProposal';

export * from './common';
export * from './profileContext';
export * from './purchaseProposal';
export * from './aiProposal';
export * from './backup';

/** Los 5 esquemas, indexados por su identificador. */
export const SCHEMAS = {
  [SCHEMA_IDS.profileContext]: profileContextSchema,
  [SCHEMA_IDS.purchaseProposal]: purchaseProposalSchema,
  [SCHEMA_IDS.aiProposal]: aiProposalSchema,
  [SCHEMA_IDS.backup]: backupSchema,
  [SCHEMA_IDS.encryptedBackup]: encryptedBackupSchema,
} satisfies Record<SchemaId, z.ZodType>;

export type AnyDocument =
  | ProfileContextDocument
  | PurchaseProposalDocument
  | AiProposalDocument
  | BackupDocument
  | EncryptedBackupDocument;

export type ParseResult =
  | { ok: true; schemaId: SchemaId; document: AnyDocument }
  | { ok: false; schemaId: SchemaId | null; errors: string[] };

/** Valida un texto JSON contra el esquema que él mismo declara en `schema`. */
export function parseDocumentText(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { ok: false, schemaId: null, errors: [`El archivo no es JSON válido: ${(e as Error).message}`] };
  }
  return parseDocument(json);
}

export function parseDocument(json: unknown): ParseResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, schemaId: null, errors: ['El documento debe ser un objeto JSON'] };
  }
  const declared = (json as Record<string, unknown>).schema;
  if (typeof declared !== 'string' || !(declared in SCHEMAS)) {
    return {
      ok: false,
      schemaId: null,
      errors: [
        `Campo "schema" desconocido o ausente (${JSON.stringify(declared)}). Válidos: ${Object.keys(SCHEMAS).join(', ')}`,
      ],
    };
  }
  const schemaId = declared as SchemaId;
  const result = SCHEMAS[schemaId].safeParse(json);
  if (result.success) return { ok: true, schemaId, document: result.data };
  return {
    ok: false,
    schemaId,
    errors: result.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(raíz)'}: ${i.message}`),
  };
}
