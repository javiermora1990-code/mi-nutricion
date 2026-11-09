import { z } from 'zod';
import { TABLE_NAMES, type TableName } from '../db/db';
import { FORMAT_VERSION, SCHEMA_IDS, envelope, isoDateTime } from './common';

/** Fila genérica: aquí solo se exige la clave primaria; la integridad referencial se valida al restaurar (Etapa 6). */
const row = z.looseObject({ id: z.uuid() });

const tablesShape = Object.fromEntries(TABLE_NAMES.map((t) => [t, z.array(row)])) as Record<
  TableName,
  z.ZodArray<typeof row>
>;

/** 12.4 — Respaldo completo: exige las 17 tablas, ni una más ni una menos. */
export const backupPayloadSchema = z
  .object({
    appVersion: z.string().min(1),
    dbSchemaVersion: z.number().int().positive(),
    includesPhotos: z.boolean(),
    integrity: z.object({
      tableCounts: z.record(z.string(), z.number().int().nonnegative()),
      dataSha256: z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 en hexadecimal (64 caracteres)'),
    }),
    tables: z.strictObject(tablesShape),
  })
  .superRefine((p, ctx) => {
    for (const t of TABLE_NAMES) {
      const declared = p.integrity.tableCounts[t];
      if (declared !== p.tables[t].length) {
        ctx.addIssue({
          code: 'custom',
          path: ['integrity', 'tableCounts', t],
          message: `Recuento declarado (${declared ?? 'ausente'}) distinto del real (${p.tables[t].length})`,
        });
      }
    }
  });

export const backupSchema = envelope(SCHEMA_IDS.backup, backupPayloadSchema);
export type BackupDocument = z.infer<typeof backupSchema>;

/** 12.5 — Respaldo cifrado (.mnut.enc.json): cabecera en claro autenticada como AAD. */
export const encryptedBackupSchema = z
  .strictObject({
    schema: z.literal(SCHEMA_IDS.encryptedBackup),
    formatVersion: z.literal(FORMAT_VERSION),
    createdAt: isoDateTime,
    innerType: z.enum(['backup-json', 'backup-zip']),
    kdf: z.strictObject({
      algorithm: z.literal('PBKDF2'),
      hash: z.literal('SHA-256'),
      iterations: z.number().int().min(600_000),
      saltBase64: z.base64().min(24), // ≥ 16 bytes
    }),
    cipher: z.strictObject({
      algorithm: z.literal('AES-256-GCM'),
      chunkSizeBytes: z.literal(4_194_304),
      totalChunks: z.number().int().positive(),
    }),
    chunks: z
      .array(
        z.strictObject({
          index: z.number().int().nonnegative(),
          ivBase64: z.base64().length(16), // 12 bytes
          ciphertextBase64: z.base64().min(24), // incluye tag GCM de 16 bytes
        }),
      )
      .min(1),
  })
  .superRefine((d, ctx) => {
    if (d.chunks.length !== d.cipher.totalChunks) {
      ctx.addIssue({
        code: 'custom',
        path: ['chunks'],
        message: `Se esperaban ${d.cipher.totalChunks} fragmentos y hay ${d.chunks.length}`,
      });
    }
    d.chunks.forEach((c, i) => {
      if (c.index !== i) {
        ctx.addIssue({ code: 'custom', path: ['chunks', i, 'index'], message: 'Fragmentos desordenados o incompletos' });
      }
    });
  });
export type EncryptedBackupDocument = z.infer<typeof encryptedBackupSchema>;
