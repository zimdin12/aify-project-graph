import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, '../../../../docs/schemas');

const recordSchema = JSON.parse(
  fs.readFileSync(path.join(schemasDir, 'code-intel-record.v0.2.schema.json'), 'utf8')
);
const collectionSchema = JSON.parse(
  fs.readFileSync(path.join(schemasDir, 'code-intel-collection.v0.2.schema.json'), 'utf8')
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(recordSchema);
ajv.addSchema(collectionSchema);

const recordValidator = ajv.getSchema(recordSchema.$id);
const collectionValidator = ajv.getSchema(collectionSchema.$id);

function formatErrors(errors) {
  if (!errors) return [];
  return errors.map(e => `${e.instancePath || '/'} ${e.message} (${JSON.stringify(e.params)})`);
}

export function validateRecord(record) {
  const ok = recordValidator(record);
  return { valid: !!ok, errors: formatErrors(recordValidator.errors) };
}

export function validateCollection(collection) {
  const ok = collectionValidator(collection);
  return { valid: !!ok, errors: formatErrors(collectionValidator.errors) };
}

export function isV02Collection(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.schema_version === '0.2' &&
    typeof value.collectionId === 'string' &&
    Array.isArray(value.records)
  );
}

export const V02_RECORD_SCHEMA_ID = recordSchema.$id;
export const V02_COLLECTION_SCHEMA_ID = collectionSchema.$id;
