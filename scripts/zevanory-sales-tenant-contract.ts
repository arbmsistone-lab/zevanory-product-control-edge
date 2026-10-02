import assert from 'node:assert/strict';
import {
  commercialBucketName,
  zevanorySalesTenantId,
  zevanorySalesTenantIsolation,
} from '../backend/commercial.ts';

const original = process.env.ZEVANORY_SALES_TENANT_ID;

try {
  delete process.env.ZEVANORY_SALES_TENANT_ID;
  assert.equal(zevanorySalesTenantId(), 'zevanory');
  assert.equal(commercialBucketName('lead'), 'zpc_commercial_leads');
  assert.deepEqual(zevanorySalesTenantIsolation(), {
    id: 'zevanory',
    defaultTenant: true,
    tenantSource: 'server-environment',
    isolation: 'server-owned-bucket-v1',
    clientSelectable: false,
  });

  process.env.ZEVANORY_SALES_TENANT_ID = 'cliente-acme';
  assert.equal(zevanorySalesTenantId(), 'cliente-acme');
  assert.equal(
    commercialBucketName('lead'),
    'zpc_commercial_leads__tenant_cliente-acme',
  );
  assert.equal(
    commercialBucketName('evidence'),
    'zpc_commercial_evidence__tenant_cliente-acme',
  );
  assert.equal(zevanorySalesTenantIsolation().clientSelectable, false);

  const acmeLeadBucket = commercialBucketName('lead');
  const acmeEvidenceBucket = commercialBucketName('evidence');

  process.env.ZEVANORY_SALES_TENANT_ID = 'cliente-beta';
  const betaLeadBucket = commercialBucketName('lead');
  const betaEvidenceBucket = commercialBucketName('evidence');
  assert.notEqual(betaLeadBucket, acmeLeadBucket);
  assert.notEqual(betaEvidenceBucket, acmeEvidenceBucket);
  assert.match(acmeLeadBucket, /__tenant_cliente-acme$/);
  assert.match(betaLeadBucket, /__tenant_cliente-beta$/);
  assert.equal(acmeLeadBucket.includes('cliente-beta'), false);
  assert.equal(betaLeadBucket.includes('cliente-acme'), false);

  for (const invalidTenant of [
    '../other',
    'cliente/acme',
    'cliente_acme',
    '-cliente',
    'cliente.',
    'cliente acme',
    '..',
  ]) {
    process.env.ZEVANORY_SALES_TENANT_ID = invalidTenant;
    assert.throws(
      () => commercialBucketName('lead'),
      /zevanory_sales_tenant_invalid/,
      `tenant must fail closed: ${invalidTenant}`,
    );
  }

  process.env.ZEVANORY_SALES_TENANT_ID = '../other';
  assert.throws(() => zevanorySalesTenantId(), /zevanory_sales_tenant_invalid/);

  process.env.ZEVANORY_SALES_TENANT_ID = 'a';
  assert.throws(() => commercialBucketName('lead'), /zevanory_sales_tenant_invalid/);

  console.log('ZEVANORY_SALES_TENANT_ID_SERVER_OWNED=PASS');
  console.log('ZEVANORY_SALES_DEFAULT_DATA_COMPATIBILITY=PASS');
  console.log('ZEVANORY_SALES_NONDEFAULT_BUCKET_ISOLATION=PASS');
  console.log('ZEVANORY_SALES_INVALID_TENANT_FAIL_CLOSED=PASS');
  console.log('ZEVANORY_SALES_CROSS_TENANT_BUCKET_NEGATIVE=PASS');
  console.log('ZEVANORY_SALES_TENANT_TRAVERSAL_NEGATIVE=PASS');
} finally {
  if (original === undefined) delete process.env.ZEVANORY_SALES_TENANT_ID;
  else process.env.ZEVANORY_SALES_TENANT_ID = original;
}
