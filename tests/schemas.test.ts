import { describe, expect, it } from 'vitest';
import { SCHEMAS, SCHEMA_IDS, parseDocument, parseDocumentText } from '../src/schemas';
import {
  sampleAiProposal,
  sampleBackup,
  sampleEncryptedBackup,
  sampleProfileContext,
  samplePurchaseProposal,
} from '../src/schemas/samples';

const samples = {
  [SCHEMA_IDS.profileContext]: sampleProfileContext,
  [SCHEMA_IDS.purchaseProposal]: samplePurchaseProposal,
  [SCHEMA_IDS.aiProposal]: sampleAiProposal,
  [SCHEMA_IDS.backup]: sampleBackup,
  [SCHEMA_IDS.encryptedBackup]: sampleEncryptedBackup,
};

// Los ejemplos se mutan a propósito para comprobar rechazos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const errorsOf = (doc: unknown) => {
  const r = parseDocument(doc);
  return r.ok ? [] : r.errors;
};

describe('los 5 esquemas', () => {
  it('existen exactamente 5', () => {
    expect(Object.keys(SCHEMAS)).toHaveLength(5);
  });

  for (const [id, make] of Object.entries(samples)) {
    it(`acepta un documento válido de ${id}`, () => {
      const r = parseDocument(make());
      expect(r.ok ? [] : r.errors).toEqual([]);
      expect(r.schemaId).toBe(id);
    });

    it(`${id} sobrevive a un ciclo JSON (texto → validación)`, () => {
      expect(parseDocumentText(JSON.stringify(make())).ok).toBe(true);
    });
  }
});

describe('envoltura común', () => {
  it('rechaza texto que no es JSON', () => {
    expect(parseDocumentText('{no es json').ok).toBe(false);
  });
  it('acepta un archivo con BOM inicial', () => {
    expect(parseDocumentText('﻿' + JSON.stringify(sampleProfileContext())).ok).toBe(true);
  });
  it('rechaza un schema desconocido', () => {
    expect(parseDocument({ ...sampleProfileContext(), schema: 'otra-app/cosa' }).ok).toBe(false);
  });
  it('rechaza id que no es UUID v4', () => {
    expect(errorsOf({ ...sampleProfileContext(), id: '123' }).join()).toContain('id');
  });
  it('rechaza formatVersion, moneda o locale distintos', () => {
    expect(parseDocument({ ...sampleProfileContext(), formatVersion: '2.0' }).ok).toBe(false);
    expect(parseDocument({ ...sampleProfileContext(), currency: 'USD' }).ok).toBe(false);
    expect(parseDocument({ ...sampleProfileContext(), locale: 'en-US' }).ok).toBe(false);
  });
  it('rechaza createdAt sin zona UTC', () => {
    expect(parseDocument({ ...sampleProfileContext(), createdAt: '2026-11-09T10:00:00' }).ok).toBe(false);
    expect(parseDocument({ ...sampleProfileContext(), createdAt: '2026-11-09T10:00:00+01:00' }).ok).toBe(false);
  });
  it('rechaza source desconocido y campos extra en la raíz', () => {
    expect(parseDocument({ ...sampleProfileContext(), source: 'claude' }).ok).toBe(false);
    expect(parseDocument({ ...sampleProfileContext(), extra: 1 }).ok).toBe(false);
  });
});

describe('reglas específicas', () => {
  it('nutrientes desconocidos: null se acepta, la ausencia no', () => {
    const ok: Any = sampleProfileContext();
    ok.payload.catalogSummary[0].nutrientsPer100.proteinG = null;
    expect(parseDocument(ok).ok).toBe(true);
    const bad: Any = sampleProfileContext();
    delete bad.payload.catalogSummary[0].nutrientsPer100.proteinG;
    expect(parseDocument(bad).ok).toBe(false);
  });

  it('purchase-proposal: exige EUR, líneas y unidades válidas', () => {
    const a: Any = samplePurchaseProposal();
    a.payload.receipt.currency = 'USD';
    expect(parseDocument(a).ok).toBe(false);
    const b: Any = samplePurchaseProposal();
    b.payload.lines = [];
    expect(parseDocument(b).ok).toBe(false);
    const c: Any = samplePurchaseProposal();
    c.payload.lines[0].unit = 'lb';
    expect(parseDocument(c).ok).toBe(false);
    const d: Any = samplePurchaseProposal();
    d.payload.lines[0].matchConfidence = 1.5;
    expect(parseDocument(d).ok).toBe(false);
  });

  it('purchase-proposal: un alimento propuesto no puede llegar ya verificado', () => {
    const a: Any = samplePurchaseProposal();
    a.payload.lines[0].proposedCatalogFood.verificationStatus = 'verified';
    expect(parseDocument(a).ok).toBe(false);
  });

  it('ai-proposal: el tipo de propuesta exige su sección', () => {
    const a: Any = sampleAiProposal();
    a.payload.proposalKind = 'meal_plan';
    expect(errorsOf(a).join()).toContain('mealPlan');
    const b: Any = sampleAiProposal();
    b.payload.proposalKind = 'recipes';
    expect(parseDocument(b).ok).toBe(true);
  });

  it('backup: exige las 17 tablas y recuentos coherentes', () => {
    const a: Any = sampleBackup();
    delete a.payload.tables.photos;
    expect(parseDocument(a).ok).toBe(false);
    const b: Any = sampleBackup();
    b.payload.tables.inventada = [];
    expect(parseDocument(b).ok).toBe(false);
    const c: Any = sampleBackup();
    c.payload.integrity.tableCounts.foods = 3;
    expect(errorsOf(c).join()).toContain('foods');
    const d: Any = sampleBackup();
    d.payload.integrity.dataSha256 = 'abc';
    expect(parseDocument(d).ok).toBe(false);
  });

  it('encrypted-backup: rechaza parámetros criptográficos débiles o fragmentos incoherentes', () => {
    const a: Any = sampleEncryptedBackup();
    a.kdf.iterations = 100000;
    expect(parseDocument(a).ok).toBe(false);
    const b: Any = sampleEncryptedBackup();
    b.cipher.totalChunks = 2;
    expect(parseDocument(b).ok).toBe(false);
    const c: Any = sampleEncryptedBackup();
    c.chunks[0].index = 1;
    expect(parseDocument(c).ok).toBe(false);
    const d: Any = sampleEncryptedBackup();
    d.cipher.algorithm = 'AES-128-CBC';
    expect(parseDocument(d).ok).toBe(false);
    const e: Any = sampleEncryptedBackup();
    e.chunks[0].ivBase64 = 'AAAA';
    expect(parseDocument(e).ok).toBe(false);
  });
});
